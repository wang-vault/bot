const crypto = require('crypto')
const Ai = require('./ai')
const Persona = require('./persona')
const logger = require('./logger')

const MODES = Object.freeze(['chat', 'supervised', 'safe', 'autonomous'])
const RISK_LABEL = Object.freeze({
  read: 'baca-saja',
  write: 'operasional',
  high: 'sensitif',
  blocked: 'diblokir',
})

// Command yang boleh dipilih AI. Semua command di luar daftar ini tetap bisa
// dipakai owner secara manual, tetapi tidak pernah dapat dipanggil model.
// Ini batas keamanan terpenting: prompt injection tidak bisa mencapai .exec,
// .eval, pengaturan owner, restore DB, token panel/RCON, atau konfigurasi AI.
const TOOL_RULES = Object.freeze({
  ping: 'read',
  runtime: 'read',
  infobot: 'read',
  stats: 'read',
  topcmd: 'read',
  status: 'read',
  resource: 'read',
  servers: 'read',
  nodespec: 'read',
  paneltest: 'read',
  selfcheck: 'read',
  paket: 'read',
  vps: 'read',
  dedicated: 'read',
  publicip: 'read',
  website: 'read',
  kontak: 'read',
  linkgc: 'read',
  faq: 'read',
  jamop: 'read',
  promostats: 'read',
  listfeedback: 'read',
  listlaporan: 'read',
  mcservers: 'read',
  mcstatus: 'read',
  mcplayers: 'read',
  mcres: 'read',

  // Tindakan operasional non-destruktif. Mode autonomous boleh menjalankannya.
  checkmonitor: 'write',
  backup: 'write',

  // Konfigurasi antarmuka dapat membuat owner kehilangan akses jika model
  // salah memahami instruksi, jadi selalu tampilkan preview + approval.
  setprefix: 'high',

  // Selalu butuh persetujuan eksplisit, bahkan di mode autonomous.
  mcpower: 'high',
  maintenance: 'high',
  promo: 'high',
  broadcast: 'high',
  gitpull: 'high',
  restart: 'high',
  join: 'high',
})

const _busy = new Set()

function boolEnv(name, fallback) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  return !['0', 'false', 'off', 'no'].includes(String(raw).trim().toLowerCase())
}

function numEnv(name, fallback) {
  const n = Number(process.env[name])
  return Number.isFinite(n) ? n : fallback
}

function store(db) {
  const a = Persona.assistantStore(db)
  if (!a) return null
  if (!a.pending || typeof a.pending !== 'object' || Array.isArray(a.pending)) a.pending = {}
  if (!a.stats || typeof a.stats !== 'object') {
    a.stats = { chats: 0, actions: 0, approvals: 0, rejected: 0, failed: 0, lastAt: 0 }
  }
  if (!a.guardian || typeof a.guardian !== 'object') a.guardian = {}
  return a
}

function resolve(db) {
  const s = store(db) || {}
  const envMode = String(process.env.ASSISTANT_MODE || 'safe').trim().toLowerCase()
  const mode = MODES.includes(String(s.mode || '').toLowerCase())
    ? String(s.mode).toLowerCase()
    : MODES.includes(envMode)
      ? envMode
      : 'safe'
  return {
    enabled: s.enabled === true || s.enabled === false ? s.enabled : boolEnv('ASSISTANT_ENABLED', true),
    mode,
    autoChat: s.autoChat === true || s.autoChat === false ? s.autoChat : boolEnv('ASSISTANT_AUTO_CHAT', false),
    maxActions: Math.max(1, Math.min(5, Math.round(numEnv('ASSISTANT_MAX_ACTIONS', 3)))),
    pendingMinutes: Math.max(2, Math.min(60, Math.round(numEnv('ASSISTANT_APPROVAL_MINUTES', 10)))),
  }
}

function setOption(db, key, value) {
  const s = store(db)
  if (!s) return { ok: false, error: 'Database tidak tersedia.' }
  if (key === 'enabled' || key === 'autoChat') {
    if (value !== true && value !== false) return { ok: false, error: 'Nilai harus on atau off.' }
    s[key] = value
  } else if (key === 'mode') {
    const mode = String(value || '').toLowerCase()
    if (!MODES.includes(mode)) return { ok: false, error: `Mode harus: ${MODES.join(', ')}.` }
    s.mode = mode
  } else {
    return { ok: false, error: `Pengaturan "${key}" tidak dikenal.` }
  }
  db.save()
  return { ok: true, key, value: s[key] }
}

