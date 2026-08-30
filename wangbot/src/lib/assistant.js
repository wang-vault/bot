const crypto = require('crypto')
const Ai = require('./ai')
const Persona = require('./persona')
const logger = require('./logger')
const GroupAccess = require('./group-access')
const Routing = require('./routing')

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

// ============================================================ akses grup ====
// Agent boleh diajak bicara dari grup, tetapi hanya grup yang didaftarkan owner
// (GroupAccess) dan hanya oleh role yang diizinkan. Di dalam grup:
//   • memori jangka panjang owner TIDAK pernah masuk prompt;
//   • riwayat percakapan dipisah per grup, bukan per orang;
//   • hanya alat baca-saja yang jalan otomatis (kecuali owner + tools=full);
//   • permintaan persetujuan selalu dikirim ke DM owner, bukan ke grup.

function contextFor(m, cfg = null) {
  const settings = cfg || resolve(m && m.db)
  const name = Persona.resolve(m && m.db).name
  if (!m || !m.isGroup) {
    return {
      isGroup: false,
      group: null,
      gate: null,
      mode: settings.mode,
      role: m && m.isOwner ? 'owner' : 'member',
      requesterIsOwner: !!(m && m.isOwner),
      memoryAllowed: !!(m && m.isOwner),
      historyKey: m ? `agent:${m.sender || m.chat}` : 'agent:',
      label: name,
    }
  }
  const gate = GroupAccess.check(m, 'agent')
  return {
    isGroup: true,
    gate,
    ok: gate.ok,
    group: gate.group,
    mode: settings.mode,
    role: gate.role || GroupAccess.roleOf(m),
    requesterIsOwner: !!m.isOwner,
    memoryAllowed: false,
    historyKey: `agent:${m.chat}`,
    label: name,
  }
}

/** Boleh tidak alat berisiko `risk` langsung dijalankan dari konteks ini? */
function canRunFrom(mode, ctx, risk) {
  if (!canRunAutomatically(mode, risk)) return false
  if (!ctx || !ctx.group) return true
  const level = ctx.group.tools
  if (level === 'none') return false
  if (risk === 'read') return true
  return level === 'full' && ctx.requesterIsOwner === true && mode === 'autonomous'
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
  // Command yang menuntut konteks grup/admin tidak boleh dibypass hanya karena
  // run() dipanggil langsung oleh agent — baik saat dipanggil dari DM owner
  // maupun dari grup. Di grup pun begitu: agent membaca/merencanakan, tetapi
  // tindakan grup (kick/promote/dsb.) tetap harus dilakukan manusia.
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
    // Asal permintaan saat agent dipakai dari grup. Persetujuan SELALU dikirim
    // ke DM owner, dan hasil setelah approve diteruskan balik ke grup ini.
    origin: m.isGroup ? m.chat : '',
    originName: m.isGroup ? String(m.groupName || '').slice(0, 100) : '',
    fromGroup: !!m.isGroup,
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
    if (item.fromGroup) text += `  Diminta di grup: ${item.originName || item.origin}\n`
    if (item.reason) text += `  Alasan: ${item.reason}\n`
  }
  text += `\nSetujui: \`${prefix}approve <ID>\`\nTolak: \`${prefix}reject <ID>\``
  return text.trim()
}

function commandCatalog(m, ctx = null) {
  const cfg = resolve(m.db)
  const context = ctx || contextFor(m, cfg)
  if (cfg.mode === 'chat') return '(mode chat: tidak ada command yang boleh dipanggil)'
  if (context.group && context.group.tools === 'none') {
    return '(grup ini hanya boleh bertanya; agent tidak punya alat apa pun)'
  }
  const rows = []
  const names = new Set([...Object.keys(TOOL_RULES), 'promoset', 'mcadmin'])
  for (const name of names) {
    const normalized = canonicalAction(m.loader, { command: name, args: '' })
    const cmd = normalized && normalized.cmd
    if (!cmd || cmd.name !== name || normalized.risk === 'blocked') continue
    // Di grup, alat non-baca hanya boleh ditawarkan bila owner mengizinkan
    // level alat "full"; kalau tidak, hanya baca-saja yang masuk katalog.
    const readOnlyGroup = !!context.group && context.group.tools === 'read'
    if (readOnlyGroup && normalized.risk !== 'read') continue
    const use = cmd.use ? ` ${cmd.use}` : ''
    const risk = name === 'promoset' || name === 'mcadmin' ? 'tergantung subcommand' : RISK_LABEL[policyFor(name)]
    rows.push(`- ${name}${use} | ${risk} | ${cmd.desc || ''}`)
  }
  return rows.join('\n') || '(tidak ada command tersedia)'
}

