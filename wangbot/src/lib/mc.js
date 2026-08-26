// Lapisan "server Minecraft" WangBot: registry pelanggan, pengecekan status
// (SLP + resource Pterodactyl), alert otomatis, dan console command.
//
// Desain akses: satu entri = satu nomor WhatsApp pelanggan. Server yang
// terlihat dibatasi oleh Client API key milik pelanggan itu sendiri, jadi
// pelanggan tidak bisa melihat server orang lain walaupun tahu uuid-nya.

const net = require('net')
const config = require('../config')
const logger = require('./logger')
const Panel = require('./panel')
const MC = require('./minecraft')

function store(db) {
  if (!db.data.minecraft) db.data.minecraft = { entries: {}, servers: {} }
  if (!db.data.minecraft.entries) db.data.minecraft.entries = {}
  if (!db.data.minecraft.servers) db.data.minecraft.servers = {}
  return db.data.minecraft
}

function getEntry(db, jid) {
  return store(db).entries[jid] || null
}

function setEntry(db, jid, patch) {
  const st = store(db)
  st.entries[jid] = Object.assign(
    { jid, email: '', token: '', createdAt: Date.now(), servers: [] },
    st.entries[jid] || {},
    patch
  )
  db.save()
  return st.entries[jid]
}

function delEntry(db, jid) {
  const st = store(db)
  const e = st.entries[jid]
  if (!e) return false
  // lepas server milik entri ini dari registry global
  for (const [id, s] of Object.entries(st.servers)) {
    if (s.ownerJid === jid) delete st.servers[id]
  }
  delete st.entries[jid]
  db.save()
  return true
}

// Semua server yang dipantau bot (lintas pelanggan) — dipakai scheduler.
function allServers(db) {
  return Object.values(store(db).servers)
}

function serverOf(db, identifier) {
  return store(db).servers[identifier] || null
}

function countFor(db, jid) {
  return allServers(db).filter((s) => s.ownerJid === jid).length
}

// Ambil server dari panel via Client API milik pelanggan ini
async function listFromPanel(entry) {
  if (!entry || !entry.token) return { error: 'belum terhubung ke panel' }
  const prev = config.panelClientToken
  config.panelClientToken = entry.token
  try {
    // Panel.clientListServers() mengembalikan ARRAY (atau {error});
    // seragamkan jadi { servers } / { error } supaya pemanggil konsisten.
    const list = await Panel.clientListServers()
    if (!Array.isArray(list)) return { error: (list && list.error) || 'gagal mengambil daftar server' }
    return { servers: list }
  } finally {
    config.panelClientToken = prev
  }
}

async function resourcesFor(db, srv) {
  const entry = srv.ownerJid ? getEntry(db, srv.ownerJid) : null
  if (!entry || !entry.token || !srv.identifier) return null
  const prev = config.panelClientToken
  config.panelClientToken = entry.token
  try {
    const res = await Panel.clientResources(srv.identifier)
    return res && !res.error ? res : null
  } finally {
    config.panelClientToken = prev
  }
}

// Daftarkan server panel ke registry (idempotent)
function registerServer(db, ownerJid, attrs, opts = {}) {
  const st = store(db)
  const id = attrs.identifier
  if (!id) return { error: 'server tanpa identifier' }
  const prev = st.servers[id] || {}
  st.servers[id] = {
    identifier: id,
    uuid: attrs.uuid || prev.uuid || '',
    name: attrs.name || prev.name || id,
    host: opts.host || prev.host || attrs.mcHost || '',
    port: opts.port || prev.port || attrs.mcPort || 25565,
    rcon: prev.rcon || { host: '', port: 25575, password: '' },
    monitor: opts.monitor != null ? !!opts.monitor : prev.monitor != null ? prev.monitor : true,
    panel: opts.panel !== false,
    ownerJid,
    addedBy: opts.addedBy || ownerJid,
    addedAt: prev.addedAt || Date.now(),
    notes: opts.notes != null ? opts.notes : prev.notes || '',
  }
  const e = st.entries[ownerJid]
  if (e && !e.servers.includes(id)) e.servers.push(id)
  db.save()
  return { server: st.servers[id] }
}

