'use strict'

// ============================================================
//  identity.js — identitas orang SELALU NOMOR WhatsApp, bukan LID
//
//  Sebagian chat WhatsApp sekarang dialamatkan pakai "LID" (Linked ID —
//  identitas anonim, contoh `123456789012345@lid`): grup dengan fitur
//  "sembunyikan nomor" dan chat pribadi akun-akun baru. LID **bukan** nomor
//  telepon — angkanya tidak bisa dibuka lewat wa.me, tidak bisa diketik
//  owner/admin, dan tidak cocok dengan `OWNER_NUMBER`.
//
//  Aturan modul ini:
//   1. Identitas yang DITAMPILKAN, DISIMPAN, dan DIBANDINGKAN adalah JID
//      nomor: `62812xxx@s.whatsapp.net`.
//   2. `@lid` hanya dipakai sebagai KUNCI SEMENTARA untuk mencari nomor
//      aslinya, lalu hasilnya diingat di database (`identity.lidToPn`)
//      supaya pemetaan tetap ada walau bot restart.
//   3. Angka LID TIDAK PERNAH ditebak-tebak sebagai nomor. (Versi lama
//      membandingkan angka LID dengan daftar owner; itu artinya orang lain
//      yang angka LID-nya kebetulan sama bisa lolos jadi owner.)
//
//  Sumber pemetaan LID -> nomor, dari yang paling akurat:
//   1. atribut stanza pesan: `key.participantPn` / `key.senderPn`
//      (dari `participant_pn` / `sender_pn` yang dikirim WhatsApp);
//   2. metadata grup: Baileys menaruh `participant.jid` (nomor) dan
//      `participant.lid` (LID) berdampingan;
//   3. `OWNER_LID_MAP` di `.env` — pasangan yang dinyatakan admin;
//   4. pemetaan yang sudah dipelajari bot (`db.identity.lidToPn`);
//   5. identitas bot sendiri (auth creds: `sock.user.id` + `sock.user.lid`);
//   6. `sock.signalRepository.lidMapping.getPNForLID()` bila versi Baileys
//      yang dipakai menyediakannya (Baileys baru / v7).
//
//  Kalau semuanya gagal, JID dibiarkan `@lid`: bot tetap jalan, tapi
//  identitas itu tidak pernah dianggap owner/admin dan tidak pernah
//  disimpan sebagai "nomor".
//
//  Lihat juga: docs/IDENTITY.md, test/identity.test.js
// ============================================================

const PN_SUFFIX = '@s.whatsapp.net'
const LID_SUFFIX = '@lid'
const GROUP_SUFFIX = '@g.us'

function isLid(jid) {
  return typeof jid === 'string' && jid.endsWith(LID_SUFFIX)
}

function isPn(jid) {
  return typeof jid === 'string' && jid.endsWith(PN_SUFFIX)
}

function isGroup(jid) {
  return typeof jid === 'string' && jid.endsWith(GROUP_SUFFIX)
}

/**
 * Bentuk kanonik sebuah JID: buang sufiks device/agent
 * (`62812xxx:9@s.whatsapp.net` -> `62812xxx@s.whatsapp.net`).
 * Mengembalikan '' kalau bukan JID.
 */
function bare(jid) {
  if (typeof jid !== 'string') return ''
  const at = jid.indexOf('@')
  if (at <= 0) return ''
  const user = jid.slice(0, at).split(':')[0].split('_')[0]
  const server = jid.slice(at + 1)
  if (!user || !server) return ''
  return `${user}@${server}`
}

/** Bagian angka saja — untuk ditampilkan ke user. */
function num(jid) {
  const b = bare(jid)
  if (b) return b.split('@')[0]
  return String(jid || '').split('@')[0] || '-'
}

function asPn(number) {
  const n = String(number || '').replace(/[^0-9]/g, '')
  return n ? `${n}${PN_SUFFIX}` : ''
}

function asLid(number) {
  const n = String(number || '').replace(/[^0-9]/g, '')
  return n ? `${n}${LID_SUFFIX}` : ''
}

/** Apakah dua JID menunjuk identitas yang sama (abaikan device suffix)? */
function sameJid(a, b) {
  const x = bare(a)
  const y = bare(b)
  return !!x && x === y
}

/**
 * Terima JID ATAU nomor mentah (`0812xxx`, `+62 812-xxxx`, `62812xxx`).
 * Dipakai helper database supaya `addOwner('0812xxx')` tetap masuk akal
 * (nomor dinormalkan lewat config.toJid: 0812.. -> 62812..@s.whatsapp.net).
 */
function toJid(input) {
  const b = bare(input)
  if (b) return b
  try {
    const cfg = require('../config')
    return typeof cfg.toJid === 'function' ? cfg.toJid(input) : ''
  } catch (_) {
    return ''
  }
}

