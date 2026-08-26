// Protokol Minecraft murni (tanpa dependency tambahan):
//   1. SLP  — Server List Ping (port default 25565): status online/offline,
//             jumlah player, MOTD, versi, latency.
//   2. RCON — Source RCON (port default 25575): kirim console command.
//
// Semua memakai `net` bawaan Node supaya tidak menambah beban install di VPS.

const net = require('net')

const DEFAULT_TIMEOUT = 5000
const MAX_VARINT_BYTES = 5

// ---------- VarInt (protokol Minecraft memakai VarInt, bukan fixed int) ----------
function writeVarInt(value) {
  let v = value >>> 0
  const out = []
  do {
    let b = v & 0x7f
    v >>>= 7
    if (v !== 0) b |= 0x80
    out.push(b)
  } while (v !== 0)
  return Buffer.from(out)
}

// Baca VarInt dari buffer. Mengembalikan { value, size } atau null bila byte
// belum cukup (butuh data lanjutan dari socket).
function readVarInt(buf, offset = 0) {
  let value = 0
  let size = 0
  let b
  do {
    if (offset + size >= buf.length) return null // belum lengkap
    b = buf[offset + size]
    value |= (b & 0x7f) << (7 * size)
    size++
    if (size > MAX_VARINT_BYTES) throw new Error('VarInt terlalu panjang / data rusak')
  } while (b & 0x80)
  return { value: value >>> 0, size }
}

// Bungkus payload jadi paket Minecraft: [VarInt panjang][payload]
function packet(...payloads) {
  const body = Buffer.concat(payloads)
  return Buffer.concat([writeVarInt(body.length), body])
}

function str(s) {
  const b = Buffer.from(String(s), 'utf8')
  return Buffer.concat([writeVarInt(b.length), b])
}

function readString(buf, offset) {
  const len = readVarInt(buf, offset)
  if (!len) throw new Error('paket terpotong (string)')
  const start = offset + len.size
  return buf.slice(start, start + len.value).toString('utf8')
}

function handshakePayload(host, port, protocol) {
  return Buffer.concat([
    writeVarInt(0x00), // packet id: handshake
    writeVarInt(protocol),
    str(host),
    (() => {
      const b = Buffer.alloc(2)
      b.writeUInt16BE(port & 0xffff, 0)
      return b
    })(),
    writeVarInt(1), // next state: 1 = status
  ])
}

/**
 * Ping sebuah server Minecraft lewat protokol status.
 * @returns {Promise<{online:boolean, latency:number, version:{name:string,protocol:number},
 *   players:{online:number,max:number,sample:Array}, description:string, raw:object}|{online:false,error:string}>}
 */
async function ping(host, port = 25565, opts = {}) {
  const timeout = opts.timeout || DEFAULT_TIMEOUT
  // -1 = minta server menjawab versi apapun (Vanilla >= 1.7 menerima -1).
  // Bila server menolak (mis. ViaVersion ketat), ulangi dengan versi legacy.
  const protocols = opts.protocol ? [opts.protocol] : [-1, 765, 47]

  let lastErr = 'tidak ada respons'
  for (const protocol of protocols) {
    const t0 = Date.now()
    try {
      const json = await pingOnce(host, port, protocol, timeout)
      const latency = Date.now() - t0
      return normalizeStatus(json, latency)
    } catch (e) {
      lastErr = e.message
      // Koneksi ditolak / host tidak ada: percuma mencoba protokol lain.
      if (e.code === 'ECONNREFUSED' || e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN') break
    }
  }
  return { online: false, error: lastErr, host, port }
}

function pingOnce(host, port, protocol, timeout) {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0)
    let done = false

    const sock = new net.Socket()
    sock.setTimeout(timeout)

    const fail = (err) => {
      if (done) return
      done = true
      clearTimeout(deadline)
      sock.destroy()
      reject(err)
    }

    const deadline = setTimeout(() => {
      const e = new Error('timeout setelah ' + timeout + 'ms')
      e.code = 'ETIMEDOUT'
      fail(e)
    }, timeout)

    sock.on('error', (err) => {
      const e = new Error(err.code === 'ECONNREFUSED' ? 'koneksi ditolak (port tertutup?)' : err.message)
      e.code = err.code
      fail(e)
    })
    sock.on('timeout', () => {
      const e = new Error('timeout setelah ' + timeout + 'ms')
      e.code = 'ETIMEDOUT'
      fail(e)
    })

    sock.connect(port, host, () => {
      sock.write(packet(handshakePayload(host, port, protocol)))
      sock.write(packet(Buffer.from([0x00]))) // request status
    })

    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk])
      for (;;) {
        const len = readVarInt(buf, 0)
        if (!len) return
        if (buf.length < len.size + len.value) return // tunggu data lengkap
        const body = buf.slice(len.size, len.size + len.value)
        buf = buf.slice(len.size + len.value)

        // Server TIDAK membalas Handshake; satu-satunya paket yang kita
        // tunggu adalah Status Response (id 0x00) berisi JSON.
        if (body.length < 1 || body[0] !== 0x00) continue
        // Setelah packet id masih ada VarInt panjang string — WAJIB dilewati,
        // kalau tidak JSON.parse selalu gagal karena byte 0xfc/0x01 di depan.
        const sl = readVarInt(body, 1)
        const text = sl
          ? body.slice(1 + sl.size, 1 + sl.size + sl.value).toString('utf8')
          : body.slice(1).toString('utf8')
        done = true
        clearTimeout(deadline)
        sock.destroy()
        try {
          resolve(JSON.parse(text))
        } catch (e) {
          reject(new Error('respons bukan JSON valid'))
        }
        return
      }
    })
  })
}