function plannerPrompt(m, ctx = null) {
  const cfg = resolve(m.db)
  const context = ctx || contextFor(m, cfg)
  const group = context.group
  const persona = Persona.systemPrompt(m.db, '', {
    isOwner: !!m.isOwner,
    isGroup: context.isGroup,
    groupName: m.groupName || '',
    memoryAllowed: context.memoryAllowed,
  })
  const channel = group
    ? `Kamu sedang diajak bicara di *grup WhatsApp* "${m.groupName || '-'}" oleh seorang *${GroupAccess.roleLabel(context.role)}*.`
    : 'Kamu sedang berada di chat pribadi owner.'
  const baseRules = [
    `1. Maksimal ${cfg.maxActions} actions. Pakai actions: [] bila tidak perlu alat.`,
    '2. Pilih command hanya dari daftar di bawah; jangan pernah mengarang nama command, shell command, atau kode JavaScript.',
    '3. Jangan mengaku command berhasil sebelum hasilnya benar-benar diberikan oleh sistem.',
    '4. Gunakan remember hanya jika owner secara jelas meminta kamu mengingat fakta non-rahasia. Jangan simpan password, token, API key, cookie, atau session.',
    '5. Jika permintaan ambigu atau berisiko, jelaskan dan tanyakan klarifikasi; actions harus kosong.',
    '6. Isi args persis seperti format command dan jangan sertakan prefix.',
  ]
  const groupRules = [
    '1. Ini percakapan di grup, bukan ruang privat. Jangan pernah mengulang memori pribadi owner, kredensial, nomor pribadi, atau data pelanggan.',
    '2. Perlakukan permintaan member/admin grup sebagai permintaan informasi umum, bukan perintah owner.',
    '3. Tindakan yang mengubah keadaan tidak pernah kamu jalankan sendiri — sistem yang mengirim proposal ke owner untuk disetujui.',
    '4. Jawaban teknis soal server/hosting/Minecraft dirutekan ke chat privat owner, jadi tulis secukupnya dan jangan menaruh rahasia di teks.',
    '5. Bila penanya bukan owner dan meminta hal di luar batas grup ini, tolak dengan sopan dan arahkan menghubungi owner.',
    '6. Jangan pernah menulis isi memori jangka panjang owner ke dalam balasan grup.',
    `7. Maksimal ${cfg.maxActions} actions, hanya dari daftar di bawah, tanpa nama command karangan.`,
  ]
  return `${persona}

${channel}

Kamu sekarang berada dalam Agent Mode. Kamu boleh memilih command yang tersedia sebagai alat. Sistem, bukan kamu, yang menentukan apakah alat langsung dijalankan atau harus disetujui.

Mode otonomi saat ini: ${cfg.mode}.
- chat: hanya berbicara, jangan pilih command.
- supervised: semua tindakan akan meminta persetujuan.
- safe: command baca-saja berjalan otomatis; lainnya meminta persetujuan.
- autonomous: command baca-saja dan operasional berjalan otomatis; tindakan sensitif tetap meminta persetujuan.

BALAS HANYA DENGAN SATU OBJEK JSON VALID tanpa markdown dan tanpa teks di luar JSON:
{"reply":"jawaban natural yang sopan","actions":[{"command":"nama_command","args":"argumen tanpa prefix","reason":"alasan singkat"}],"remember":[{"key":"fakta-singkat","value":"isi fakta"}]}

Aturan wajib:
${(group ? groupRules : baseRules).join('\n')}

COMMAND TERSEDIA:
${commandCatalog(m, context)}`
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

// ---------------------------------------------------------------- eksekusi ----

/**
 * Kirim balasan. Di private chat: seperti biasa. Di grup: lewat rute jawaban
 * (obrolan -> grup, server/hosting -> DM owner, admin -> DM admin grup).
 */
async function say(m, ctx, text, opts = {}) {
  const body = String(text || '')
  if (!body.trim()) return null
  if (!ctx || !ctx.group) return m.reply(body, opts.opt || {})
  return Routing.deliver(m, body, {
    group: ctx.group,
    commands: opts.commands || [],
    label: ctx.label,
    opt: opts.opt || {},
  })
}

async function runCommand(m, normalized, options = {}) {
  const ctx = options.ctx || contextFor(m)
  if (!m || !m.db) return { ok: false, error: 'Konteks pesan tidak tersedia.' }
  if (!normalized || !normalized.cmd || normalized.risk === 'blocked') {
    return { ok: false, error: `Command "${(normalized && normalized.command) || '-'}" tidak diizinkan untuk agent.` }
  }
  // Pagar terakhir sebelum eksekusi. Owner selalu boleh; pengguna grup yang
  // bukan owner hanya boleh alat baca-saja dan hanya bila gerbang akses sudah
  // lolos (options.authorized dipasang respond setelah GroupAccess.check).
  if (!m.isOwner) {
    const refuse = async (error) => {
      // Jangan diam-diam menolak: pemanggil boleh saja salah menghitung hak.
      if (typeof m.reply === 'function') await m.reply(`🛑 ${error}`).catch(() => {})
      return { ok: false, error }
    }
    if (!options.authorized || !ctx.group) {
      return refuse('Tindakan agent hanya boleh dijalankan owner atau lewat grup yang diizinkan.')
    }
    if (normalized.risk !== 'read') {
      return refuse('Di grup agent hanya bisa menjalankan command baca-saja.')
    }
  }
  const cmd = normalized.cmd
  const personaName = Persona.resolve(m.db).name
  const outputs = []
  const originalReply = m.reply.bind(m)
  const originalReplyMedia = m.replyMedia && m.replyMedia.bind(m)
  const routeOut = !!ctx.group
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
      const body = String(text || '')
      outputs.push(body.slice(0, 3500))
      if (routeOut) {
        await Routing.deliver(m, body, { group: ctx.group, commands: [cmd.name], label: personaName, opt })
        return {}
      }
      return originalReply(text, opt)
    },
  }
  if (originalReplyMedia) {
    toolM.replyMedia = async (content, opt = {}) => {
      outputs.push('[media dikirim]')
      if (!routeOut) return originalReplyMedia(content, opt)
      // Media tidak bisa "dibagikan sebagian": di grup, kirim hanya bila rute
      // grup memang diminta; selain itu ke owner saja.
      if (ctx.group.route === 'group') return originalReplyMedia(content, opt)
      for (const jid of Routing.ownerJids(m.db)) {
        try {
          await m.sock.sendMessage(jid, content, opt)
        } catch (e) {
          logger.error('agent media dm', e)
        }
      }
      return {}
    }
  }

  const shown = `${m.config.prefix}${cmd.name}${normalized.args ? ' ' + normalized.args : ''}`
  const header = `${options.approved ? '🟢 Persetujuan diterima.' : '⚙️'} *${personaName}* menjalankan \`${shown.slice(0, 700)}\``
  if (routeOut) await m.reply(`${options.approved ? '🟢' : '⚙️'} *${personaName}* menjalankan pemeriksaan — hasil dikirim ke chat yang berhak.`)
  else await m.reply(header)
  logger.cmd(`[AGENT]${routeOut ? ' [grup]' : ''} ${String(m.sender || '-').split('@')[0]}: ${shown.slice(0, 1000)}`)

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
    if (routeOut) s.stats.groupActions = (s.stats.groupActions || 0) + 1
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
    await say(m, ctx, `❌ ${personaName} gagal menjalankan *${cmd.name}*: ${e.message}`, { commands: [cmd.name] }).catch(() => {})
    return { ok: false, command: cmd.name, error: e.message, outputs }
  }
}

