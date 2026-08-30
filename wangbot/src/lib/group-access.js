// Pagar akses grup untuk Personal Agent (.asisten) dan Ask AI (.ai).
//
// Aturan dasarnya: agent bisa dihubungi dari grup, TAPI hanya grup yang sudah
// didaftarkan OWNER ke allowlist, dan di dalam grup itu hanya role tertentu yang
// boleh memakainya. Admin grup tidak bisa mengubah aturan ini — seluruh
// pengaturan hidup di db.data.groupAccess dan hanya ditulis owner lewat
// `.groupaccess`.
//
// Tiga lapis gerbang (semua harus lolos):
//   1. `enabled`  — saklar utama "agent/AI boleh dipakai di grup" (global).
//   2. allowlist  — jid grup harus ada di db.data.groupAccess.groups dan
//                   grupnya aktif (`enabled`) dengan fitur yang diminta
//                   (`agent` / `ai`) aktif.
//   3. `role`     — peran pengirim di grup >= batas yang ditentukan owner
//                   (owner > admin > member > all).
//
// Balasan di grup tidak selalu tampil di grup: lihat src/lib/routing.js —
// obrolan biasa -> grup, urusan server/hosting -> DM owner, urusan admin -> DM
// admin grup, urusan owner -> DM owner.
//
// Model datanya bertingkat: nilai global owner = default semua grup, dan
// sebuah grup boleh meng-override sebagian nilainya. Override yang tidak pernah
// diset tidak ditulis ke database, jadi `.groupaccess role member` (global) tetap
// berlaku ke grup-grup tersebut; pakai nilai `auto` untuk melepas override.

const logger = require('./logger')

const ROLES = Object.freeze(['owner', 'admin', 'member', 'all'])
const ROLE_RANK = Object.freeze({ guest: -1, member: 1, admin: 2, owner: 3 })
const ROLE_LABEL = Object.freeze({
  owner: 'Owner saja',
  admin: 'Owner + Admin grup',
  member: 'Semua member grup',
  all: 'Siapa pun (termasuk bukan peserta)',
})
const ROUTES = Object.freeze(['smart', 'group', 'private', 'admin', 'owner'])
const ROUTE_LABEL = Object.freeze({
  smart: 'pintar: obrolan→grup, server/hosting→DM owner, admin→DM admin',
  group: 'semua jawaban dikirim ke grup',
  private: 'semua jawaban dikirim ke DM owner',
  admin: 'semua jawaban dikirim ke DM admin grup',
  owner: 'semua jawaban dikirim ke DM owner (termasuk yang netral)',
})
const TOOL_LEVELS = Object.freeze(['none', 'read', 'full'])
const TOOL_LABEL = Object.freeze({
  none: 'tidak ada alat — hanya bicara',
  read: 'hanya alat baca-saja; sisanya minta approval owner',
  full: 'mengikuti mode otonomi; tulis/sensitif tetap minta approval owner',
})
const FEATURES = Object.freeze(['agent', 'ai'])
// Kunci yang boleh dioverride per grup. Semua bertipe boolean kecuali disebut.
const OVERRIDE_KEYS = Object.freeze(['agent', 'ai', 'role', 'mention', 'autoReply', 'tools', 'route'])
const BOOL_KEYS = Object.freeze(['enabled', 'agent', 'ai', 'mention', 'autoReply'])
const ENUM_KEYS = Object.freeze({ role: ROLES, tools: TOOL_LEVELS, route: ROUTES })
const LIMITS = Object.freeze({ note: 100, name: 100, groups: 60, requests: 25 })
const REQUEST_COOLDOWN = 6 * 60 * 60 * 1000 // satu laporan owner / 6 jam / grup

function boolEnv(name, fallback) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  return !['0', 'false', 'off', 'no'].includes(String(raw).trim().toLowerCase())
}