function normalizeStatus(json, latency) {
  const players = json.players || {}
  const version = json.version || {}
  return {
    online: true,
    latency,
    ip: json.ip || null,
    version: { name: version.name || '-', protocol: version.protocol ?? null },
    players: {
      online: players.online || 0,
      max: players.max || 0,
      sample: Array.isArray(players.sample) ? players.sample.map((p) => p.name) : [],
    },
    description: motdText(json.description),
    raw: json,
  }
}

// description bisa berupa string biasa ATAU objek chat component (bisa bersarang
// di .extra), jadi keduanya perlu diratakan.
function motdText(desc) {
  if (!desc) return ''
  if (typeof desc === 'string') return stripColors(desc)
  let out = ''
  const walk = (node) => {
    if (!node) return
    if (typeof node === 'string') {
      out += node
      return
    }
    if (typeof node.text === 'string') out += node.text
    if (Array.isArray(node.extra)) node.extra.forEach(walk)
  }
  walk(desc)
  return stripColors(out)
}

function stripColors(s) {
  return String(s).replace(/§[0-9a-fk-or]/gi, '').trim()
}

function playerList(status, limit = 20) {
  const sample = status.players && status.players.sample ? status.players.sample : []
  if (!sample.length) return ''
  const shown = sample.slice(0, limit)
  let t = shown.map((n) => '• ' + n).join('\n')
  const rest = (status.players.online || sample.length) - shown.length
  if (rest > 0) t += `\n… dan ${rest} player lainnya`
  return t
}

function uptimeText(ms) {
  const s = Math.floor((ms || 0) / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d) return `${d}h ${h}j ${m}m`
  if (h) return `${h}j ${m}m`
  return `${m}m`
}

// ---------- Source RCON ----------
const RCON_AUTH = 3
const RCON_COMMAND = 2
const RCON_RESPONSE = 0
const RCON_AUTH_FAIL = -1 // id yang dikembalikan server saat password salah

function rconPacket(id, type, body) {
  // Format Source RCON yang dipakai Minecraft:
  //   [int32 panjang][int32 id][int32 tipe][VarInt len + string][0x00]
  // String WAJIB ber-prefix VarInt; tanpa itu server Minecraft membaca
  // karakter pertama password/command sebagai panjang string.
  const raw = Buffer.from(String(body || ''), 'utf8')
  const bodyBuf = Buffer.concat([writeVarInt(raw.length), raw])
  const len = 4 + 4 + bodyBuf.length + 2
  const head = Buffer.alloc(12)
  head.writeInt32LE(len, 0)
  head.writeInt32LE(id, 4)
  head.writeInt32LE(type, 8)
  return Buffer.concat([head, bodyBuf, Buffer.from([0, 0])])
}

// Baca string ber-prefix VarInt; bila data belum lengkap, kembalikan sisa apa
// adanya (respons RCON bisa terpotong di 4096 byte oleh server).
function rconReadString(buf, offset) {
  const len = readVarInt(buf, offset)
  if (!len) return { value: '', size: 0 }
  const start = offset + len.size
  return { value: buf.slice(start, start + len.value).toString('utf8'), size: len.size + len.value }
}

function readRconPacket(buf, offset = 0) {
  if (buf.length - offset < 12) return null
  const len = buf.readInt32LE(offset)
  if (len < 10 || len > 4106) throw new Error('panjang paket RCON tidak wajar: ' + len)
  if (buf.length - offset < 4 + len) return null
  const id = buf.readInt32LE(offset + 4)
  const type = buf.readInt32LE(offset + 8)
  const bodyBuf = buf.slice(offset + 12, offset + 4 + len - 2)
  return { packet: { id, type, body: rconReadString(bodyBuf, 0).value }, size: 4 + len }
}