function policyFor(command, args = '') {
  const name = String(command || '').toLowerCase()
  // Dua command mempunyai subcommand baca dan tulis dalam file yang sama.
  if (name === 'promoset') {
    const sub = String(args || '').trim().split(/\s+/)[0].toLowerCase()
    // Mengaktifkan scheduler dapat mengirim pesan massal beberapa saat kemudian.
    return !sub || sub === 'status' ? 'read' : 'high'
  }
  if (name === 'selfcheck' && /^(deep|full|test)\b/i.test(String(args || '').trim())) return 'write'
  if (name === 'mcadmin') {
    const sub = String(args || '').trim().split(/\s+/)[0].toLowerCase()
    if (!sub || sub === 'list' || sub === 'check') return sub === 'check' ? 'write' : 'read'
    return 'high'
  }
  return TOOL_RULES[name] || 'blocked'
}

function canonicalAction(loader, action) {
  const requested = String(action && action.command || '').trim().toLowerCase().replace(/^\W+/, '')
  const args = String(action && action.args || '').replace(/\0/g, '').trim().slice(0, 2000)
  if (!requested || !loader || typeof loader.resolve !== 'function') return null
  const cmd = loader.resolve(requested)
  if (!cmd || !cmd.name) return { command: requested, args, cmd: null, risk: 'blocked' }
  const name = String(cmd.name).toLowerCase()
  // Agent selalu beroperasi dari DM owner. Command yang mensyaratkan konteks
  // grup/admin tidak boleh dibypass hanya karena run() dipanggil langsung.
  const contextBlocked = !!(cmd.isGroup || cmd.isAdmin || cmd.isBotAdmin)
  return { command: name, args, cmd, risk: contextBlocked ? 'blocked' : policyFor(name, args) }
}

function canRunAutomatically(mode, risk) {
  if (risk === 'read') return mode === 'safe' || mode === 'autonomous'
  if (risk === 'write') return mode === 'autonomous'
  return false
}

function cleanPending(db, now = Date.now()) {
  const s = store(db)
  if (!s) return 0
  let changed = false
  for (const [id, item] of Object.entries(s.pending)) {
    if (!item || Number(item.expiresAt || 0) <= now) {
      delete s.pending[id]
      changed = true
    }
  }
  if (changed) db.save()
  return Object.keys(s.pending).length
}

function actionId(pending) {
  let id
  do {
    id = crypto.randomBytes(3).toString('hex').toUpperCase()
  } while (pending[id])
  return id
}

function queueAction(m, action, reason = '') {
  const s = store(m.db)
  cleanPending(m.db)
  // Batasi antrean persetujuan agar spam instruksi owner maupun respons model
  // yang buruk tidak dapat membengkakkan database tanpa batas.
  const existing = Object.values(s.pending).sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))
  while (existing.length >= 30) {
    const oldest = existing.shift()
    if (oldest) delete s.pending[oldest.id]
  }
  const cfg = resolve(m.db)
  const id = actionId(s.pending)
  s.pending[id] = {
    id,
    command: action.command,
    args: action.args,
    risk: action.risk,
    reason: String(reason || '').slice(0, 300),
    requestedBy: m.sender,
    chat: m.chat,
    createdAt: Date.now(),
    expiresAt: Date.now() + cfg.pendingMinutes * 60 * 1000,
  }
  m.db.save()
  return s.pending[id]
}

function pendingList(db) {
  cleanPending(db)
  const s = store(db)
  return Object.values((s && s.pending) || {}).sort((a, b) => a.createdAt - b.createdAt)
}

function formatPending(db, prefix = '.') {
  const list = pendingList(db)
  if (!list.length) return '✅ Tidak ada tindakan yang menunggu persetujuan.'
  let text = `🛂 *MENUNGGU PERSETUJUAN* (${list.length})\n\n`
  for (const item of list.slice(0, 15)) {
    const left = Math.max(0, Math.ceil((item.expiresAt - Date.now()) / 60000))
    text += `• *${item.id}* — \`${prefix}${item.command}${item.args ? ' ' + item.args : ''}\`\n`
    text += `  Risiko: ${RISK_LABEL[item.risk] || item.risk} | kedaluwarsa ${left} menit\n`
    if (item.reason) text += `  Alasan: ${item.reason}\n`
  }
  text += `\nSetujui: \`${prefix}approve <ID>\`\nTolak: \`${prefix}reject <ID>\``
  return text.trim()
}