function listEnv(name) {
  return String(process.env[name] || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
}

function oneOf(value, list, fallback) {
  const v = String(value === undefined || value === null ? '' : value).trim().toLowerCase()
  if (!v) return fallback
  return list.includes(v) ? v : fallback
}

function onOff(raw) {
  const v = String(raw === undefined || raw === null ? '' : raw).trim().toLowerCase()
  if (['on', '1', 'true', 'yes', 'aktif', 'ya', 'boleh'].includes(v)) return true
  if (['off', '0', 'false', 'no', 'nonaktif', 'tidak', 'matikan'].includes(v)) return false
  return null
}

/** Nilai dari .env — dipakai sebagai lantai paling bawah. */
function envDefaults() {
  return {
    // enabled=false -> agent & AI bungkam total di semua grup.
    enabled: boolEnv('GROUP_ACCESS_ENABLED', true),
    // enforce=false -> kembali ke perilaku lama (semua grup boleh, hanya batas
    // role + saklar global yang berlaku). Bawaannya: allowlist wajib.
    enforce: boolEnv('GROUP_ACCESS_ENFORCE', true),
    agent: boolEnv('GROUP_AGENT_IN_GROUP', true),
    ai: boolEnv('GROUP_AI_IN_GROUP', true),
    role: oneOf(process.env.GROUP_ACCESS_ROLE, ROLES, 'admin'),
    mention: boolEnv('GROUP_AGENT_MENTION', true),
    autoReply: boolEnv('GROUP_AGENT_AUTOREPLY', false),
    tools: oneOf(process.env.GROUP_AGENT_TOOLS, TOOL_LEVELS, 'read'),
    route: oneOf(process.env.GROUP_AGENT_ROUTE, ROUTES, 'smart'),
    allow: listEnv('GROUP_ACCESS_ALLOW'),
  }
}

// ---------------------------------------------------------------- database ----

function store(db) {
  if (!db || !db.data) return null
  if (!db.data.groupAccess || typeof db.data.groupAccess !== 'object' || Array.isArray(db.data.groupAccess)) {
    db.data.groupAccess = {}
  }
  const g = db.data.groupAccess
  if (!g.groups || typeof g.groups !== 'object' || Array.isArray(g.groups)) g.groups = {}
  if (!g.requests || typeof g.requests !== 'object' || Array.isArray(g.requests)) g.requests = {}
  if (!g.stats || typeof g.stats !== 'object') g.stats = { allowed: 0, denied: 0, routed: 0 }
  return g
}

/** Lapisan global: database menang atas .env. */
function globals(db) {
  const env = envDefaults()
  const s = store(db) || {}
  const bool = (key, fallback) => (s[key] === true || s[key] === false ? s[key] : fallback)
  return {
    // Saklar utama akses grup. Nonaktif = agent & AI bungkam di semua grup.
    enabled: bool('enabled', env.enabled),
    // Allowlist wajib? Off = semua grup boleh (hanya role & saklar yang menyaring).
    enforce: bool('enforce', env.enforce),
    agent: bool('agent', env.agent),
    ai: bool('ai', env.ai),
    mention: bool('mention', env.mention),
    autoReply: bool('autoReply', env.autoReply),
    role: oneOf(s.role, ROLES, env.role),
    tools: oneOf(s.tools, TOOL_LEVELS, env.tools),
    route: oneOf(s.route, ROUTES, env.route),
  }
}

/** Gabungkan override sebuah grup di atas nilai global. */
function mergeEntry(raw, base) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const out = {
    jid: typeof src.jid === 'string' ? src.jid : '',
    name: String(src.name || '').slice(0, LIMITS.name),
    note: String(src.note || '').slice(0, LIMITS.note),
    addedAt: Number(src.addedAt || 0),
    updatedAt: Number(src.updatedAt || 0),
    enabled: src.enabled === false ? false : true,
    overridden: [],
  }
  for (const key of OVERRIDE_KEYS) {
    const value = src[key]
    if (typeof value === 'boolean' && BOOL_KEYS.includes(key)) {
      out[key] = value
      out.overridden.push(key)
    } else if (typeof value === 'string' && ENUM_KEYS[key] && ENUM_KEYS[key].includes(value.toLowerCase())) {
      out[key] = value.toLowerCase()
      out.overridden.push(key)
    } else {
      out[key] = base[key]
    }
  }
  return out
}

/** Konfigurasi gabungan yang siap dipakai per pesan. */
function resolve(db) {
  const base = globals(db)
  const s = store(db) || {}
  const groups = {}
  for (const [jid, raw] of Object.entries(s.groups || {})) {
    if (typeof jid !== 'string') continue
    groups[jid] = { ...mergeEntry(raw, base), jid }
  }
  return { ...base, groups, requests: s.requests || {}, stats: s.stats }
}

/** Konfigurasi grup tertentu (null = tidak ada di allowlist). */
function groupConfig(db, jid) {
  if (!jid) return null
  return resolve(db).groups[jid] || null
}

// ------------------------------------------------------------------ helpers ----

function isGroupJid(jid) {
  return typeof jid === 'string' && jid.endsWith('@g.us')
}

/**
 * Peran pengirim di grup: 'owner' | 'admin' | 'member' | 'guest'.
 * `participants` = meta.participants; kalau metadata gagal diambil (kosong)
 * kita tidak menghukum user -> 'member', supaya bot tetap bisa dipakai saat
 * WhatsApp sedang lambat.
 */
