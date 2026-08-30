const { getBody, getMediaType, downloadMedia } = require('./lib/message')
const func = require('./lib/func')
const config = require('./config')
const logger = require('./lib/logger')
const moderation = require('./lib/moderation')
const Assistant = require('./lib/assistant')
const NodeCache = require('node-cache')

// Cache metadata grup (TTL 60 detik)
const metaCache = new NodeCache({ stdTTL: 60, checkperiod: 30 })
// cooldown per command per user
const cooldown = new NodeCache({ checkperiod: 10 })
// rate limit per user (hit/menit)
const rateBucket = new Map()

async function buildM(sock, M, db, loader) {
  const message = M.message || {}
  const m = {
    raw: M,
    sock,
    conn: sock,
    db,
    config,
    func,
    loader,
    message,
    key: M.key,
    chat: M.key.remoteJid,
    fromMe: M.key.fromMe,
    isGroup: (M.key.remoteJid || '').endsWith('@g.us'),
    id: M.key.id,
    messageTimestamp: M.messageTimestamp,
    pushName: M.pushName || '',
  }

  m.body = getBody(message)
  m.text = m.body
  m.media = getMediaType(message)

  // Referensi pesan lengkap untuk opsi `quoted` — Baileys butuh {key, message},
  // bukan key saja (kalau hanya key -> error "reading 'fromMe'").
  m.quotedRef = { key: M.key, message }

  // sender
  if (m.isGroup) {
    m.sender = M.key.participant || M.key.remoteJid
  } else {
    m.sender = M.key.remoteJid
  }

  // mention
  m.mentionedJid =
    message?.extendedTextMessage?.contextInfo?.mentionedJid ||
    message?.groupMentionedMessage?.contextInfo?.mentionedJid ||
    []

  // quoted message
  m.quoted = null
  const qctx = message?.extendedTextMessage?.contextInfo
  if (qctx && qctx.quotedMessage) {
    const qKey = {
      remoteJid: m.chat,
      fromMe: qctx.participant === (sock.user && sock.user.id),
      id: qctx.stanzaId,
      participant: qctx.participant,
    }
    m.quoted = {
      key: qKey,
      message: qctx.quotedMessage,
      sender: qctx.participant || '',
      // Pesan yang DITERUSKAN dari grup lain ke bot: WhatsApp menaruh JID asal
      // di contextInfo.remoteJid. Dipakai `.groupaccess add` (owner forwarded
      // pesan grup -> bot tahu grup mana yang dimaksud) tanpa perlu tahu JID.
      originJid: qctx.remoteJid || M.key.remoteJid,
      body: getBody(qctx.quotedMessage),
      media: getMediaType(qctx.quotedMessage),
      download: async () => downloadMedia(m.quoted.media, logger),
      reply: async (text) => {
        const opt = { quoted: { key: qKey, message: m.quoted.message } }
        if (m.mentionedJid && m.mentionedJid.length) opt.mentions = m.mentionedJid
        return sock.sendMessage(m.chat, { text }, opt)
      },
    }
  }

  // helpers
  m.reply = async (text, opt = {}) => {
    const o = { quoted: m.quotedRef, ...opt }
    return sock.sendMessage(m.chat, { text }, o)
  }
  m.replyMedia = async (content, opt = {}) => sock.sendMessage(m.chat, content, { quoted: m.quotedRef, ...opt })
  m.react = async (emoji) => sock.sendMessage(m.chat, { react: { text: emoji, key: M.key } }).catch(() => {})
  m.download = async () => (m.media ? downloadMedia(m.media, logger) : m.quoted ? m.quoted.download() : null)

  // metadata grup (dengan cache)
  m.getMeta = async () => {
    if (!m.isGroup) return null
    const cached = metaCache.get(m.chat)
    if (cached) return cached
    try {
      const meta = await sock.groupMetadata(m.chat)
      metaCache.set(m.chat, meta)
      return meta
    } catch {
      return null
    }
  }

  // parse command
  m.prefix = ''
  m.command = ''
  m.args = ''
  m.query = ''
  if (typeof m.body === 'string' && m.body.length > 0) {
    const body = m.body.startsWith(config.prefix)
      ? m.body.slice(config.prefix.length)
      : m.body
    if (m.body.startsWith(config.prefix)) {
      m.prefix = config.prefix
      // Ambil command (kata pertama) saja, SISANYA dipertahankan apa adanya
      // supaya newline multi-line tetap utuh (mis. template promosi panjang).
      const tb = body.trim()
      const sp = tb.search(/\s/)
      m.command = (sp >= 0 ? tb.slice(0, sp) : tb).toLowerCase()
      m.args = sp >= 0 ? tb.slice(sp + 1).trim() : ''
      m.query = m.args
      m.argsArr = m.args ? m.args.split(/\s+/).filter(Boolean) : []
    }
  }

  // ====== LID resolution + permission (dihitung setelah metadata grup) ======
  m.isAdmin = false
  m.isBotAdmin = false
  m.groupName = ''
  // Daftar peserta ikut disimpan supaya lapisan lain (GroupAccess / Routing)
  // tidak perlu memanggil groupMetadata dua kali untuk satu pesan.
  m.__participants = []
  m.__admins = []
  if (m.isGroup) {
    const meta = await m.getMeta()
    m.groupName = meta?.subject || ''
    const participants = meta && Array.isArray(meta.participants) ? meta.participants : []
    m.__participants = participants
    m.__admins = participants
      .filter((p) => p && (p.admin === 'admin' || p.admin === 'superadmin'))
      .map((p) => p.jid || p.id)
      .filter(Boolean)
    // WhatsApp LID (Linked Identity): di grup dgn fitur "sembunyikan nomor",
    // pesan datang dgn participant @lid. Resolve ke nomor asli @s.whatsapp.net
    // supaya owner/admin check cocok dgn daftar berbasis nomor telepon.
    if (m.sender && m.sender.endsWith('@lid')) {
      m.sender = func.resolveLid(m.sender, participants)
    }
    if (m.quoted && m.quoted.sender && m.quoted.sender.endsWith('@lid')) {
      m.quoted.sender = func.resolveLid(m.quoted.sender, participants)
    }
    // daftar admin (pakai jid/phone biar konsisten dgn m.sender yg sudah di-resolve)
    const adminJids = participants
      .filter((p) => p.admin === 'admin' || p.admin === 'superadmin')
      .map((p) => p.jid || p.id)
    const me = sock.user && sock.user.id ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : ''
    m.isBotAdmin = adminJids.includes(me)
    m.isAdmin = adminJids.includes(m.sender)
  }
  m.isOwner = func.isOwner(m.sender, db)
  m.isCmd = !!m.command

  return m
}