function commandCatalog(m) {
  const cfg = resolve(m.db)
  if (cfg.mode === 'chat') return '(mode chat: tidak ada command yang boleh dipanggil)'
  const rows = []
  const names = new Set([...Object.keys(TOOL_RULES), 'promoset', 'mcadmin'])
  for (const name of names) {
    const normalized = canonicalAction(m.loader, { command: name, args: '' })
    const cmd = normalized && normalized.cmd
    if (!cmd || cmd.name !== name || normalized.risk === 'blocked') continue
    const use = cmd.use ? ` ${cmd.use}` : ''
    const risk = name === 'promoset' || name === 'mcadmin' ? 'tergantung subcommand' : RISK_LABEL[policyFor(name)]
    rows.push(`- ${name}${use} | ${risk} | ${cmd.desc || ''}`)
  }
  return rows.join('\n') || '(tidak ada command tersedia)'
}

function plannerPrompt(m) {
  const cfg = resolve(m.db)
  const persona = Persona.systemPrompt(m.db, '', {
    isOwner: true,
    isGroup: false,
    groupName: '',
  })
  return `${persona}

Kamu sekarang berada dalam Agent Mode untuk membantu owner. Kamu boleh memilih command yang tersedia sebagai alat. Sistem, bukan kamu, yang menentukan apakah alat langsung dijalankan atau harus disetujui.

Mode otonomi saat ini: ${cfg.mode}.
- chat: hanya berbicara, jangan pilih command.
- supervised: semua tindakan akan meminta persetujuan.
- safe: command baca-saja berjalan otomatis; lainnya meminta persetujuan.
- autonomous: command baca-saja dan operasional berjalan otomatis; tindakan sensitif tetap meminta persetujuan.

BALAS HANYA DENGAN SATU OBJEK JSON VALID tanpa markdown dan tanpa teks di luar JSON:
{"reply":"jawaban natural untuk owner","actions":[{"command":"nama_command","args":"argumen tanpa prefix","reason":"alasan singkat"}],"remember":[{"key":"fakta-singkat","value":"isi fakta"}]}

Aturan wajib:
1. Maksimal ${cfg.maxActions} actions. Pakai actions: [] bila tidak perlu alat.
2. Pilih command hanya dari daftar di bawah; jangan pernah mengarang nama command, shell command, atau kode JavaScript.
3. Jangan mengaku command berhasil sebelum hasilnya benar-benar diberikan oleh sistem.
4. Gunakan remember hanya jika owner secara jelas meminta kamu mengingat fakta non-rahasia. Jangan simpan password, token, API key, cookie, atau session.
5. Jika permintaan ambigu atau berisiko, jelaskan dan tanyakan klarifikasi; actions harus kosong.
6. Isi args persis seperti format command dan jangan sertakan prefix.

COMMAND TERSEDIA:
${commandCatalog(m)}`
}

// Mengambil objek JSON pertama dengan tetap menghormati string dan escape.
function firstJsonObject(text) {
  const raw = String(text || '').trim()
  if (!raw) return ''
  const unfenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const start = unfenced.indexOf('{')
  if (start < 0) return ''
  let depth = 0
  let quoted = false
  let escaped = false
  for (let i = start; i < unfenced.length; i++) {
    const ch = unfenced[i]
    if (quoted) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') quoted = false
      continue
    }
    if (ch === '"') quoted = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return unfenced.slice(start, i + 1)
    }
  }
  return ''
}

function explicitMemoryRequest(input) {
  const text = String(input || '')
  if (/\b(jangan|tidak|ga|nggak)\s+(usah\s+)?(ingat|catat|simpan|remember)/i.test(text)) return false
  return /\b(ingat(?:lah|kan)?|catat(?:lah|kan)?|remember|simpan(?:lah|kan)?)\b/i.test(text)
}