function roleOf(m, participants) {
  if (!m) return 'guest'
  if (m.isOwner) return 'owner'
  if (!m.isGroup) return 'member'
  if (m.isAdmin) return 'admin'
  if (!Array.isArray(participants) || !participants.length) return 'member'
  const mine = [m.sender, m.quoted && m.quoted.sender].filter(Boolean)
  const found = participants.some((p) => {
    if (!p) return false
    const ids = [p.jid, p.id, p.lid].filter(Boolean)
    return ids.some((id) => mine.includes(id))
  })
  return found ? 'member' : 'guest'
}

/** Apakah `role` memenuhi batas minimal `need`? */
function meets(role, need) {
  const want = ROLES.includes(need) ? need : 'admin'
  if (role === 'owner') return true // owner selalu boleh
  if (want === 'all') return true
  const have = ROLE_RANK[role]
  if (have === undefined) return false
  if (want === 'member') return have >= ROLE_RANK.member
  if (want === 'admin') return have >= ROLE_RANK.admin
  return false // need === 'owner' dan pengirim bukan owner
}

function roleLabel(role) {
  if (role === 'guest') return 'bukan peserta grup'
  if (role === 'member') return 'member'
  if (role === 'admin') return 'Admin grup'
  if (role === 'owner') return 'Owner'
  return role || '-'
}

function botIds(m) {
  const id = m && m.sock && m.sock.user && m.sock.user.id
  if (typeof id !== 'string' || !id) return []
  return [id, id.split(':')[0] + '@s.whatsapp.net']
}

/** Pesan ini ditujukan ke bot? (tag bot, reply pesan bot, atau @nomor-bot) */
function mentionsBot(m) {
  if (!m) return false
  if (m.quoted && m.quoted.key && m.quoted.key.fromMe) return true
  const ids = botIds(m)
  const bare = ids.map((x) => String(x).split('@')[0].split(':')[0])
  const mentioned = Array.isArray(m.mentionedJid) ? m.mentionedJid : []
  if (mentioned.some((jid) => bare.includes(String(jid || '').split('@')[0].split(':')[0]))) return true
  const body = String(m.body || '')
  if (bare.some((num) => num && (body.includes(`@${num}`) || body.includes(`+${num}`)))) return true
  try {
    const config = require('../config')
    const name = String((config && config.botName) || '').trim().toLowerCase()
    if (name && body.toLowerCase().includes(`@${name}`)) return true
  } catch (_) {}
  return false
}

// ------------------------------------------------------------------ gating ----

/**
 * Gerbang utama. `feature` = 'agent' | 'ai'.
 * Mengembalikan { ok, code, message, role, need, group }.
 * Chat pribadi selalu lolos di sini — soal "hanya owner" tetap dicek oleh
 * Assistant/Ai sendiri supaya pesan privat tidak berubah perilaku.
 */