function removeServer(db, identifier) {
  const st = store(db)
  const s = st.servers[identifier]
  if (!s) return false
  delete st.servers[identifier]
  for (const e of Object.values(st.entries)) {
    e.servers = (e.servers || []).filter((x) => x !== identifier)
  }
  db.save()
  return true
}

// Cari server: boleh pakai identifier, nama, atau host. Owner boleh memakai
// server pelanggan mana pun; pelanggan hanya miliknya sendiri.
function resolveServer(db, senderJid, isOwner, query) {
  const all = allServers(db)
  const q = String(query || '').trim().toLowerCase()
  let list = all.filter((s) => s.ownerJid === senderJid)
  if (isOwner && q) {
    const hit = all.find(
      (s) =>
        s.identifier.toLowerCase() === q ||
        String(s.name).toLowerCase() === q ||
        String(s.host).toLowerCase() === q
    )
    if (hit) return { server: hit }
  }
  if (isOwner && !q && all.length === 1) return { server: all[0] }
  if (!q) {
    if (list.length === 0) return { error: 'belum ada server terdaftar' }
    if (list.length > 1) {
      return {
        error:
          'kamu punya ' +
          list.length +
          ' server. Sebutkan namanya, contoh: `' +
          config.prefix +
          'mcstatus ' +
          list[0].name +
          '`\nDaftar: `' +
          config.prefix +
          'mcservers`',
      }
    }
    return { server: list[0] }
  }
  const found = list.find(
    (s) =>
      s.identifier.toLowerCase() === q ||
      String(s.name).toLowerCase() === q ||
      String(s.name).toLowerCase().includes(q) ||
      String(s.host).toLowerCase() === q
  )
  if (found) return { server: found }
  return {
    error:
      'server "' +
      query +
      '" tidak ditemukan di daftarmu. Lihat `' +
      config.prefix +
      'mcservers`.',
  }
}

function maskToken(token) {
  const t = String(token || '')
  if (t.length <= 12) return t.slice(0, 2) + '•'.repeat(Math.max(4, t.length - 2))
  return t.slice(0, 6) + '•'.repeat(6) + t.slice(-4)
}

// ---------- pengecekan status ----------

// host:port -> alamat yang dipakai untuk SLP ping. Owner bisa menimpa lewat
// `host`/`port` (mis. server di belakang NAT butuh IP publik + port forwarded).
function address(srv) {
  const host = srv.host || ''
  const port = srv.port || 25565
  if (!host) return null
  return { host, port }
}

// Probe status. Menggabungkan SLP (player/MOTD/versi) + resource panel
// (CPU/RAM/power state). Salah satu boleh gagal tanpa menggagalkan sisanya.
async function checkServer(db, srv) {
  const out = {
    identifier: srv.identifier,
    name: srv.name,
    online: null,
    source: [],
    error: null,
  }

  const addr = address(srv)
  if (addr) {
    const p = await MC.ping(addr.host, addr.port, { timeout: config.mcPingTimeout })
    out.slp = p
    out.source.push('slp')
    if (p.online) {
      out.online = true
    } else {
      out.error = p.error
    }
  } else {
    out.error = 'host belum diisi'
  }

  // Panel lebih tahu soal power state: server bisa "running" tapi port game
  // belum siap (masih starting), jadi jangan langsung divonis offline.
  if (srv.panel !== false && srv.ownerJid) {
    const res = await resourcesFor(db, srv)
    if (res) {
      out.res = res
      out.source.push('panel')
      if (res.state === 'running') out.online = true
      else if (res.state === 'offline' || res.state === 'stopping') out.online = out.online === null ? false : out.online
    }
  }

  if (out.online === null) out.online = false
  return out
}