// --------------------------------------------------------------- penyimpanan --

/** Blok `identity` di database (dibuat otomatis bila belum ada). */
function store(db, create = true) {
  const data = db && db.data
  if (!data || typeof data !== 'object') return null
  if (!data.identity || typeof data.identity !== 'object' || Array.isArray(data.identity)) {
    if (!create) return null
    data.identity = { lidToPn: {}, pending: {} }
  }
  const s = data.identity
  for (const key of ['lidToPn', 'pending']) {
    if (!s[key] || typeof s[key] !== 'object' || Array.isArray(s[key])) s[key] = {}
  }
  return s
}

/** Nomor yang sudah dipelajari untuk sebuah LID ('' kalau belum tahu). */
function pnFor(db, lid) {
  const s = store(db, false)
  const key = bare(lid)
  if (!s || !isLid(key)) return ''
  const pn = bare(s.lidToPn[key])
  return isPn(pn) ? pn : ''
}

/** LID yang sudah dipelajari untuk sebuah nomor (kebalikannya). */
function lidFor(db, pn) {
  const s = store(db, false)
  const key = bare(pn)
  if (!s || !isPn(key)) return ''
  for (const [lid, mapped] of Object.entries(s.lidToPn)) {
    if (bare(mapped) === key && isLid(bare(lid))) return bare(lid)
  }
  return ''
}

function pendingFor(db, lid) {
  const s = store(db, false)
  const key = bare(lid)
  if (!s || !isLid(key)) return null
  return s.pending[key] || null
}

function pendingList(db) {
  const s = store(db, false)
  if (!s) return []
  return Object.entries(s.pending).map(([lid, info]) => ({ lid, ...(info || {}) }))
}

/**
 * Catat LID yang nomornya belum diketahui supaya owner bisa menindaklanjuti
 * (`.id` menampilkannya). Tidak ada nomor yang dikarang dari angka LID.
 */
function notePending(db, lid, name) {
  const s = store(db)
  const key = bare(lid)
  if (!s || !isLid(key)) return false
  const now = Date.now()
  const prev = s.pending[key]
  s.pending[key] = {
    name: name || (prev && prev.name) || '',
    firstSeen: (prev && prev.firstSeen) || now,
    lastSeen: now,
    hits: ((prev && prev.hits) || 0) + 1,
  }
  if (!prev) db.save()
  return true
}

/** Pindahkan satu kunci objek (mis. `users['x@lid']` -> `users['628xx@…']`). */
function moveKey(obj, from, to) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false
  if (!Object.prototype.hasOwnProperty.call(obj, from)) return false
  const value = obj[from]
  delete obj[from]
  if (!Object.prototype.hasOwnProperty.call(obj, to)) obj[to] = value
  return true
}

function moveArrayValue(list, from, to) {
  if (!Array.isArray(list)) return false
  const i = list.indexOf(from)
  if (i < 0) return false
  list.splice(i, 1)
  if (!list.includes(to)) list.push(to)
  return true
}

/**
 * Data lama yang terlanjur disimpan dengan kunci `@lid` dipindahkan ke kunci
 * nomor begitu pemetaannya diketahui. Tanpa ini, owner/pelanggan yang tadinya
 * tersimpan sebagai LID akan "hilang" setelah bot mulai memakai nomor.
 */
function migrate(db, lid, pn) {
  const data = db && db.data
  if (!data) return false
  let moved = false

  moved = moveArrayValue(data.owners, lid, pn) || moved
  moved = moveKey(data.users, lid, pn) || moved
  moved = moveKey(data.afk, lid, pn) || moved
  if (data.blacklist) moved = moveArrayValue(data.blacklist.users, lid, pn) || moved
  if (data.pingl) moved = moveArrayValue(data.pingl.staff, lid, pn) || moved

  const mc = data.minecraft
  if (mc) {
    moved = moveKey(mc.entries, lid, pn) || moved
    for (const srv of Object.values(mc.servers || {})) {
      if (!srv || typeof srv !== 'object') continue
      if (bare(srv.ownerJid) === lid) {
        srv.ownerJid = pn
        moved = true
      }
      if (bare(srv.addedBy) === lid) {
        srv.addedBy = pn
        moved = true
      }
    }
  }

  const assistant = data.assistant
  for (const action of Object.values((assistant && assistant.pending) || {})) {
    if (action && bare(action.requestedBy) === lid) {
      action.requestedBy = pn
      moved = true
    }
  }
  if (data.groupAccess) moved = moveKey(data.groupAccess.requests, lid, pn) || moved

  return moved
}

/**
 * Simpan pemetaan LID -> nomor (dan rapikan data lama yang memakai LID).
 * @returns {string} nomor (JID) yang dipakai, atau '' kalau input tidak valid.
 */