function check(m, feature = 'agent', opts = {}) {
  const cfg = resolve(m && m.db)
  // Peserta grup sudah disiapkan handler (m.__participants) — jangan ambil ulang.
  const participants = opts.participants === undefined ? (m && m.__participants) || [] : opts.participants
  if (!m || !m.isGroup) {
    return { ok: true, code: 'private', scope: 'private', group: null, role: m && m.isOwner ? 'owner' : 'member' }
  }
  const label = feature === 'ai' ? 'Ask AI' : 'Personal Agent'
  const deny = (code, message, extra = {}) => ({
    ok: false,
    code,
    message: `🔒 ${message}`,
    role: extra.role,
    need: extra.need,
    group: extra.group || null,
    feature,
  })
  if (!FEATURES.includes(feature)) {
    return { ok: false, code: 'bad-feature', message: '🔒 Fitur akses tidak dikenal.', group: null, feature }
  }
  if (!cfg.enabled) {
    return deny('disabled', `*${label}* sedang ditutup owner untuk semua grup.\nPakai ${label} di *chat pribadi* bot saja.`)
  }
  const allow = (group, role) => {
    // Statistik dipakai untuk .groupaccess status; ditulis ke objek database
    // yang hidup (tanpa save tiap pesan) supaya ikut tersimpan simpanan berikut.
    if (opts.count !== false) {
      const live = store(m.db)
      if (live && live.stats) live.stats.allowed = (live.stats.allowed || 0) + 1
    }
    return {
      ok: true,
      code: 'allowed',
      scope: 'group',
      message: '',
      feature,
      role,
      need: group.role,
      group,
    }
  }
  const role = roleOf(m, participants)
  const group = cfg.groups[m.chat] || null
  if (!group || group.enabled !== true) {
    if (cfg.enforce) {
      return deny(
        'not-allowed',
        `grup ini *belum diizinkan* memakai ${label.toLowerCase()}.\n` +
          `Hanya grup yang didaftarkan owner yang bisa menghubungi agent.\n\n` +
          `Jid grup ini: \`${m.chat}\`\n` +
          `Owner: \`.groupaccess add ${m.chat}\``,
        { role }
      )
    }
    // enforce=off: grup tak terdaftar memakai konfigurasi global, dengan fitur
    // yang diminta dianggap aktif (saklar per fitur grup memang belum diset).
    const loose = {
      jid: m.chat,
      name: m.groupName || '',
      enabled: true,
      overridden: [],
      unlisted: true,
      agent: cfg.agent,
      ai: cfg.ai,
      role: cfg.role,
      tools: cfg.tools,
      route: cfg.route,
      mention: cfg.mention,
      autoReply: cfg.autoReply,
      note: '',
    }
    loose[feature] = true
    // Batas role TETAP ditegakkan walau allowlist dilonggarkan.
    if (!meets(role, loose.role)) {
      return deny(
        'role',
        `${label} di grup mana pun khusus *${ROLE_LABEL[loose.role] || loose.role}* (aturan global owner).\n` +
          `Peranmu di grup ini: *${roleLabel(role)}*.`,
        { role, need: loose.role, group: loose }
      )
    }
    return allow(loose, role)
  }
  if (group[feature] !== true) {
    return deny(`no-${feature}`, `fitur *${label.toLowerCase()}* dimatikan untuk grup ini oleh owner.`, { group, role })
  }
  if (!meets(role, group.role)) {
    return deny(
      'role',
      `${label} di grup ini khusus *${ROLE_LABEL[group.role] || group.role}*.\n` +
        `Peranmu saat ini: *${roleLabel(role)}*.\nMinta owner menaikkan batas bila perlu.`,
      { role, need: group.role, group }
    )
  }
  return allow(group, role)
}

/** Boleh tidak alat berisiko `risk` dijalankan dari grup dengan level `tools`? */
function toolAllowed(tools, risk) {
  const level = TOOL_LEVELS.includes(String(tools || '').toLowerCase()) ? String(tools).toLowerCase() : 'read'
  if (level === 'none') return false
  if (risk === 'read') return true
  // Dari grup, write/high/blocked TIDAK pernah jalan otomatis — selalu butuh
  // persetujuan owner, bahkan di mode autonomous atau tools=full.
  return false
}

// ------------------------------------------------------------------ writes ----

function setGlobal(db, key, value) {
  const s = store(db)
  if (!s) return { ok: false, error: 'Database tidak tersedia.' }
  // 'enforce' hanya ada di lapisan global (sebuah grup ya masuk daftar atau tidak).
  if (BOOL_KEYS.includes(key) || key === 'enforce') {
    if (value !== true && value !== false) return { ok: false, error: 'Nilai harus on atau off.' }
    s[key] = value
  } else if (ENUM_KEYS[key]) {
    const v = oneOf(value, ENUM_KEYS[key], '')
    if (!v) return { ok: false, error: `Nilai harus: ${ENUM_KEYS[key].join(', ')}.` }
    s[key] = v
  } else {
    return { ok: false, error: `Pengaturan "${key}" tidak dikenal.` }
  }
  if (db && typeof db.save === 'function') db.save()
  return { ok: true, scope: 'global', key, value: s[key] }
}

/**
 * Set satu kunci. `scope` = undefined/'global' untuk default semua grup,
 * 'all' untuk menulis eksplisit ke semua grup, atau jid grup tertentu.
 * Nilai `auto|default` menghapus override sehingga grup mengikuti global.
 */