function bar(p) {
  if (p == null) return '—'
  const f = Math.min(100, Math.max(0, p))
  const filled = Math.round(f / 10)
  return '█'.repeat(filled) + '░'.repeat(10 - filled) + ' ' + f + '%'
}

// ---------- monitoring otomatis ----------

function mcState(db) {
  if (!db.data.monitor) db.data.monitor = {}
  if (!db.data.monitor.lastMcState) db.data.monitor.lastMcState = {}
  return db.data.monitor.lastMcState
}

function crossed(cur, prev, threshold) {
  if (cur == null || threshold == null) return false
  if (cur < threshold) return false
  return prev == null || prev < threshold
}

// Dipanggil scheduler (lib/monitor.js) setiap MC_MONITOR_INTERVAL menit.
// Mengembalikan { checked, down, alerts, adminAlerts } supaya pemanggil yang
// memutuskan ke mana pesan dikirim.
async function monitorTick(db, opts = {}) {
  const result = { checked: 0, down: 0, alerts: [], adminAlerts: [] }
  if (!config.mcEnabled) return result

  const targets = allServers(db).filter((s) => s.monitor !== false)
  if (!targets.length) return result

  const state = mcState(db)
  const byOwner = new Map()

  const push = (jid, text) => {
    if (!jid) return
    if (!byOwner.has(jid)) byOwner.set(jid, [])
    byOwner.get(jid).push(text)
  }

  for (const srv of targets) {
    let chk
    try {
      chk = await checkServer(db, srv)
    } catch (e) {
      logger.error('mc check ' + srv.identifier, e)
      continue
    }
    result.checked++
    const prev = state[srv.identifier] || {}
    const cur = {
      online: chk.online,
      ramPct: chk.res ? chk.res.ramPct : null,
      cpuPct: chk.res ? chk.res.cpuPct : null,
      players: chk.slp && chk.slp.online ? chk.slp.players.online : null,
      down: false,
      since: null,
      lastDownAlert: null,
      ts: Date.now(),
    }

    if (!chk.online) {
      // Server dianggap down sejak tick pertama, tapi alert baru dikirim pada
      // tick kedua — glitch jaringan sesaat tidak boleh jadi alert palsu.
      result.down++
      cur.down = true
      cur.since = prev.down && prev.since ? prev.since : Date.now()
      cur.lastDownAlert = prev.down ? prev.lastDownAlert || null : null

      // Alert pertama dikirim pada tick ke-2 (tick ke-1 hanya menandai, supaya
      // glitch jaringan sesaat tidak jadi alert palsu). Setelah itu bot diam
      // dan hanya mengirim pengingat tiap MC_DOWN_REMIND_MINUTES.
      const remindMs = (opts.remindEveryMs || config.mcDownRemind * 60000)
      // `prev.down` harus benar-benar true: kalau tidak, server yang baru
      // pertama kali terlihat mati langsung meneriakkan alert di tick pertama.
      const needAlert =
        prev.down === true &&
        (!prev.lastDownAlert || Date.now() - prev.lastDownAlert >= remindMs)

      if (needAlert) {
        cur.lastDownAlert = Date.now()
        const dur = MC.uptimeText(Date.now() - cur.since)
        push(
          srv.ownerJid,
          `🔴 *Server Minecraft Down*\n_${srv.name}_\nAlamat: ${srv.host || '-'}${srv.port ? ':' + srv.port : ''}\nSudah ± ${dur}` +
            (chk.error ? `\nTerakhir: ${chk.error}` : '') +
            (!prev.down ? '\n\n_Notifikasi ini tidak diulang sampai server pulih atau tiap ' + config.mcDownRemind + ' menit._' : '')
        )
        if (config.mcNotifyAdmin) {
          result.adminAlerts.push(`🔴 *MC Down* — ${srv.name} (pemilik: ${num(srv.ownerJid)})`)
        }
      }
    } else if (prev.down) {
      const dur = MC.uptimeText(Date.now() - (prev.since || prev.ts || Date.now()))
      push(srv.ownerJid, `🟢 *Server Kembali Online*\n_${srv.name}_\nDowntime ± ${dur}`)
      if (config.mcNotifyAdmin) {
        result.adminAlerts.push(`🟢 *MC Online* — ${srv.name} (pemilik: ${num(srv.ownerJid)})`)
      }
    }

    if (chk.res) {
      if (crossed(chk.res.ramPct, prev.ramPct, config.mcAlertRam)) {
        push(
          srv.ownerJid,
          `⚠️ *RAM Server Tinggi*\n_${srv.name}_ — ${chk.res.ramPct}% (${Panel.humanMB(chk.res.memoryMB)} / ${Panel.humanMB(chk.res.memoryLimitMB)})`
        )
      }
      if (crossed(chk.res.cpuPct, prev.cpuPct, config.mcAlertCpu)) {
        push(srv.ownerJid, `⚠️ *CPU Server Tinggi*\n_${srv.name}_ — ${chk.res.cpuPct}%`)
      }
    }

    state[srv.identifier] = cur
  }

  for (const [jid, list] of byOwner.entries()) {
    if (list.length) result.alerts.push({ jid, text: list.join('\n\n') })
  }
  // simpan state walau tidak ada alert, supaya tick berikutnya bisa membandingkan
  if (result.checked) db.save()
  return result
}