function parsePlan(text, maxActions = 3) {
  const json = firstJsonObject(text)
  if (!json) return null
  let data
  try {
    data = JSON.parse(json)
  } catch (_) {
    return null
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const actions = Array.isArray(data.actions)
    ? data.actions
        .filter((x) => x && typeof x === 'object')
        .slice(0, Math.max(1, Math.min(5, maxActions)))
        .map((x) => ({
          command: String(x.command || '').trim().toLowerCase().slice(0, 80),
          args: String(x.args || '').replace(/\0/g, '').trim().slice(0, 2000),
          reason: String(x.reason || '').trim().slice(0, 300),
        }))
        .filter((x) => x.command)
    : []
  const remember = Array.isArray(data.remember)
    ? data.remember
        .filter((x) => x && typeof x === 'object')
        .slice(0, 5)
        .map((x) => ({ key: String(x.key || ''), value: String(x.value || '') }))
        .filter((x) => x.key && x.value)
    : []
  return {
    reply: String(data.reply || '').trim().slice(0, 3500),
    actions,
    remember,
  }
}

async function typing(m, on) {
  try {
    if (m.sock && typeof m.sock.sendPresenceUpdate === 'function') {
      if (on && typeof m.sock.presenceSubscribe === 'function') await m.sock.presenceSubscribe(m.chat)
      await m.sock.sendPresenceUpdate(on ? 'composing' : 'paused', m.chat)
    }
  } catch (_) {}
}

async function runCommand(m, normalized, options = {}) {
  if (!m || !m.isOwner) return { ok: false, error: 'Tindakan agent hanya boleh dijalankan untuk owner.' }
  if (!normalized || !normalized.cmd || normalized.risk === 'blocked') {
    return { ok: false, error: `Command "${normalized && normalized.command || '-'}" tidak diizinkan untuk agent.` }
  }
  const cmd = normalized.cmd
  const outputs = []
  const originalReply = m.reply.bind(m)
  const originalReplyMedia = m.replyMedia && m.replyMedia.bind(m)
  const toolM = {
    ...m,
    command: cmd.name,
    args: normalized.args,
    query: normalized.args,
    argsArr: normalized.args ? normalized.args.split(/\s+/).filter(Boolean) : [],
    isCmd: true,
    // Tindakan harus identik dengan preview yang disetujui. Jangan wariskan
    // quoted media/mention dari pesan .approve karena itu tidak tersimpan dalam
    // proposal dan dapat mengubah perilaku command (contoh: broadcast media).
    quoted: null,
    mentionedJid: [],
    reply: async (text, opt = {}) => {
      outputs.push(String(text || '').slice(0, 3500))
      return originalReply(text, opt)
    },
  }
  if (originalReplyMedia) {
    toolM.replyMedia = async (content, opt = {}) => {
      outputs.push('[media dikirim]')
      return originalReplyMedia(content, opt)
    }
  }

  const shown = `${m.config.prefix}${cmd.name}${normalized.args ? ' ' + normalized.args : ''}`
  await m.reply(`${options.approved ? '🟢 Persetujuan diterima.' : '⚙️'} *${Persona.resolve(m.db).name}* menjalankan \`${shown.slice(0, 700)}\``)
  logger.cmd(`[AGENT] ${m.sender.split('@')[0]}: ${shown.slice(0, 1000)}`)

  try {
    await cmd.run(toolM, {
      conn: m.sock,
      text: normalized.args,
      args: toolM.argsArr,
      command: cmd.name,
      db: m.db,
      config: m.config,
      func: m.func,
      loader: m.loader,
      agent: true,
    })
    const s = store(m.db)
    s.stats.actions = (s.stats.actions || 0) + 1
    s.stats.lastAt = Date.now()
    m.db.data.stats.commands = (m.db.data.stats.commands || 0) + 1
    m.db.data.stats.commandsSession = (m.db.data.stats.commandsSession || 0) + 1
    m.db.data.cmdUsage[cmd.name] = (m.db.data.cmdUsage[cmd.name] || 0) + 1
    m.db.save()
    return { ok: true, command: cmd.name, outputs }
  } catch (e) {
    const s = store(m.db)
    s.stats.failed = (s.stats.failed || 0) + 1
    m.db.save()
    logger.error(`agent command ${cmd.name}`, e)
    await m.reply(`❌ ${Persona.resolve(m.db).name} gagal menjalankan *${cmd.name}*: ${e.message}`).catch(() => {})
    return { ok: false, command: cmd.name, error: e.message, outputs }
  }
}

async function processAction(m, action) {
  const cfg = resolve(m.db)
  const normalized = canonicalAction(m.loader, action)
  if (!normalized || !normalized.cmd || normalized.risk === 'blocked') {
    await m.reply(`🛑 Agent menolak command *${normalized && normalized.command || action.command || '-'}*: tidak ada di allowlist aman.`)
    return { ok: false, blocked: true }
  }
  if (cfg.mode === 'chat') {
    await m.reply(`💬 Mode *chat* aktif, jadi \`${m.config.prefix}${normalized.command}\` tidak dijalankan.`)
    return { ok: false, chatOnly: true }
  }
  if (canRunAutomatically(cfg.mode, normalized.risk)) return runCommand(m, normalized)

  const pending = queueAction(m, normalized, action.reason)
  await m.reply(
    `🛂 *PERLU PERSETUJUAN OWNER*\n\n` +
      `ID: *${pending.id}*\n` +
      `Perintah: \`${m.config.prefix}${pending.command}${pending.args ? ' ' + pending.args : ''}\`\n` +
      `Risiko: ${RISK_LABEL[pending.risk] || pending.risk}\n` +
      (pending.reason ? `Alasan: ${pending.reason}\n` : '') +
      `Berlaku ${cfg.pendingMinutes} menit.\n\n` +
      `Setujui: \`${m.config.prefix}approve ${pending.id}\`\n` +
      `Tolak: \`${m.config.prefix}reject ${pending.id}\``
  )
  return { ok: true, pending: true, id: pending.id }
}

async function respond(m, input) {
  const cfg = resolve(m.db)
  const persona = Persona.resolve(m.db)
  if (!m.isOwner) return m.reply('⛔ Agent pribadi hanya menerima instruksi dari *Owner*.')
  if (!cfg.enabled) return m.reply(`⏸️ *${persona.name} Agent* sedang dinonaktifkan. Aktifkan lewat ${m.config.prefix}agentset on.`)
  if (!String(input || '').trim()) return m.reply(helpText(m))

  const aiCfg = Ai.resolve(m.db)
  const ready = Ai.ready(aiCfg)
  if (!ready.ok) return m.reply(ready.error)
  if (String(input).length > aiCfg.maxChars) {
    return m.reply(`⚠️ Instruksi terlalu panjang (${String(input).length}/${aiCfg.maxChars} karakter).`)
  }

  const busyKey = m.sender || m.chat
  if (_busy.has(busyKey)) return m.reply(`⏳ ${persona.name} masih menyelesaikan instruksi sebelumnya.`)
  _busy.add(busyKey)
  await m.react('🧭').catch(() => {})
  await typing(m, true)

  try {
    const historyKey = `agent:${m.sender}`
    const messages = [{ role: 'system', content: plannerPrompt(m) }]
    // Rencana JSON cenderung lebih panjang dari chat biasa; cap 12 pesan agar
    // prompt agent tidak membengkak walau AI_HISTORY diset sangat besar.
    if (aiCfg.history > 0) messages.push(...Ai.historyOf(historyKey).slice(-Math.min(aiCfg.history, 12)))
    messages.push({ role: 'user', content: String(input).trim() })

    const result = await Ai.ask(m.db, messages)
    if (!result.ok) return m.reply(`❌ ${persona.name} tidak bisa berpikir sekarang: ${result.error}`)

    Ai.pushHistory(historyKey, 'user', String(input).trim())
    Ai.pushHistory(historyKey, 'assistant', result.text)

    const plan = parsePlan(result.text, cfg.maxActions)
    const s = store(m.db)
    s.stats.chats = (s.stats.chats || 0) + 1
    s.stats.lastAt = Date.now()
    m.db.save()

    // Provider yang tidak mengikuti format JSON tetap boleh menjawab sebagai
    // percakapan, tetapi tidak mendapat hak menjalankan alat.
    if (!plan) {
      return m.reply(
        `${result.text.slice(0, 3500)}\n\n_⚠️ Respons AI tidak berbentuk rencana terstruktur; tidak ada command yang dijalankan._`
      )
    }

    // Jangan percaya keputusan model saja: memori hanya boleh berubah bila teks
    // owner sendiri mengandung permintaan eksplisit untuk mengingat/mencatat.
    if (explicitMemoryRequest(input)) {
      for (const item of plan.remember) {
        const saved = Persona.remember(m.db, item.key, item.value)
        if (!saved.ok) await m.reply(`🧠 Memori "${item.key}" tidak disimpan: ${saved.error}`).catch(() => {})
      }
    }

    if (plan.reply) await m.reply(plan.reply)
    else if (!plan.actions.length) await m.reply(`💬 ${persona.name} siap. Apa yang ingin kamu kerjakan?`)

    const results = []
    const seenActions = new Set()
    for (const action of plan.actions) {
      const normalized = canonicalAction(m.loader, action)
      const key = normalized ? `${normalized.command}\u0000${normalized.args}` : String(action.command || '')
      if (seenActions.has(key)) continue
      seenActions.add(key)
      results.push(await processAction(m, action))
    }
    return { ok: true, plan, results }
  } catch (e) {
    const s = store(m.db)
    s.stats.failed = (s.stats.failed || 0) + 1
    m.db.save()
    logger.error('assistant respond', e)
    return m.reply(`❌ Agent mengalami error internal: ${e.message}`)
  } finally {
    await typing(m, false)
    _busy.delete(busyKey)
  }
}

async function approve(m, rawId) {
  if (!m.isOwner) return m.reply('⛔ Hanya owner yang boleh menyetujui tindakan.')
  cleanPending(m.db)
  const s = store(m.db)
  const id = String(rawId || '').trim().toUpperCase()
  const item = s.pending[id]
  if (!item) return m.reply(`❌ ID persetujuan *${id || '-'}* tidak ditemukan atau sudah kedaluwarsa.`)

  // Hapus sebelum eksekusi supaya pesan approve ganda tidak menjalankan command dua kali.
  delete s.pending[id]
  s.stats.approvals = (s.stats.approvals || 0) + 1
  m.db.save()

  const normalized = canonicalAction(m.loader, item)
  if (!normalized || !normalized.cmd || normalized.risk === 'blocked') {
    return m.reply('🛑 Command sudah tidak tersedia atau tidak lagi diizinkan untuk agent.')
  }
  return runCommand(m, normalized, { approved: true })
}

async function reject(m, rawId) {
  if (!m.isOwner) return m.reply('⛔ Hanya owner yang boleh menolak tindakan.')
  cleanPending(m.db)
  const s = store(m.db)
  const id = String(rawId || '').trim().toUpperCase()
  const item = s.pending[id]
  if (!item) return m.reply(`❌ ID persetujuan *${id || '-'}* tidak ditemukan atau sudah kedaluwarsa.`)
  delete s.pending[id]
  s.stats.rejected = (s.stats.rejected || 0) + 1
  m.db.save()
  return m.reply(`🚫 Tindakan *${id}* dibatalkan. \`${m.config.prefix}${item.command}${item.args ? ' ' + item.args : ''}\` tidak dijalankan.`)
}

function shouldAutoChat(m) {
  const cfg = resolve(m && m.db)
  return !!(
    cfg.enabled &&
    cfg.autoChat &&
    m &&
    m.isOwner &&
    !m.isGroup &&
    !m.isCmd &&
    !m.fromMe &&
    typeof m.body === 'string' &&
    m.body.trim()
  )
}

function clearAgentHistory(sender) {
  return Ai.clearHistory(`agent:${sender}`)
}

function helpText(m) {
  const cfg = resolve(m.db)
  const p = Persona.resolve(m.db)
  return (
    `🧭 *${p.name.toUpperCase()} — PERSONAL AGENT*\n\n` +
    `${p.role}.\n\n` +
    `Contoh:\n` +
    `• ${m.config.prefix}asisten cek kesehatan bot dan laporkan yang bermasalah\n` +
    `• ${m.config.prefix}asisten cek status hosting serta penggunaan resource\n` +
    `• ${m.config.prefix}asisten ingat bahwa laporan mingguan dibuat hari Senin\n` +
    `• ${m.config.prefix}asisten restart server Survival (akan meminta persetujuan)\n\n` +
    `Mode: *${cfg.mode}* | auto-chat: *${cfg.autoChat ? 'on' : 'off'}*\n` +
    `Atur: ${m.config.prefix}agentset | Kepribadian: ${m.config.prefix}persona\n` +
    `Pending: ${m.config.prefix}agentset pending`
  )
}

module.exports = {
  MODES,
  RISK_LABEL,
  TOOL_RULES,
  store,
  resolve,
  setOption,
  policyFor,
  canonicalAction,
  canRunAutomatically,
  commandCatalog,
  plannerPrompt,
  firstJsonObject,
  explicitMemoryRequest,
  parsePlan,
  cleanPending,
  pendingList,
  formatPending,
  queueAction,
  runCommand,
  processAction,
  respond,
  approve,
  reject,
  shouldAutoChat,
  clearAgentHistory,
  helpText,
  _busy,
}