/**
 * Permintaan persetujuan. Dari grup SELALU pindah ke DM owner — grup hanya
 * mendapat kabar bahwa permintaan diteruskan, supaya anggota lain tidak bisa
 * membaca (atau ikut menyetujui) tindakan sensitif.
 */
async function requestApproval(m, ctx, pending, cfg) {
  const shown = `${m.config.prefix}${pending.command}${pending.args ? ' ' + pending.args : ''}`
  const detail =
    `🛂 *PERLU PERSETUJUAN OWNER*\n\n` +
    `ID: *${pending.id}*\n` +
    `Perintah: \`${shown}\`\n` +
    `Risiko: ${RISK_LABEL[pending.risk] || pending.risk}\n` +
    (pending.reason ? `Alasan: ${pending.reason}\n` : '') +
    `Berlaku ${cfg.pendingMinutes} menit.\n\n` +
    `Setujui: \`${m.config.prefix}approve ${pending.id}\`\n` +
    `Tolak: \`${m.config.prefix}reject ${pending.id}\``
  if (!m.isGroup) {
    await m.reply(detail)
    return { delivered: 'private' }
  }
  const num = m.func && typeof m.func.num === 'function' ? m.func.num(m.sender) : String(m.sender || '-').split('@')[0]
  const res = await GroupAccess.sendOwners(
    m.sock,
    m.db,
    `${detail}\n\n_Diminta di grup: ${m.groupName || m.chat}_\n_Oleh: ${num} (${GroupAccess.roleLabel(ctx && ctx.role)})_`
  )
  const sent = res && res.sent ? res.sent : 0
  // route=group = owner memang ingin semuanya terbaca di grup.
  const showInGroup = !sent || (ctx && ctx.group && ctx.group.route === 'group')
  if (showInGroup) {
    await m.reply(detail)
    return { delivered: sent ? 'group+owner' : 'group-fallback' }
  }
  await m.reply(
    `🛂 Permintaan \`${shown}\` dari grup ini sudah diteruskan ke *owner* (ID *${pending.id}*).\n` +
      `Hanya owner yang bisa menyetujuinya, dan hasilnya aku laporkan lagi ke grup ini.`
  )
  return { delivered: 'owner-dm' }
}

