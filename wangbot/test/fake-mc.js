// Fake Minecraft server (SLP + RCON dalam satu port) untuk menguji
// src/lib/minecraft.js secara nyata lewat TCP, bukan mock.
//
//   const fake = await require('./fake-mc')()
//   ...
//   fake.server.close()
//
// Deteksi protokol: paket RCON selalu diawali 4 byte panjang, sedangkan paket
// Minecraft diawali VarInt. Bila byte pertama 0x02 dan sisanya nol, itu RCON.
const net = require('net')

function writeVarInt(v) {
  let x = v >>> 0
  const out = []
  do {
    let b = x & 0x7f
    x >>>= 7
    if (x !== 0) b |= 0x80
    out.push(b)
  } while (x !== 0)
  return Buffer.from(out)
}

function readVarInt(buf, offset = 0) {
  let value = 0
  let size = 0
  let b
  do {
    if (offset + size >= buf.length) return null
    b = buf[offset + size]
    value |= (b & 0x7f) << (7 * size)
    size++
  } while (b & 0x80)
  return { value: value >>> 0, size }
}

function packet(...parts) {
  const body = Buffer.concat(parts)
  return Buffer.concat([writeVarInt(body.length), body])
}

function str(s) {
  const b = Buffer.from(s, 'utf8')
  return Buffer.concat([writeVarInt(b.length), b])
}

function int32(n) {
  const b = Buffer.alloc(4)
  b.writeInt32LE(n, 0)
  return b
}

function readRconString(buf, offset) {
  const len = readVarInt(buf, offset)
  if (!len) return { value: '', size: 0 }
  return {
    value: buf.slice(offset + len.size, offset + len.size + len.value).toString('utf8'),
    size: len.size + len.value,
  }
}

const RCON_AUTH = 3
const RCON_COMMAND = 2
const RCON_RESPONSE = 0

function statusJson(opts) {
  const json = {
    version: { name: opts.versionName || 'Paper 1.20.4', protocol: opts.protocol || 765 },
    players: {
      online: opts.online != null ? opts.online : 3,
      max: opts.max != null ? opts.max : 20,
    },
    description:
      opts.description !== undefined
        ? opts.description
        : { text: '§aWangStore §7| §bSurvival', extra: [{ text: ' §8SMP' }] },
  }
  if (opts.sample !== null) {
    json.players.sample = opts.sample || [
      { name: 'Budi', id: 'a' },
      { name: 'Sari', id: 'b' },
      { name: 'Joko', id: 'c' },
    ]
  }
  return JSON.stringify(json)
}

function start(opts = {}) {
  const mode = opts.mode || 'slp' // 'slp' | 'rcon' — satu port, satu protokol
  const password = opts.password || 'rahasia123'
  const answers = opts.commands || {
    list: 'There are 3 of a max of 20 players online: Budi, Sari, Joko',
    say: '',
  }
  const log = { rconCommands: [], slpRequests: 0 }
  let slpOpts = opts.status || {}
  const state = {
    setStatus(o) {
      slpOpts = o
    },
  }

  const server = net.createServer((sock) => {
    let buf = Buffer.alloc(0)
    let authed = false
    sock.on('error', () => {})

    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk])
      if (mode === 'slp') {
        // Paket Minecraft: [VarInt len][payload]. Handshake selalu > 2 byte
        // sehingga tidak tertukar dengan paket RCON.
        for (;;) {
          const len = readVarInt(buf, 0)
          if (!len) return
          if (buf.length < len.size + len.value) return
          const body = buf.slice(len.size, len.size + len.value)
          buf = buf.slice(len.size + len.value)
          const pid = body.length ? body[0] : -1
          if (pid !== 0x00) return
          log.slpRequests++
          if (len.value > 2) continue // handshake: tidak dijawab
          // request status (1 byte) -> balas JSON
          sock.write(packet(Buffer.from([0x00]), str(statusJson(slpOpts))))
        }
      } else {
        // Paket RCON: [int32 len][int32 id][int32 type][body utf8][0x00][0x00]
        for (;;) {
          if (buf.length < 12) return
          const len = buf.readInt32LE(0)
          if (len < 10 || len > 4106 || buf.length < 4 + len) return
          const id = buf.readInt32LE(4)
          const type = buf.readInt32LE(8)
          const body = buf.slice(12, 4 + len - 2)
          buf = buf.slice(4 + len)

          if (type === RCON_AUTH) {
            const pass = readRconString(body, 0).value
            if (pass === password) {
              authed = true
              sock.write(packetRcon(id, RCON_RESPONSE, ''))
            } else {
              sock.write(packetRcon(-1, RCON_RESPONSE, ''))
            }
            continue
          }
          if (type === RCON_COMMAND) {
            if (!authed) {
              sock.destroy()
              return
            }
            const cmd = readRconString(body, 0).value
            if (!cmd) {
              // request kosong = penanda akhir multi-packet
              sock.write(packetRcon(id, RCON_RESPONSE, ''))
              continue
            }
            log.rconCommands.push(cmd)
            const answer = answers[cmd] !== undefined ? answers[cmd] : 'Unknown or incorrect command: ' + cmd
            sock.write(packetRcon(id, RCON_RESPONSE, answer))
            sock.write(packetRcon(id, RCON_RESPONSE, '')) // penanda akhir
          }
        }
      }
    })
  })

  return new Promise((resolve) => {
    server.listen(opts.port || 0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port, log, state, mode })
    })
  })
}

function packetRcon(id, type, body) {
  const b = Buffer.from(body || '', 'utf8')
  const head = Buffer.alloc(12)
  head.writeInt32LE(4 + 4 + b.length + 2, 0)
  head.writeInt32LE(id, 4)
  head.writeInt32LE(type, 8)
  return Buffer.concat([head, b, Buffer.from([0, 0])])
}

module.exports = start
module.exports.statusJson = statusJson

// bisa dijalankan langsung: node test/fake-mc.js
if (require.main === module) {
  start({ port: Number(process.env.PORT || 25599) }).then(({ port }) =>
    console.log('fake minecraft (SLP+RCON) on ' + port)
  )
}