function num(jid) {
  return String(jid || '').split('@')[0]
}

function targetOf(db) {
  if (config.monitorNotify && config.monitorNotify.endsWith('@s.whatsapp.net')) return config.monitorNotify
  const owners = [...config.envOwners, ...(db.data.owners || [])]
  return owners[0] || null
}

// ---------- console command ----------

// Command yang boleh merusak / escalate. Pelanggan tetap bisa memakainya
// dengan flag `force` — ini server mereka sendiri, bot hanya mencegah typo.
const DANGEROUS = [
  'stop',
  'kill',
  'op',
  'deop',
  'whitelist',
  'ban',
  'ban-ip',
  'pardon',
  'reload',
  'save-off',
  'save-on',
  'difficulty',
  'gamemode',
  'datapack',
]

function isDangerous(cmd) {
  const head = String(cmd || '').trim().replace(/^\//, '').split(/\s+/)[0].toLowerCase()
  return DANGEROUS.includes(head)
}

// Kirim command lewat websocket console Wings (bekerja walau server di NAT,
// karena jalur koneksinya panel -> daemon, bukan bot -> server).
async function sendConsole(db, srv, command, onOutput) {
  const entry = srv.ownerJid ? getEntry(db, srv.ownerJid) : null
  if (!entry || !entry.token) return { error: 'server ini tidak terhubung ke panel (tidak ada Client API key)' }

  let WebSocket
  try {
    WebSocket = require('ws')
  } catch (_) {
    return { error: 'modul "ws" belum terpasang di server bot (jalankan `npm install`)' }
  }

  const prev = config.panelClientToken
  config.panelClientToken = entry.token
  let cred
  try {
    cred = await Panel.clientConsoleUrl(srv.identifier)
  } finally {
    config.panelClientToken = prev
  }
  if (!cred || cred.error) return { error: (cred && cred.error) || 'gagal mengambil kredensial console' }

  return new Promise((resolve) => {
    const lines = []
    let finished = false
    let ws = null
    const finish = (payload) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      try {
        if (ws) ws.close()
      } catch (_) {}
      try {
        if (daemon) daemon.close()
      } catch (_) {}
      resolve(payload)
    }
    const timer = setTimeout(
      () => finish({ error: lines.length ? null : 'timeout menunggu console', lines }),
      8000
    )

    const handleLine = (msg) => {
      if (!msg || msg.startsWith('>')) return // abaikan prompt kosong
      lines.push(msg)
      if (onOutput) {
        try {
          onOutput(msg)
        } catch (_) {}
      }
    }

    const openDaemon = (url, token) => {
      daemon = new WebSocket(url)
      daemon.on('message', (raw) => {
        let msg
        try {
          msg = JSON.parse(String(raw))
        } catch (_) {
          return
        }
        if (msg.event === 'console') (msg.args || []).forEach(handleLine)
        else if (msg.event === 'daemon error') handleLine('[daemon] ' + (msg.args || []).join(' '))
      })
      daemon.on('open', () => {
        try {
          daemon.send(JSON.stringify({ event: 'auth', args: [token] }))
        } catch (_) {}
        setTimeout(() => {
          try {
            daemon.send(JSON.stringify({ event: 'send command', args: [command] }))
          } catch (_) {}
          // beri waktu daemon mengirim output, lalu selesaikan
          setTimeout(() => finish({ lines }), 2500)
        }, 600)
      })
      daemon.on('error', (e) => finish({ error: 'daemon ws: ' + e.message, lines }))
    }

    let daemon = null
    try {
      ws = new WebSocket(cred.socket)
    } catch (e) {
      return finish({ error: 'gagal membuka websocket: ' + e.message })
    }
    let authed = false
    ws.on('message', (raw) => {
      let msg
      try {
        msg = JSON.parse(String(raw))
      } catch (_) {
        return
      }
      if (!authed && msg.event === 'auth') {
        authed = true
        try {
          ws.send(JSON.stringify({ event: 'auth', args: [cred.token] }))
        } catch (_) {}
        return
      }
      if (msg.event === 'token' && msg.data) {
        finish({ error: 'tidak bisa menyambung ke daemon: ' + msg.data })
        return
      }
      if (msg.event === 'socket' && msg.data && msg.data.socket) {
        openDaemon(msg.data.socket, msg.data.token)
      }
    })
    ws.on('error', (e) => finish({ error: 'websocket panel: ' + e.message, lines }))
    ws.on('close', () => {
      if (!daemon) finish({ error: 'koneksi console ditutup panel', lines })
    })
  })
}