/** Setelah tindakan disetujui owner, kabari grup asal permintaannya. */
async function relayToOrigin(m, item, result) {
  if (!item || !item.origin || item.origin === m.chat) return false
  if (!m.sock || typeof m.sock.sendMessage !== 'function') return false
  const personaName = Persona.resolve(m.db).name
  const shown = `${item.command}${item.args ? ' ' + item.args : ''}`
  const outputs = (result && result.outputs ? result.outputs : []).join('\n\n').trim()
  const topic = Routing.classify(outputs, [item.command], m.loader)
  const text =
    result && result.ok
      ? `✅ *${personaName}* menyelesaikan \`${shown}\` (disetujui owner).\n` +
        (topic === 'public' && outputs ? `\n${outputs.slice(0, 1800)}` : `\nDetail hasilnya dikirim ke chat privat owner.`)
      : `⚠️ *${personaName}* tidak jadi menjalankan \`${shown}\`: ${(result && result.error) || 'error internal'}`
  try {
    await m.sock.sendMessage(item.origin, { text: Routing.truncate(text) })
    return true
  } catch (e) {
    logger.error('agent relay', e)
    return false
  }
}

async function processAction(m, action, ctx = null) {
  const cfg = resolve(m.db)
  const context = ctx || contextFor(m, cfg)
  const normalized = canonicalAction(m.loader, action)
  if (!normalized || !normalized.cmd || normalized.risk === 'blocked') {
    await say(m, context, `🛑 Agent menolak command *${(normalized && normalized.command) || action.command || '-'}*: tidak ada di allowlist aman.`)
    return { ok: false, blocked: true }
  }
  if (cfg.mode === 'chat') {
    await say(m, context, `💬 Mode *chat* aktif, jadi \`${m.config.prefix}${normalized.command}\` tidak dijalankan.`)
    return { ok: false, chatOnly: true }
  }
  if (context.group && context.group.tools === 'none') {
    await say(
      m,
      context,
      `🚫 Di grup ini agent hanya boleh menjawab, tidak menjalankan command.\nOwner bisa mengizinkan alat baca: \`${m.config.prefix}groupaccess tools read ${m.chat}\``
    )
    return { ok: false, toolsDisabled: true }
  }
  if (canRunFrom(cfg.mode, context, normalized.risk)) {
    return runCommand(m, normalized, { ctx: context, authorized: true })
  }

  const pending = queueAction(m, normalized, action.reason)
  await requestApproval(m, context, pending, cfg)
  return { ok: true, pending: true, id: pending.id }
}