function learn(db, lid, pn, opts = {}) {
  const s = store(db)
  const L = bare(lid)
  const P = bare(pn)
  if (!s || !isLid(L) || !isPn(P)) return ''
  const changed = s.lidToPn[L] !== P
  s.lidToPn[L] = P
  if (s.pending[L]) delete s.pending[L]
  const moved = migrate(db, L, P)
  if ((changed || moved) && !opts.silent && typeof db.save === 'function') db.save()
  return P
}

// ------------------------------------------------------------ pemetaan .env --

/** Pasangan LID->nomor yang dinyatakan admin di `.env` (OWNER_LID_MAP). */
function envMap() {
  try {
    const cfg = require('../config')
    if (cfg && cfg.lidMap && typeof cfg.lidMap === 'object') return cfg.lidMap
  } catch (_) {}
  return {}
}

// ------------------------------------------------------------------ resolusi --

/** Identitas bot sendiri: nomor + LID dari auth creds Baileys. */
function meIdentity(sock) {
  const u = sock && sock.user
  const pn = bare(u && u.id)
  const lid = bare(u && u.lid)
  return { pn: isPn(pn) ? pn : '', lid: isLid(lid) ? lid : '' }
}

/** Nomor dari atribut stanza pesan (`participant_pn` / `sender_pn`). */
function fromKey(key, lid) {
  if (!key || typeof key !== 'object') return ''
  const pairs = [
    [key.participantLid, key.participantPn],
    [key.senderLid, key.senderPn],
    [key.participant, key.participantPn],
    [key.remoteJid, key.senderPn],
  ]
  for (const [left, right] of pairs) {
    if (bare(left) !== lid) continue
    const pn = bare(right)
    if (isPn(pn)) return pn
  }
  return ''
}

/** Nomor dari metadata grup (peserta: `jid` = nomor, `lid` = LID). */
function fromParticipants(participants, lid) {
  if (!Array.isArray(participants)) return ''
  for (const p of participants) {
    if (!p || typeof p !== 'object') continue
    const ids = [bare(p.lid), bare(p.id)].filter(Boolean)
    if (!ids.includes(lid)) continue
    const jid = bare(p.jid)
    if (isPn(jid)) return jid
    const id = bare(p.id)
    if (isPn(id)) return id
  }
  return ''
}

function botSelf(sock, lid) {
  const me = meIdentity(sock)
  return me.lid && me.lid === lid && me.pn ? me.pn : ''
}

/**
 * Ubah `@lid` menjadi nomor WhatsApp. Sinkron (tanpa I/O jaringan).
 * JID yang bukan LID dikembalikan apa adanya; LID yang belum bisa
 * dipetakan juga dikembalikan apa adanya supaya tidak ada nomor karangan.
 *
 * @param {string} jid
 * @param {object} ctx  { db, key, participants, sock }
 */
function resolve(jid, ctx = {}) {
  const lid = bare(jid)
  if (!isLid(lid)) return lid
  const found =
    fromKey(ctx.key, lid) ||
    fromParticipants(ctx.participants, lid) ||
    envMap()[lid] ||
    pnFor(ctx.db, lid) ||
    botSelf(ctx.sock, lid)
  if (found) return learn(ctx.db, lid, found)
  return lid
}

/** Sumber tambahan untuk Baileys yang punya `signalRepository.lidMapping`. */
async function fromSignalRepository(sock, lid) {
  try {
    const repo = sock && sock.signalRepository
    const mapping = repo && repo.lidMapping
    if (!mapping || typeof mapping.getPNForLID !== 'function') return ''
    const res = await mapping.getPNForLID(lid)
    const pn = bare(typeof res === 'string' ? res : (res && (res.jid || res.pn)) || '')
    return isPn(pn) ? pn : ''
  } catch (_) {
    return ''
  }
}

/** Seperti resolve(), tapi ikut menanyakan signalRepository (async). */
async function resolveAsync(jid, ctx = {}) {
  const lid = bare(jid)
  if (!isLid(lid)) return lid
  const quick = resolve(lid, ctx)
  if (quick !== lid) return quick
  const pn = await fromSignalRepository(ctx.sock, lid)
  if (pn) return learn(ctx.db, lid, pn)
  return lid
}

/**
 * Nomor paling mungkin dari seorang peserta grup — dipakai untuk kirim DM
 * ke admin grup (LID tidak bisa dijadikan tujuan DM yang bisa diandalkan).
 */
function pnOfParticipant(p, ctx = {}) {
  if (!p || typeof p !== 'object') return ''
  const jid = bare(p.jid)
  if (isPn(jid)) return jid
  for (const candidate of [p.lid, p.id]) {
    const b = bare(candidate)
    if (isPn(b)) return b
    if (isLid(b)) {
      const known = resolve(b, { ...ctx, participants: ctx.participants || [p] })
      if (isPn(known)) return known
    }
  }
  return ''
}

