const NetProbe = require('../../lib/netprobe')
const config = require('../../config')
const logger = require('../../lib/logger')

// Ping ke alamat LUAR (IP/domain pelanggan/internet), bukan latency bot (.ping)
// dan bukan cek HTTP ke panel node (.pingnode). Dipakai owner untuk menjawab
// "internet di node lambat tidak?" atau "port 25565 pelanggan terbuka tidak?".
//
// Alamat selalu berasal dari input manusia (owner/staf) dan melewati
// NetProbe.parseTarget + spawn tanpa shell, jadi tidak ada jalur dari chat ke
// perintah shell.
const MAX_TARGETS = 5

function store(db) {
  if (!db || !db.data) return null
  if (!db.data.pingl || typeof db.data.pingl !== 'object') db.data.pingl = {}
  const p = db.data.pingl
  if (!Array.isArray(p.staff)) p.staff = []
  if (!p.stats || typeof p.stats !== 'object') p.stats = { runs: 0, failed: 0, lastAt: 0, lastHost: '' }
  return p
}

function envStaff() {
  return String(process.env.PINGL_STAFF || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => config.toJid(x))
    .filter(Boolean)
}

function allowed(m, db) {
  if (m.isOwner) return true
  // Dipakai lewat Personal Agent di grup yang sudah diizinkan owner: alat ini
  // berisiko read-only dan hasilnya diarahkan sesuai rute grup, jadi boleh jalan.
  if (m.agentAuthorized) return true
  const s = store(db)
  const list = [...envStaff(), ...((s && s.staff) || [])]
  return list.includes(m.sender)
}

module.exports = {
  name: 'pingl',
  aliases: ['pingluar', 'pinghost', 'pingnet', 'extping'],
  category: 'monitoring',
  cooldown: 4,
  desc: 'Ping IP/domain luar (bisa cek port juga) — khusus owner & staf.',
  use: '<ip|domain[:port]> [jumlah] | <a.com, b.com> | mode <icmp|tcp> | staff <add|del|list> | help',
  run: async (m) => {
    const db = m.db
    const s = store(db)
    const raw = String(m.args || '').trim()
    const P = m.config.prefix

    const sub = raw.split(/\s+/)[0] ? raw.split(/\s+/)[0].toLowerCase() : ''
    if (sub === 'staff' || sub === 'staf') return staffCommand(m, s, P)
    if (!raw || sub === 'help' || sub === 'bantuan' || sub === '?') return m.reply(helpText(m, s, P))

    if (!allowed(m, db)) {
      return m.reply(
        '⛔ *Ping keluar* hanya untuk owner dan staf yang didaftarkan.\n' +
          `Owner bisa menambah staf: \`${P}pingl staff add <nomor>\``
      )
    }

    // mode tcp/icmp opsional di depan: ".pingl mode tcp 1.1.1.1:443"
    let text = raw
    let mode = 'auto'
    const modeMatch = text.match(/^mode\s+(tcp|icmp|auto)\b/i)
    if (modeMatch) {
      mode = modeMatch[1].toLowerCase()
      text = text.slice(modeMatch[0].length).trim()
    }

    const parts = text
      .split(/[\n,]+/)
      .map((x) => x.trim())
      .filter(Boolean)
    if (!parts.length) return m.reply(helpText(m, s, P))
    if (parts.length > MAX_TARGETS) {
      return m.reply(`⚠️ Maksimal ${MAX_TARGETS} alamat sekaligus (biar tidak lama). Kirim bertahap ya.`)
    }

    await m.react('📡').catch(() => {})
    // Beberapa alamat sekaligus -> 2 paket per alamat supaya total waktunya tetap singkat
    const count = parts.length > 1 ? 2 : undefined
    const blocks = []
    let allOk = true
    for (const part of parts) {
      const result = await NetProbe.probe(part, { mode, count, timeoutSec: Number(process.env.PING_TIMEOUT || 2) })
      if (result.invalid) {
        // Alamat ditolak sebelum ada perintah apa pun dijalankan.
        return m.reply(`⚠️ *Alamat ditolak* untuk \`${part.slice(0, 80)}\`\n\n${result.error}\n\nContoh yang benar: \`${P}pingl 8.8.8.8\` atau \`${P}pingl mc.example.com:25565\``)
      }
      if (!result.ok) allOk = false
      blocks.push(NetProbe.format(result, { prefix: P }))
    }
    s.stats.runs = (s.stats.runs || 0) + 1
    if (!allOk) s.stats.failed = (s.stats.failed || 0) + 1
    s.stats.lastAt = Date.now()
    s.stats.lastHost = parts.join(', ').slice(0, 200)
    db.save()

    const label = parts.length > 1 ? `\n\n${'─'.repeat(18)}\n\n` : ''
    const body = blocks.join(parts.length > 1 ? label : '')
    logger.cmd(`[PINGL] ${String(m.sender || '-').split('@')[0]}: ${parts.join(', ').slice(0, 200)}`)
    return m.reply(body.slice(0, 3800))
  },
}