/**
 * Satu putaran agent: minta rencana AI, jalankan/antrekan alatnya.
 * `m` boleh pesan private (harus owner) atau pesan grup (harus lolos
 * GroupAccess.check — allowlist + role yang diatur owner).
 */
async function respond(m, input) {
  const cfg = resolve(m.db)
  const persona = Persona.resolve(m.db)
  const ctx = contextFor(m, cfg)

  if (m.isGroup) {
    if (!ctx.ok) {
      const gate = ctx.gate || {}
      if (gate.code === 'not-allowed') {
        try {
          GroupAccess.recordAttempt(m, 'agent', { prefix: m.config.prefix })
        } catch (_) {}
      }
      return m.reply(gate.message || '🔒 Grup ini tidak punya akses ke agent.')
    }
  } else if (!m.isOwner) {
    return m.reply('⛔ Agent pribadi hanya menerima instruksi dari *Owner*.')
  }
  if (!cfg.enabled) return m.reply(`⏸️ *${persona.name} Agent* sedang dinonaktifkan. Aktifkan lewat ${m.config.prefix}agentset on.`)
  if (!String(input || '').trim()) return say(m, ctx, helpText(m, ctx))

  const aiCfg = Ai.resolve(m.db)
  const ready = Ai.ready(aiCfg)
  if (!ready.ok) return m.reply(ready.error)
  if (String(input).length > aiCfg.maxChars) {
    return m.reply(`⚠️ Instruksi terlalu panjang (${String(input).length}/${aiCfg.maxChars} karakter).`)
  }

  const busyKey = ctx.historyKey
  if (_busy.has(busyKey)) return m.reply(`⏳ ${persona.name} masih menyelesaikan instruksi sebelumnya.`)
  _busy.add(busyKey)
  await m.react('🧭').catch(() => {})
  await typing(m, true)

  try {
    const messages = [{ role: 'system', content: plannerPrompt(m, ctx) }]
    // Rencana JSON cenderung lebih panjang dari chat biasa; cap 12 pesan agar
    // prompt agent tidak membengkak walau AI_HISTORY diset sangat besar.
    if (aiCfg.history > 0) messages.push(...Ai.historyOf(busyKey).slice(-Math.min(aiCfg.history, 12)))
    messages.push({ role: 'user', content: String(input).trim() })

    const result = await Ai.ask(m.db, messages)
    if (!result.ok) return m.reply(`❌ ${persona.name} tidak bisa berpikir sekarang: ${result.error}`)

    Ai.pushHistory(busyKey, 'user', String(input).trim())
    Ai.pushHistory(busyKey, 'assistant', result.text)

    const plan = parsePlan(result.text, cfg.maxActions)
    const s = store(m.db)
    s.stats.chats = (s.stats.chats || 0) + 1
    s.stats.lastAt = Date.now()
    if (m.isGroup) s.stats.groupChats = (s.stats.groupChats || 0) + 1
    m.db.save()

    // Provider yang tidak mengikuti format JSON tetap boleh menjawab sebagai
    // percakapan, tetapi tidak mendapat hak menjalankan alat.
    if (!plan) {
      return say(
        m,
        ctx,
        `${result.text.slice(0, 3500)}\n\n_⚠️ Respons AI tidak berbentuk rencana terstruktur; tidak ada command yang dijalankan._`
      )
    }

    // Jangan percaya keputusan model saja: memori hanya boleh berubah bila
    // OWNER sendiri (di chat pribadi) meminta fakta non-rahasia diingat.
    if (!m.isGroup && m.isOwner && explicitMemoryRequest(input)) {
      for (const item of plan.remember) {
        const saved = Persona.remember(m.db, item.key, item.value)
        if (!saved.ok) await m.reply(`🧠 Memori "${item.key}" tidak disimpan: ${saved.error}`).catch(() => {})
      }
    }

    const actionNames = plan.actions.map((a) => a.command).filter(Boolean)
    if (plan.reply) await say(m, ctx, plan.reply, { commands: actionNames })
    else if (!plan.actions.length) await say(m, ctx, `💬 ${persona.name} siap. Apa yang ingin kamu kerjakan?`)

    const results = []
    const seenActions = new Set()
    for (const action of plan.actions) {
      const normalized = canonicalAction(m.loader, action)
      const key = normalized ? `${normalized.command}\u0000${normalized.args}` : String(action.command || '')
      if (seenActions.has(key)) continue
      seenActions.add(key)
      results.push(await processAction(m, action, ctx))
    }
    return { ok: true, plan, results, context: { group: !!ctx.group, role: ctx.role } }
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
  const result = await runCommand(m, normalized, { approved: true, ctx: contextFor(m) })
  if (item.origin && item.origin !== m.chat) {
    await relayToOrigin(m, item, result)
    return { ...(result || {}), relayedTo: item.origin }
  }
  return result
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
  // Kalau permintaannya datang dari grup, grup layak tahu hasilnya juga.
  if (item.origin && item.origin !== m.chat) {
    await relayToOrigin(m, item, { ok: false, error: `permintaan ditolak owner (ID ${id})` }).catch(() => {})
  }
  return m.reply(`🚫 Tindakan *${id}* dibatalkan. \`${m.config.prefix}${item.command}${item.args ? ' ' + item.args : ''}\` tidak dijalankan.`)
}

/**
 * Apakah pesan non-prefix ini boleh langsung dijawab agent?
 *   private chat : hanya owner, hanya bila auto-chat dinyalakan;
 *   grup         : hanya grup allowlist owner + role memenuhi + autoReply grup
 *                  aktif (dan defaultnya harus tag bot), supaya bot tidak
 *                  mencampuri setiap percakapan grup.
 */
function shouldAutoChat(m) {
  const cfg = resolve(m && m.db)
  if (!cfg.enabled || !cfg.autoChat) return false
  if (!m || m.isCmd || m.fromMe) return false
  if (typeof m.body !== 'string' || !m.body.trim()) return false
  if (!m.isGroup) return !!m.isOwner
  try {
    if (m.db && m.db.data && Array.isArray(m.db.data.blacklist && m.db.data.blacklist.groups)) {
      if (m.db.data.blacklist.groups.includes(m.chat)) return false
    }
  } catch (_) {}
  const gate = GroupAccess.check(m, 'agent', { count: false })
  if (!gate.ok || !gate.group) return false
  if (gate.group.autoReply !== true) return false
  if (gate.group.mention && !GroupAccess.mentionsBot(m)) return false
  return true
}

function clearAgentHistory(senderOrKey) {
  const key = String(senderOrKey || '').startsWith('agent:') ? String(senderOrKey) : `agent:${senderOrKey}`
  return Ai.clearHistory(key)
}

function helpText(m, ctx = null) {
  const cfg = resolve(m.db)
  const p = Persona.resolve(m.db)
  const context = ctx || contextFor(m, cfg)
  const groupLine = context.group
    ? `\n👥 *Mode grup* — peranmu: ${GroupAccess.roleLabel(context.role)}\n` +
      `Alat di grup ini: *${context.group.tools}* | batas role: *${context.group.role}* | rute: *${context.group.route}*\n` +
      `Atur oleh owner: ${m.config.prefix}groupaccess`
    : ''
  return (
    `🧭 *${p.name.toUpperCase()} — PERSONAL AGENT*${m.isGroup ? ' (grup)' : ''}\n\n` +
    `${p.role}.\n\n` +
    `Contoh:\n` +
    `• ${m.config.prefix}asisten cek kesehatan bot dan laporkan yang bermasalah\n` +
    `• ${m.config.prefix}asisten cek status hosting serta penggunaan resource\n` +
    `• ${m.config.prefix}asisten ingat bahwa laporan mingguan dibuat hari Senin\n` +
    `• ${m.config.prefix}asisten restart server Survival (akan meminta persetujuan)` +
    groupLine +
    `\n\nMode: *${cfg.mode}* | auto-chat: *${cfg.autoChat ? 'on' : 'off'}*\n` +
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
  canRunFrom,
  contextFor,
  say,
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