// -------------------------------------------------------------- daftar owner --

/**
 * Daftar owner dalam bentuk siap pakai.
 *
 * @returns {{pn:string[], lids:string[], unresolved:string[]}}
 *   `pn`         : owner dengan nomor (dipakai untuk cek & kirim pesan)
 *   `lids`       : owner yang HANYA dikenal sebagai LID (mis. ditulis di
 *                  `OWNER_LID`) — tetap dihormati, tapi bot akan memintanya
 *                  menyebut nomor supaya bisa dipakai normal
 *   `unresolved` : entri LID yang belum ketemu nomornya
 */
function ownerEntries(db) {
  let config = null
  try {
    config = require('../config')
  } catch (_) {}
  const pn = new Set()
  const lids = new Set()
  const unresolved = []

  const addPn = (jid) => {
    // `toJid` sekaligus menerima nomor mentah (0812xxx / 62812xxx) bila ada
    // entri database lama yang belum berbentuk JID.
    const b = toJid(jid)
    if (isPn(b)) pn.add(b)
  }
  const addLid = (jid) => {
    const b = bare(jid)
    if (!isLid(b)) return
    const known = envMap()[b] || pnFor(db, b)
    if (known) {
      pn.add(known)
      return
    }
    lids.add(b)
    unresolved.push(b)
  }

  for (const jid of (config && config.envOwners) || []) addPn(jid)
  const dbOwners = (db && db.data && db.data.owners) || []
  for (const entry of dbOwners) (isLid(bare(entry)) ? addLid : addPn)(entry)
  for (const jid of (config && config.envOwnerLids) || []) addLid(jid)

  return { pn: [...pn], lids: [...lids], unresolved }
}

/** Daftar owner berupa nomor saja (dipakai untuk broadcast/notifikasi). */
function ownerJids(db) {
  return ownerEntries(db).pn
}

/** Apakah `jid` (nomor, nomor mentah, atau LID) salah satu owner? */
function isOwnerJid(jid, db) {
  const b = toJid(jid)
  if (!b) return false
  const { pn, lids } = ownerEntries(db)
  if (isPn(b)) return pn.includes(b)
  if (!isLid(b)) return false
  const known = envMap()[b] || pnFor(db, b)
  if (known) return pn.includes(known)
  return lids.includes(b)
}

/**
 * Rapikan `db.data.owners`: entri LID yang nomornya sudah diketahui diubah
 * jadi nomor. Dipanggil saat bot menyala supaya database lama ikut bersih.
 */
function canonicalizeOwners(db) {
  const data = db && db.data
  if (!data || !Array.isArray(data.owners)) return { moved: 0, unresolved: [], changed: false }
  const out = []
  const unresolved = []
  let moved = 0
  let changed = false
  for (const entry of data.owners) {
    // toJid: entri JID apa adanya, atau nomor mentah yang dinormalkan
    const b = toJid(entry)
    if (!b) {
      changed = true
      continue
    }
    if (!isLid(b)) {
      if (out.includes(b)) changed = true // duplikat dibuang
      else out.push(b)
      if (b !== entry) changed = true // sufiks device/format dirapikan
      continue
    }
    const known = envMap()[b] || pnFor(db, b)
    if (known) {
      if (!out.includes(known)) out.push(known)
      moved++
      changed = true
      continue
    }
    if (!out.includes(b)) out.push(b)
    unresolved.push(b)
    if (b !== entry) changed = true
  }
  if (changed) {
    data.owners = out
    if (typeof db.save === 'function') db.save()
  }
  return { moved, unresolved, changed }
}

/** Label untuk log/tampilan: nomor, atau LID yang jelas bukan nomor. */
function label(jid) {
  const b = bare(jid)
  if (!b) return '-'
  return isLid(b) ? `LID:${b.split('@')[0]}` : num(b)
}

module.exports = {
  PN_SUFFIX,
  LID_SUFFIX,
  GROUP_SUFFIX,
  isLid,
  isPn,
  isGroup,
  bare,
  num,
  asPn,
  asLid,
  sameJid,
  toJid,
  label,
  // penyimpanan
  store,
  pnFor,
  lidFor,
  learn,
  migrate,
  pendingFor,
  pendingList,
  notePending,
  // pemetaan .env
  envMap,
  // resolusi
  meIdentity,
  fromKey,
  fromParticipants,
  fromSignalRepository,
  resolve,
  resolveAsync,
  pnOfParticipant,
  // owner
  ownerEntries,
  ownerJids,
  isOwnerJid,
  canonicalizeOwners,
}