/**
 * Login RCON dan jalankan satu atau beberapa command.
 * @param {string} host
 * @param {number} port  default 25575
 * @param {string} password  isi rcon.password di server.properties
 * @param {string|string[]} commands
 */
async function rcon(host, port, password, commands, opts = {}) {
  const timeout = opts.timeout || DEFAULT_TIMEOUT
  const list = (Array.isArray(commands) ? commands : [commands])
    .map((c) => String(c || '').trim())
    .filter(Boolean)
  if (!list.length) throw new Error('tidak ada command untuk dijalankan')

  const sock = await rconConnect(host, port, password, timeout)
  const results = []
  try {
    for (const cmd of list) {
      results.push({ command: cmd, response: await rconSend(sock, cmd, timeout) })
      if (opts.delay) await new Promise((r) => setTimeout(r, opts.delay))
    }
  } finally {
    try {
      sock.destroy()
    } catch (_) {}
  }
  return results
}

function rconConnect(host, port, password, timeout) {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0)
    let authed = false
    let done = false
    const sock = new net.Socket()
    sock.setTimeout(timeout)

    const fail = (msg) => {
      if (done) return
      done = true
      clearTimeout(deadline)
      try {
        sock.destroy()
      } catch (_) {}
      reject(new Error(msg))
    }

    const deadline = setTimeout(() => fail('timeout RCON setelah ' + timeout + 'ms'), timeout)

    sock.on('error', (err) =>
      fail(err.code === 'ECONNREFUSED' ? 'koneksi RCON ditolak — port ' + port + ' tertutup?' : err.message)
    )
    sock.on('timeout', () => fail('timeout RCON setelah ' + timeout + 'ms'))

    sock.connect(port, host, () => {
      sock.write(rconPacket(1, RCON_AUTH, password))
    })

    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk])
      for (;;) {
        let p
        try {
          p = readRconPacket(buf)
        } catch (e) {
          return fail(e.message)
        }
        if (!p) return
        buf = buf.slice(p.size)

        if (!authed) {
          if (p.packet.id === RCON_AUTH_FAIL) return fail('password RCON salah')
          if (p.packet.type === RCON_RESPONSE && p.packet.id === 1) {
            authed = true
            done = true
            clearTimeout(deadline)
            sock.setTimeout(0)
            sock.removeAllListeners('timeout')
            resolve(sock)
          }
          continue
        }
      }
    })
  })
}

// Respons RCON dibatasi 4096 byte per paket. Server yang "sopan" (Source RCON)
// menjawab request kosong sebagai penanda akhir; Minecraft vanilla mengirim
// satu paket kosong. Kita coba keduanya secara best-effort dengan batas ketat.
async function rconSend(sock, command, timeout) {
  const id = 2 + Math.floor(Math.random() * 0x7ffffffd)
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0)
    let out = ''
    let done = false

    const finish = (err) => {
      if (done) return
      done = true
      clearTimeout(deadline)
      sock.removeListener('data', onData)
      sock.removeListener('error', onErr)
      err ? reject(err) : resolve(out)
    }
    const onErr = (e) => finish(new Error(e.message))
    const deadline = setTimeout(() => finish(null), Math.min(timeout, 4000))

    function onData(chunk) {
      buf = Buffer.concat([buf, chunk])
      for (;;) {
        let p
        try {
          p = readRconPacket(buf)
        } catch (e) {
          return finish(e)
        }
        if (!p) return
        buf = buf.slice(p.size)
        if (p.packet.id === RCON_AUTH_FAIL) return finish(new Error('sesi RCON ditolak server'))
        if (p.packet.id !== id) continue // bukan jawaban kita
        if (!p.packet.body) return finish(null) // paket kosong = akhir respons
        out += p.packet.body
        if (out.length > 65536) return finish(null)
        // minta penanda akhir
        try {
          sock.write(rconPacket(id + 1, RCON_COMMAND, ''))
        } catch (_) {}
      }
    }

    sock.on('data', onData)
    sock.on('error', onErr)
    try {
      sock.write(rconPacket(id, RCON_COMMAND, command))
    } catch (e) {
      finish(new Error(e.message))
    }
  })
}

module.exports = {
  // VarInt & paket (diekspor supaya bisa diuji)
  writeVarInt,
  readVarInt,
  packet,
  handshakePayload,
  motdText,
  stripColors,
  playerList,
  uptimeText,
  // fitur
  ping,
  rcon,
  rconConnect,
  rconSend,
  rconPacket,
  rconReadString,
  readRconPacket,
  RCON_AUTH,
  RCON_COMMAND,
  RCON_RESPONSE,
}