function staffCommand(m, s, P) {
  if (!m.isOwner) return m.reply('⛔ Daftar staf ping hanya bisa diubah *Owner*.')
  const parts = (m.args || '').split(/\s+/).filter(Boolean)
  const act = String(parts[1] || '').toLowerCase()
  if (!act || act === 'list') {
    const env = envStaff()
    const rows = [...new Set([...env, ...s.staff])]
    if (!rows.length) return m.reply(`Belum ada staf. Tambah: \`${P}pingl staff add 0812xxxx\``)
    return m.reply(
      `👤 *STAF PING* (${rows.length}) — boleh memakai \`${P}pingl\`\n` +
        rows.map((j) => `• ${String(j).split('@')[0]}${env.includes(j) ? ' (dari .env)' : ''}`).join('\n')
    )
  }
  const jid = m.func && typeof m.func.jidFromInput === 'function' ? m.func.jidFromInput(parts.slice(2).join(' ')) : ''
  if (!jid) return m.reply(`Contoh: \`${P}pingl staff ${act} 081234567890\``)
  if (act === 'add' || act === 'tambah') {
    if (s.staff.includes(jid)) return m.reply(`ℹ️ ${jid.split('@')[0]} sudah ada di daftar staf.`)
    s.staff.push(jid)
    m.db.save()
    return m.reply(`✅ ${jid.split('@')[0]} sekarang staf — boleh memakai \`${P}pingl\`.`)
  }
  if (act === 'del' || act === 'hapus' || act === 'remove') {
    const i = s.staff.indexOf(jid)
    if (i < 0) return m.reply(`ℹ️ ${jid.split('@')[0]} bukan staf yang didaftarkan lewat command (cek .env PINGL_STAFF).`)
    s.staff.splice(i, 1)
    m.db.save()
    return m.reply(`🧹 ${jid.split('@')[0]} tidak lagi menjadi staf.`)
  }
  return m.reply(`Pilihan: \`list\`, \`add <nomor>\`, \`del <nomor>\`.`)
}

function helpText(m, s, P) {
  const cfg = NetProbe.LIMITS
  const stats = s.stats || {}
  return (
    `📡 *PING LUAR (pingl)*\n\n` +
    `Cek latensi/keberadaan host dari server bot:\n` +
    `  ${P}pingl 8.8.8.8\n` +
    `  ${P}pingl google.com 8            # 8 paket (maks ${cfg.count.max})\n` +
    `  ${P}pingl mc.tokosugoi.id:25565    # cek port terbuka/tidak\n` +
    `  ${P}pingl 1.1.1.1, 8.8.8.8, google.com   # beberapa sekaligus (maks ${MAX_TARGETS})\n` +
    `  ${P}pingl mode tcp 1.1.1.1:443    # paksa handshake TCP\n` +
    `  ${P}pingl mode icmp google.com    # ICMP saja (tanpa fallback)\n\n` +
    `Catatan:\n` +
    `• Beda dengan ${P}ping (latensi bot) dan ${P}pingnode (HTTP ke panel node).\n` +
    `• Kalau container tidak boleh bikin raw socket, otomatis jatuh ke mode TCP.\n` +
    `• Perintah & host yang diuji dicatat ke data/logs/command.log.\n` +
    (m.isOwner
      ? `\nStaf yang boleh memakai: ${[...new Set([...envStaff(), ...s.staff])].length || 0}\n` +
        `  ${P}pingl staff add 0812xxxx | del 0812xxxx | list\n`
      : '') +
    `\nPemakaian: ${stats.runs || 0} tes${stats.failed ? `, ${stats.failed} gagal` : ''}${stats.lastAt ? ` · terakhir ${new Date(stats.lastAt).toLocaleString('id-ID')} (${stats.lastHost || '-'})` : ''}`
  )
}