function setOption(db, scope, key, value) {
  const s = store(db)
  if (!s) return { ok: false, error: 'Database tidak tersedia.' }
  const isGlobal = !scope || String(scope).toLowerCase() === 'global'
  if (isGlobal && key === 'enabled') return setGlobal(db, 'enabled', value)
  if (isGlobal) {
    if (value !== null && ['auto', 'default', 'reset'].includes(String(value).toLowerCase())) {
      delete s[key]
      db.save()
      return { ok: true, scope: 'global', key, value: 'auto' }
    }
    return setGlobal(db, key, value)
  }
  const targets = String(scope).toLowerCase() === 'all' ? Object.keys(s.groups) : [scope]
  if (!targets.length) return { ok: false, error: 'Belum ada grup di allowlist.' }
  const changed = []
  const undo = ['auto', 'default', 'reset'].includes(String(value || '').toLowerCase())
  for (const jid of targets) {
    const entry = s.groups[jid]
    if (!entry) continue
    if (key === 'note') {
      entry.note = String(value === true || value === false ? '' : value || '').slice(0, LIMITS.note)
    } else if (key === 'name') {
      entry.name = String(value || '').slice(0, LIMITS.name)
    } else if (undo) {
      if (key === 'enabled') entry.enabled = true
      else delete entry[key]
    } else if (BOOL_KEYS.includes(key)) {
      const on = typeof value === 'boolean' ? value : onOff(value)
      if (on === null) return { ok: false, error: 'Nilai harus on, off, atau auto.' }
      entry[key] = on
    } else if (ENUM_KEYS[key]) {
      const v = oneOf(value, ENUM_KEYS[key], '')
      if (!v) return { ok: false, error: `Nilai harus ${ENUM_KEYS[key].join(', ')} (atau auto).` }
      entry[key] = v
    } else {
      return { ok: false, error: `Pengaturan "${key}" tidak dikenal.` }
    }
    entry.updatedAt = Date.now()
    changed.push(jid)
  }
  if (!changed.length) return { ok: false, error: `Grup ${scope} tidak ada di allowlist. Daftarkan dulu lewat .groupaccess add.` }
  db.save()
  return { ok: true, scope, key, value: undo ? 'auto' : value, changed }
}

/** Mendaftarkan grup ke allowlist (idempoten — update nama/catatan saja). */
function addGroup(db, jid, patch = {}) {
  const s = store(db)
  if (!s) return { ok: false, error: 'Database tidak tersedia.' }
  if (!isGroupJid(jid)) return { ok: false, error: 'Itu bukan JID grup (formatnya `123456@g.us`).' }
  const before = s.groups[jid]
  if (!before && Object.keys(s.groups).length >= LIMITS.groups) {
    return { ok: false, error: `Allowlist penuh (maks ${LIMITS.groups} grup). Hapus dulu lewat \`.groupaccess del <jid>\`.` }
  }
  const entry = before || { jid, enabled: true, addedAt: Date.now() }
  entry.jid = jid
  entry.enabled = true
  if (typeof patch.name === 'string' && patch.name) entry.name = patch.name.slice(0, LIMITS.name)
  if (typeof patch.note === 'string') entry.note = patch.note.slice(0, LIMITS.note)
  for (const key of OVERRIDE_KEYS) {
    if (patch[key] === undefined) continue
    if (BOOL_KEYS.includes(key)) entry[key] = patch[key] === true
    else if (ENUM_KEYS[key].includes(String(patch[key]).toLowerCase())) entry[key] = String(patch[key]).toLowerCase()
  }
  entry.updatedAt = Date.now()
  s.groups[jid] = entry
  if (s.requests[jid]) delete s.requests[jid]
  db.save()
  return { ok: true, created: !before, group: mergeEntry(entry, globals(db)) }
}

function removeGroup(db, jid) {
  const s = store(db)
  if (!s) return { ok: false, error: 'Database tidak tersedia.' }
  if (!s.groups[jid]) return { ok: false, error: `Grup \`${jid}\` memang belum ada di allowlist.` }
  delete s.groups[jid]
  if (s.requests[jid]) delete s.requests[jid]
  db.save()
  return { ok: true, jid }
}

function listGroups(db) {
  const cfg = resolve(db)
  return Object.values(cfg.groups).sort((a, b) => Number(b.addedAt || 0) - Number(a.addedAt || 0))
}

// ------------------------------------------------------- permintaan user ----

/**
 * Catat percobaan memakai agent/AI di grup yang belum diizinkan dan kabari
 * owner (dibatasi cooldown supaya tidak jadi spam). Hanya dipanggil saat user
 * benar-benar mencoba (memakai .asisten / .ai), bukan untuk semua pesan grup.
 */