// Kirim command lewat RCON (opsional; butuh enable-rcon=true + port terbuka)
async function sendRcon(srv, command) {
  const host = srv.rcon && srv.rcon.host ? srv.rcon.host : srv.host
  const port = (srv.rcon && srv.rcon.port) || 25575
  const password = srv.rcon && srv.rcon.password
  if (!host) return { error: 'host server belum diisi' }
  if (!password) {
    return {
      error:
        'RCON belum diset. Pakai: `' +
        config.prefix +
        'mcrcon ' +
        srv.name +
        ' <port> <password>`',
    }
  }
  try {
    const res = await MC.rcon(host, port, password, command, { timeout: config.mcPingTimeout })
    return { lines: res.map((r) => r.response).filter(Boolean) }
  } catch (e) {
    return { error: e.message }
  }
}

// Cek apakah sebuah host:port bisa dihubungi (dipakai .mcrcon test / diagnosa)
function tcpProbe(host, port, timeout = 4000) {
  return new Promise((resolve) => {
    const sock = new net.Socket()
    let done = false
    const fin = (ok, err) => {
      if (done) return
      done = true
      clearTimeout(t)
      sock.destroy()
      resolve({ ok, error: err })
    }
    const t = setTimeout(() => fin(false, 'timeout ' + timeout + 'ms'), timeout)
    sock.setTimeout(timeout)
    sock.on('connect', () => fin(true))
    sock.on('timeout', () => fin(false, 'timeout ' + timeout + 'ms'))
    sock.on('error', (e) => fin(false, e.code === 'ECONNREFUSED' ? 'port tertutup' : e.message))
    sock.connect(port, host)
  })
}

module.exports = {
  store,
  getEntry,
  setEntry,
  delEntry,
  allServers,
  serverOf,
  countFor,
  listFromPanel,
  resourcesFor,
  registerServer,
  removeServer,
  resolveServer,
  maskToken,
  address,
  checkServer,
  monitorTick,
  targetOf,
  bar,
  num,
  isDangerous,
  DANGEROUS,
  sendConsole,
  sendRcon,
  tcpProbe,
}