// bucket rate-limit dibersihkan berkala supaya Map tidak tumbuh selamanya
// (satu entri per pengirim unik, sebelumnya tidak pernah dihapus)
function pruneRateBuckets(now = Date.now()) {
  for (const [k, v] of rateBucket.entries()) {
    if (now - v.start > 120000) rateBucket.delete(k)
  }
  return rateBucket.size
}
setInterval(pruneRateBuckets, 120000).unref()

// Command yang argumennya mengandung rahasia (API key, password RCON, token
// panel). Nilai disamarkan sebelum ditulis ke data/logs/*_command.log supaya
// kredensial tidak menumpuk di file log.
const SECRET_CMDS = new Set([
  'aiset', 'aiconfig', 'aikonfig',
  'mcrcon', 'setrcon', 'mclink', 'mcreg', 'mcregister', 'mclogin',
  // Instruksi/memori/persona agent dapat berisi konteks pribadi owner. Masker
  // juga melindungi percobaan menyimpan token yang nantinya ditolak oleh kode.
  'asisten', 'assistant', 'agent', 'bantuaku',
  'agentset', 'asistenset', 'agentconfig',
  'persona', 'kepribadian', 'identity', 'identitas',
])

const PRIVATE_TEXT_CMDS = new Set([
  'asisten', 'assistant', 'agent', 'bantuaku',
  'agentset', 'asistenset', 'agentconfig',
  'persona', 'kepribadian', 'identity', 'identitas',
])

function logSafe(m) {
  const args = m.args || ''
  if (!SECRET_CMDS.has(m.command) || !args) return args
  if (PRIVATE_TEXT_CMDS.has(m.command)) return `[private:${args.length} chars]`
  const sp = args.search(/\s/)
  if (sp < 0) return args
  const sub = args.slice(0, sp)
  const rest = args.slice(sp + 1).trim()
  if (!rest) return args
  return `${sub} ${rest.length <= 8 ? '***' : rest.slice(0, 3) + '***' + rest.slice(-2)}`
}

function checkRateLimit(sender) {
  const now = Date.now()
  let bucket = rateBucket.get(sender)
  if (!bucket) {
    bucket = { start: now, count: 0 }
    rateBucket.set(sender, bucket)
  }
  if (now - bucket.start > 60000) {
    bucket.start = now
    bucket.count = 0
  }
  bucket.count++
  return bucket.count <= 25 // max 25 command/menit
}