function recordAttempt(m, feature = 'agent', opts = {}) {
  const s = store(m && m.db)
  if (!s || !m || !m.isGroup) return { recorded: false }
  const now = Date.now()
  const item = s.requests[m.chat] || { count: 0, firstAt: now, name: '', lastSender: '', notifiedAt: 0 }
  item.count = (item.count || 0) + 1
  item.lastAt = now
  item.name = String(m.groupName || item.name || '').slice(0, LIMITS.name)
  item.lastSender = m.sender || item.lastSender
  item.feature = feature
  s.requests[m.chat] = item
  s.stats.denied = (s.stats.denied || 0) + 1
  trimRequests(s)
  db_save(m.db)

  const notify = now - Number(item.notifiedAt || 0) > REQUEST_COOLDOWN
  if (notify) {
    item.notifiedAt = now
    db_save(m.db)
    if (!opts.silent) {
      const P = opts.prefix || (m.config && m.config.prefix) || '.'
      const num = m.func && typeof m.func.num === 'function' ? m.func.num(item.lastSender) : String(item.lastSender || '-').split('@')[0]
      notifyOwners(
        m.sock,
        m.db,
        `🔔 *PERMINTAAN AKSES DI GRUP*\n\n` +
          `Grup     : ${item.name || '-'}\n` +
          `JID      : \`${m.chat}\`\n` +
          `Fitur    : ${feature === 'ai' ? 'Ask AI (.ai)' : 'Personal Agent (.asisten)'}\n` +
          `Peminta  : ${num} (peran: ${roleLabel(roleOf(m))})\n` +
          `Percobaan ke-${item.count}\n\n` +
          `Bila mau diizinkan:\n\`${P}groupaccess add ${m.chat}\`\n` +
          `Batas role grup itu: \`${P}groupaccess role admin ${m.chat}\`\n` +
          `Abaikan saja kalau memang tidak mau.`
      )
    }
  }
  return { recorded: true, notified: notify && !opts.silent, item }
}

function trimRequests(s) {
  const keys = Object.keys(s.requests)
  while (keys.length > LIMITS.requests) {
    const oldest = keys.sort((a, b) => Number(s.requests[a].lastAt || 0) - Number(s.requests[b].lastAt || 0))[0]
    if (!oldest) break
    delete s.requests[oldest]
    keys.splice(keys.indexOf(oldest), 1)
  }
}

function db_save(db) {
  try {
    if (db && typeof db.save === 'function') db.save()
  } catch (_) {}
}

function notifyOwners(sock, db, text) {
  // Kirim-apis (fire-and-forget) untuk notifikasi ringan; kegagalan dicatat,
  // tidak pernah melempar ke pemanggil.
  sendOwners(sock, db, text).catch((e) => logger.error('groupaccess notify', e))
}

/** Kirim teks ke semua owner; mengembalikan { sent } supaya pemanggil bisa fallback. */
async function sendOwners(sock, db, text) {
  try {
    // Guardian sudah memfilter jid owner yang bisa di-DM (@s.whatsapp.net).
    return await require('./guardian').sendOwners(sock, db, text)
  } catch (e) {
    logger.error('groupaccess sendOwners', e)
    return { sent: 0 }
  }
}

function listRequests(db) {
  const s = store(db)
  if (!s) return []
  return Object.entries(s.requests)
    .map(([jid, item]) => ({ jid, ...item }))
    .sort((a, b) => Number(b.lastAt || 0) - Number(a.lastAt || 0))
}

function clearRequests(db, jid) {
  const s = store(db)
  if (!s) return 0
  let n = 0
  if (jid && s.requests[jid]) {
    delete s.requests[jid]
    n = 1
  } else {
    n = Object.keys(s.requests).length
    s.requests = {}
  }
  db_save(db)
  return n
}

/** Daftarkan grup dari .env (GROUP_ACCESS_ALLOW) saat startup. */
function bootstrap(db) {
  const env = envDefaults()
  if (!env.allow.length) return { added: 0, skipped: 0 }
  let added = 0
  let skipped = 0
  for (const raw of env.allow) {
    if (!isGroupJid(raw)) {
      skipped++
      continue
    }
    const res = addGroup(db, raw, { note: 'dari .env GROUP_ACCESS_ALLOW' })
    if (res.ok && res.created) added++
  }
  return { added, skipped }
}

// ------------------------------------------------------------------ resolve ----

/**
 * Cari JID grup dari input owner. Yang diterima:
 *   - JID penuh `120363...@g.us`
 *   - angka saja `120363...`  -> ditambah `@g.us`
 *   - reply/forward pesan dari grup itu (JID asal ada di contextInfo.remoteJid)
 *   - tanpa argumen saat owner sedang berada di dalam grup -> grup saat ini
 * Link invite (chat.whatsapp.com/CODE) tidak bisa diubah ke JID tanpa ikut
 * bergabung, jadi diarahkan ke `.groupaccess listgrup`.
 */
function parseGroupJid(m, raw) {
  const s = String(raw || '').trim()
  if (s) {
    if (isGroupJid(s)) return s
    if (/chat\.whatsapp\.com|wa\.me\//i.test(s)) return { invite: true }
    const digits = s.replace(/[^0-9]/g, '')
    if (digits.length >= 8) return `${digits}@g.us`
    return ''
  }
  try {
    const ctx = m.raw && m.raw.message && (m.raw.message.extendedTextMessage || {}).contextInfo
    if (ctx && isGroupJid(ctx.remoteJid)) return ctx.remoteJid
    if (m.quoted && isGroupJid(m.quoted.originJid)) return m.quoted.originJid
  } catch (_) {}
  if (m.isGroup && isGroupJid(m.chat)) return m.chat
  return ''
}

async function listJoinedGroups(sock, filter) {
  if (!sock || typeof sock.groupFetchAllParticipating !== 'function') return []
  let data
  try {
    data = await sock.groupFetchAllParticipating()
  } catch (e) {
    logger.error('groupFetchAllParticipating', e)
    return []
  }
  const rows = Object.values(data || {})
    .map((g) => ({
      jid: g.id || g.jid,
      subject: g.subject || '',
      members: Array.isArray(g.participants) ? g.participants.length : 0,
    }))
    .filter((g) => isGroupJid(g.jid))
    .sort((a, b) => String(a.subject).localeCompare(String(b.subject)))
  const needle = String(filter || '').trim().toLowerCase()
  if (!needle) return rows
  return rows.filter((g) => g.subject.toLowerCase().includes(needle) || g.jid.includes(needle))
}

// ------------------------------------------------------------------ format ----

function flag(v) {
  return v ? '✅' : '🚫'
}

function statusText(m) {
  const db = m.db
  const cfg = resolve(db)
  const entries = listGroups(db)
  const P = m.config.prefix
  let t = '🗂️ *AKSES GRUP — PERSONAL AGENT & ASK AI*\n\n'
  t += `Saklar grup   : ${cfg.enabled ? '✅ aktif' : '⏸️ mati (hanya chat pribadi)'}\n`
  t += `Allowlist     : ${cfg.enforce ? flag(true) + ' wajib (hanya grup terdaftar)' : flag(false) + ' longgar (semua grup boleh)'}\n`
  t += `Default fitur : agent ${flag(cfg.agent)} | ai ${flag(cfg.ai)}\n`
  t += `Batas role    : ${ROLE_LABEL[cfg.role] || cfg.role}\n`
  t += `Alat agent    : ${cfg.tools} | Rute jawaban: ${cfg.route}\n`
  t += `Auto-reply    : ${flag(cfg.autoReply)} (harus tag bot: ${cfg.mention ? 'ya' : 'tidak'})\n`
  t += `Grup terdaftar: ${entries.length}/${LIMITS.groups} (maks ${LIMITS.groups})\n`
  t += `Pemakaian     : ${cfg.stats.allowed || 0} permintaan diizinkan | ${cfg.stats.denied || 0} ditolak | ${cfg.stats.routed || 0} jawaban dikirim privat\n`
  if (entries.length) {
    t += `\n*DAFTAR GRUP* (override ditandai ` + '`*`' + `)\n`
    for (const g of entries.slice(0, 12)) {
      const ov = (k) => (g.overridden.includes(k) ? '*' : '')
      t += `• ${g.name || g.jid}\n`
      t += `  role ${ov('role')}${g.role}${ov('role')} | agent ${ov('agent')}${flag(g.agent)}${ov('agent')} | ai ${ov('ai')}${flag(g.ai)}${ov('ai')} | alat ${ov('tools')}${g.tools}${ov('tools')}\n`
    }
    if (entries.length > 12) t += `… sisanya: \`${P}groupaccess list\`\n`
  } else {
    t += `\nBelum ada grup terdaftar. Cara menambah:\n` +
      `1) balas/forward salah satu pesan grup itu ke bot lalu \`${P}groupaccess add\`\n` +
      `2) atau \`${P}groupaccess listgrup\` untuk melihat JID, lalu \`${P}groupaccess add <jid>\``
  }
  const requests = listRequests(db)
  if (requests.length) {
    t += `\n\n🔔 *PERMINTAAN BELUM DISETUJUI* (${requests.length})\n`
    for (const r of requests.slice(0, 5)) {
      t += `• ${r.name || r.jid} — ${r.count || 1}x mencoba (${r.feature || 'agent'})\n`
    }
    t += `Rinci: \`${P}groupaccess requests\``
  }
  return t.slice(0, 3900)
}

function groupDetail(db, jid) {
  const cfg = resolve(db)
  const g = cfg.groups[jid]
  if (!g) return `❌ Grup \`${jid}\` belum masuk allowlist. Tambah: \`.groupaccess add ${jid}\``
  const ov = (k) => (g.overridden.includes(k) ? ' (override)' : ' (ikut default)')
  return (
    `🗂️ *PENGATURAN GRUP*\n\n` +
    `Nama       : ${g.name || '-'}\n` +
    `JID        : \`${jid}\`\n` +
    `Status     : ${g.enabled ? '✅ aktif' : '⏸️ dijeda'}\n` +
    `Agent      : ${g.agent ? '✅ boleh' : '🚫 tidak boleh'}${ov('agent')}\n` +
    `Ask AI     : ${g.ai ? '✅ boleh' : '🚫 tidak boleh'}${ov('ai')}\n` +
    `Batas role : ${ROLE_LABEL[g.role] || g.role}${ov('role')}\n` +
    `Alat agent : ${g.tools} — ${TOOL_LABEL[g.tools] || g.tools}${ov('tools')}\n` +
    `Rute       : ${g.route} — ${ROUTE_LABEL[g.route] || g.route}${ov('route')}\n` +
    `Auto-reply : ${g.autoReply ? '✅ on' : '🚫 off'}${ov('autoReply')} | harus tag bot: ${g.mention ? 'ya' : 'tidak'}${ov('mention')}\n` +
    `Catatan    : ${g.note || '-'}\n` +
    `Ditambah   : ${g.addedAt ? new Date(g.addedAt).toLocaleString('id-ID') : '-'}`
  )
}

function helpText(prefix = '.') {
  return (
    `🗂️ *ATUR AKSES GRUP — AGENT & ASK AI* (khusus owner)\n\n` +
    `${prefix}groupaccess status\n` +
    `${prefix}groupaccess list | listgrup [nama]\n` +
    `${prefix}groupaccess add <jid|reply pesan grup> [nama grup]\n` +
    `${prefix}groupaccess del <jid|all>\n` +
    `${prefix}groupaccess on|off                  # saklar akses grup total\n` +
    `${prefix}groupaccess enforce on|off          # wajib allowlist / semua grup\n` +
    `\n*Per fitur / per grup* \\[jid|all\\] tanpa argumen = default semua grup\\n` +
    `${prefix}groupaccess agent on|off [jid|all]\n` +
    `${prefix}groupaccess ai on|off [jid|all]\n` +
    `${prefix}groupaccess role <owner|admin|member|all> [jid|all]\n` +
    `${prefix}groupaccess tools <none|read|full> [jid|all]\n` +
    `${prefix}groupaccess route <smart|group|private|admin|owner> [jid|all]\n` +
    `${prefix}groupaccess mention on|off [jid|all]\n` +
    `${prefix}groupaccess autochat on|off [jid|all]\n` +
    `${prefix}groupaccess note <teks> <jid>\n` +
    `${prefix}groupaccess detail <jid>\n` +
    `${prefix}groupaccess requests | clearrequests [jid]\n` +
    `${prefix}groupaccess test <agent|ai> [jid]   # cek peranmu & keputusan gerbang\n` +
    `${prefix}groupaccess clearchat <jid|all>     # hapus riwayat AI/agent grup\n\n` +
    `*Batas role:*\n${Object.entries(ROLE_LABEL).map(([k, v]) => `• ${k} = ${v}`).join('\n')}\n\n` +
    `*Rute jawaban:*\n${Object.entries(ROUTE_LABEL).map(([k, v]) => `• ${k} = ${v}`).join('\n')}\n\n` +
    `*Level alat:*\n${Object.entries(TOOL_LABEL).map(([k, v]) => `• ${k} = ${v}`).join('\n')}`
  ).slice(0, 3900)
}

module.exports = {
  ROLES,
  ROLE_RANK,
  ROLE_LABEL,
  ROUTES,
  ROUTE_LABEL,
  TOOL_LEVELS,
  TOOL_LABEL,
  FEATURES,
  OVERRIDE_KEYS,
  BOOL_KEYS,
  LIMITS,
  REQUEST_COOLDOWN,
  boolEnv,
  onOff,
  store,
  globals,
  resolve,
  mergeEntry,
  groupConfig,
  envDefaults,
  isGroupJid,
  roleOf,
  roleLabel,
  meets,
  mentionsBot,
  check,
  toolAllowed,
  setGlobal,
  setOption,
  addGroup,
  removeGroup,
  listGroups,
  recordAttempt,
  listRequests,
  clearRequests,
  sendOwners,
  bootstrap,
  parseGroupJid,
  listJoinedGroups,
  statusText,
  groupDetail,
  helpText,
}