async function handle(sock, db, loader, M) {
  if (!M.message) return
  let m
  try {
    m = await buildM(sock, M, db, loader)
  } catch (e) {
    logger.error('buildM', e)
    return
  }

  // register user
  if (m.sender) db.registerUser(m.sender, m.pushName)

  // ====== AFK SYSTEM ======
  if (m.sender && db.data.afk[m.sender] && !m.fromMe) {
    const afk = db.data.afk[m.sender]
    delete db.data.afk[m.sender]
    db.save()
    const dur = m.func.uptime(Date.now() - afk.time)
    try {
      await m.sock.sendMessage(m.chat, {
        text: `✅ @${m.sender.split('@')[0]} *kembali dari AFK*.\nDurasi: ${dur}\nAlasan: ${afk.reason || '-'}`,
        mentions: [m.sender],
      })
    } catch (_) {}
  }
  // Tag seseorang yang sedang AFK
  if (m.isGroup && Array.isArray(m.mentionedJid) && m.mentionedJid.length) {
    for (const jid of m.mentionedJid) {
      if (db.data.afk[jid]) {
        const a = db.data.afk[jid]
        const dur = m.func.uptime(Date.now() - a.time)
        await m
          .reply(`💤 @${jid.split('@')[0]} sedang *AFK*.\nAlasan: ${a.reason || '-'}\nDurasi: ${dur}`)
          .catch(() => {})
      }
    }
  }
  // ====== AUTO FAQ ======
  if (!m.isCmd && m.isGroup) {
    try {
      const g = db.getGroup(m.chat)
      if (g.autofaq && db.data.faq.length && m.body) {
        const lower = m.body.toLowerCase()
        const hit = db.data.faq.find((f) => f.q && lower.includes(f.q.toLowerCase()))
        if (hit) await m.reply('💬 *FAQ:* ' + hit.a).catch(() => {})
      }
    } catch (_) {}
  }

  // ====== MODERASI (jalan duluan, bahkan untuk non-command) ======
  try {
    await moderation.run(sock, db, m)
  } catch (e) {
    logger.error('moderation', e)
  }

  // ====== PERSONAL AGENT AUTO-CHAT ======
  // Private chat: hanya owner, dan hanya bila owner menyalakan auto-chat.
  // Grup: hanya grup yang didaftarkan owner (.groupaccess) dengan auto-reply
  // aktif, peran yang memenuhi batas role, dan (default) pesan yang men-tag bot.
  // Selain itu tidak ada pesan yang diam-diam memakai kuota AI / menjalankan alat.
  if (!m.isCmd && Assistant.shouldAutoChat(m)) {
    try {
      await Assistant.respond(m, m.body)
    } catch (e) {
      logger.error('assistant auto-chat', e)
    }
    return
  }

  if (!m.isCmd) return

  // blacklist
  if (db.data.blacklist.users.includes(m.sender)) return m.reply('🚫 Kamu diblacklist dari bot.').catch(() => {})
  if (m.isGroup && db.data.blacklist.groups.includes(m.chat)) return

  // rate limit
  if (!m.isOwner && !checkRateLimit(m.sender)) {
    return m.reply('⏳ Terlalu banyak command. Tunggu sebentar (rate limit).').catch(() => {})
  }

  // resolve command
  const cmd = loader.resolve(m.command)
  if (!cmd) return

  // cooldown (bukan owner)
  if (cmd.cooldown && !m.isOwner) {
    const key = `${m.sender}:${cmd.name}`
    const left = cooldown.get(key)
    if (left) return m.react('⏳').catch(() => {})
    cooldown.set(key, true, cmd.cooldown)
  }

  // validasi tipe chat
  if (cmd.isGroup && !m.isGroup) return m.reply('⚠️ Command ini hanya bisa dipakai di grup.')
  if (cmd.isPrivate && m.isGroup) return m.reply('⚠️ Command ini hanya bisa dipakai di private chat.')

  // permission
  if (cmd.isOwner && !m.isOwner) return m.reply('⛔ Command khusus *Owner*.')
  if (cmd.isAdmin && m.isGroup && !m.isAdmin && !m.isOwner) return m.reply('⛔ Command khusus *Admin Grup*.')
  if (cmd.isBotAdmin && m.isGroup && !m.isBotAdmin) return m.reply('⛔ Bot harus jadi *Admin Grup* untuk command ini.')

  // mute check (kecuali admin/owner & command moderasi)
  if (m.isGroup && !m.isOwner && !m.isAdmin) {
    const g = db.getGroup(m.chat)
    if (g.mute && cmd.category !== 'moderation' && cmd.category !== 'admin') {
      return m.reply('🔇 Grup sedang dimute, command dinonaktifkan.').catch(() => {})
    }
  }

  // log + stats
  const from = m.isGroup ? m.groupName : 'PRIVATE'
  logger.cmd(`[${from}] ${m.sender.split('@')[0]}: ${config.prefix}${m.command} ${logSafe(m)}`)

  // jalankan
  try {
    await cmd.run(m, {
      conn: sock,
      text: m.args,
      args: m.argsArr || [],
      command: m.command,
      db,
      config,
      func,
      loader,
    })
    db.data.stats.commands += 1
    db.data.stats.commandsSession += 1
    db.data.cmdUsage[cmd.name] = (db.data.cmdUsage[cmd.name] || 0) + 1
    db.save()
  } catch (e) {
    logger.error(`command ${cmd.name}`, e)
    m.reply(`❌ Terjadi error saat menjalankan *${cmd.name}*:\n${e.message}`).catch(() => {})
  }
}

/**
 * Batalkan cache metadata sebuah grup.
 * Dipanggil saat ada join/leave/promote/demote supaya pemeriksaan admin
 * tidak memakai data lama sampai 60 detik.
 */
function invalidateMeta(jid) {
  if (jid) metaCache.del(jid)
}

module.exports = { handle, buildM, invalidateMeta }
// hook kecil untuk test
module.exports._rateBucket = rateBucket
module.exports._pruneRateBuckets = pruneRateBuckets
module.exports._logSafe = logSafe
