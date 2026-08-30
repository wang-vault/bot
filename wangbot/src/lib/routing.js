// Rute jawaban agent/AI di grup.
//
// Prinsip yang diminta owner:
//   • obrolan biasa                 -> dijawab di grup;
//   • urusan server / hosting / MC  -> dijawab lewat chat privat owner;
//   • urusan admin grup (moderasi)  -> dijawab ke masing-masing admin (DM);
//   • urusan owner (konfigurasi, approval, data privat) -> hanya ke owner.
//
// Topik ditentukan dari 2 sinyal: kategori command yang dijalankan agent
// (paling akurat) dan kata kunci di teks jawaban. Mode `smart` memakai keduanya;
// mode `group|private|admin` memaksa satu tujuan.
//
// Semua tujuan privat diusahakan; kalau DM gagal (nomor diblokir, @lid, dsb)
// jawaban tetap dikembalikan ke grup — sudah disamarkan — supaya tidak hilang.

const logger = require('./logger')

const TOPICS = Object.freeze(['public', 'admin', 'ops', 'owner'])
const TOPIC_RANK = Object.freeze({ public: 0, admin: 1, ops: 2, owner: 3 })
const TOPIC_LABEL = Object.freeze({
  public: 'obrolan',
  admin: 'admin grup',
  ops: 'server & hosting',
  owner: 'pengaturan owner',
})

// Kategori command -> topik. Diisi conservatively: kalau ragu, lebih privat.
const CATEGORY_TOPIC = Object.freeze({
  community: 'public',
  info: 'public',
  utility: 'public',
  games: 'public',
  media: 'public',
  viewonce: 'public',
  moderation: 'admin',
  admin: 'admin',
  monitoring: 'ops',
  mc: 'ops',
  stats: 'ops',
  marketing: 'ops',
  cs: 'ops',
  broadcast: 'owner',
  ai: 'owner',
  assistant: 'owner',
  owner: 'owner',
})

const PATTERN = Object.freeze({
  owner:
    /\b(api[_ -]?key|apikey|secret|token|password|passwd|credential|private[_ -]?key|session|auth|root|ssh[_ -]?key|\.eval|\.exec|eval|exec|restore|backup|prefix|owner|nomor owner|database\.json)\b/i,
  ops:
    /\b(server|hosting|shared hosting|vps|dedicated|cloud|reseller|panel|pterodactyl|node|resource|cpu|ram|disk|ssd|nvme|bandwidth|uptime|downtime|status|error|crash|down|offline|online|maintenance|restart|deploy|database|db|docker|nginx|apache|mysql|mariadb|redis|port|ssh|ftp|ssl|tls|domain|dns|nameserver|ip publik|publicip|ipaddress|minecraft|\bmc\b|rcon|console|mod\s?pack|plugin|paper|spigot|whmcs|invoice|billing|pelanggan|customer|order|paket|harga|lisensi|lisence|memori|ssd|worker|queue|log)\b/i,
  admin:
    /\b(warn|warning|warnlist|kick|promote|demote|ban|banned|unban|blacklist|whitelist|groupsetting|grupsetting|group settings|peraturan|rules|welcome|goodbye|mute|unmute|antilink|antispam|antiflood|virtex|spam|approve|reject|revoke|link grup|moderasi|moderator|admin grup|hapus member|tag ?all)\b/i,
})

const MAX_LEN = 3900

function truncate(text) {
  const s = String(text || '')
  return s.length <= MAX_LEN ? s : s.slice(0, MAX_LEN - 20) + '\n…(dipotong)'
}

/** Samarkan rahasia sebelum teks dikirim ke orang selain owner. */
function sanitize(text) {
  const s = String(text || '')
  try {
    return require('./code-health').redact(s)
  } catch (_) {
    return s
      .replace(/\b(sk-[a-z0-9_-]{8,}|gsk_[a-z0-9_-]{8,}|AIza[a-z0-9_-]{8,})\b/gi, '[SECRET]')
      .replace(/(api[_-]?key|token|password)(\s*[:=]\s*)[^\s]+/gi, '$1$2[SECRET]')
  }
}

/**
 * Tentukan topik sebuah jawaban.
 * @param {string} text        teks balasan yang akan dikirim
 * @param {string[]} commands  nama command yang barusan dijalankan agent
 * @param {object} loader      loader command (untuk membaca kategori)
 */
function classify(text, commands = [], loader = null) {
  let topic = 'public'
  const raise = (candidate) => {
    if (TOPIC_RANK[candidate] > TOPIC_RANK[topic]) topic = candidate
  }
  for (const name of commands) {
    const cmd = loader && typeof loader.resolve === 'function' ? loader.resolve(name) : null
    const mapped = cmd && cmd.category && CATEGORY_TOPIC[String(cmd.category).toLowerCase()]
    if (mapped) raise(mapped)
  }
  const body = String(text || '')
  if (!body.trim()) return topic
  // Cek paling privat dulu supaya "kunci API di server" tidak dianggap ops.
  if (PATTERN.owner.test(body)) raise('owner')
  else if (PATTERN.ops.test(body)) raise('ops')
  if (PATTERN.admin.test(body) && TOPIC_RANK[topic] < TOPIC_RANK.ops) raise('admin')
  return topic
}

/** rute (dari akses grup) + topik -> tujuan. */
function routeFor(route, topic) {
  const r = String(route || 'smart').toLowerCase()
  if (r === 'group') return 'public'
  if (r === 'private' || r === 'owner') return 'owner'
  if (r === 'admin') return 'admin'
  return TOPICS.includes(topic) ? topic : 'public'
}

function ownerJids(db) {
  try {
    return require('./guardian').ownerJids(db)
  } catch (_) {
    const config = require('../config')
    return [...new Set([...(config.envOwners || []), ...((db && db.data && db.data.owners) || [])])].filter((j) =>
      String(j).endsWith('@s.whatsapp.net')
    )
  }
}

function dmable(jid) {
  return typeof jid === 'string' && jid.endsWith('@s.whatsapp.net')
}

async function groupAdmins(m) {
  // handler sudah menyiapkan daftar admin + metadata per pesan — pakai itu.
  if (Array.isArray(m.__admins) && m.__admins.length) return m.__admins.filter(dmable)
  let participants = Array.isArray(m.__participants) ? m.__participants : null
  if (!participants && typeof m.getMeta === 'function') {
    try {
      const meta = await m.getMeta()
      participants = meta && Array.isArray(meta.participants) ? meta.participants : []
    } catch (_) {
      participants = []
    }
  }
  const bot =
    m.sock && m.sock.user && m.sock.user.id ? String(m.sock.user.id).split(':')[0].split('@')[0] : ''
  const out = (participants || [])
    .filter((p) => p && (p.admin === 'admin' || p.admin === 'superadmin'))
    .map((p) => p.jid || p.id)
    .filter((jid) => dmable(jid) && String(jid).split('@')[0] !== bot)
  return [...new Set(out)]
}

/**
 * Kirim jawaban sesuai rute.
 *
 * @param {object} m     pesan
 * @param {string} text  isi jawaban
 * @param {object} opts  { commands, group, topic, note, mentions, label }
 * @returns {Promise<{topic:string,dest:string,sent:string[],notice:string}>}
 */
async function deliver(m, text, opts = {}) {
  const body = truncate(String(text || '').trim())
  if (!body) return { topic: 'public', dest: 'none', sent: [], notice: '' }
  if (!m.isGroup) {
    await m.reply(body, opts.opt || {})
    return { topic: 'private', dest: 'private', sent: [m.chat], notice: '' }
  }

  const group = opts.group || null
  const guessed = classify(body, opts.commands || [], m.loader)
  const topic = opts.topic || routeFor(group && group.route, guessed)
  const owners = ownerJids(m.db)
  const requester = m.sender
  let privateTargets = []
  if (topic === 'owner') privateTargets = owners
  else if (topic === 'ops') privateTargets = [...new Set([...owners, ...(dmable(requester) ? [requester] : [])])]
  else if (topic === 'admin') {
    const admins = await groupAdmins(m)
    privateTargets = admins.length ? admins : owners
  }
  privateTargets = [...new Set(privateTargets.filter(dmable))]

  const isOwnerHere = owners.includes(requester)

  // 1) jawaban penuh ke grup bila topiknya memang publik (atau tak ada tujuan privat)
  if (topic === 'public' || !privateTargets.length) {
    await m.reply(topic === 'public' ? body : sanitize(body), opts.opt || {})
    return { topic, dest: topic === 'public' ? 'group' : 'group-fallback', sent: [m.chat], notice: '' }
  }

  // 2) jawaban penuh ke tujuan privat (owner selalu dapat teks asli)
  const sent = []
  for (const jid of privateTargets) {
    const forOwner = owners.includes(jid)
    const payload = forOwner ? body : sanitize(body)
    try {
      await m.sock.sendMessage(jid, { text: payload })
      sent.push(jid)
    } catch (e) {
      logger.error('routing dm', e)
    }
  }

  // 3) DM semuanya gagal -> tetap kirim ke grup versi yang disamarkan
  if (!sent.length) {
    await m.reply(sanitize(body)).catch(() => {})
    return { topic, dest: 'group-fallback', sent: [m.chat], notice: '' }
  }

  // pencatat statistik rute (dipakai .groupaccess status), tanpa memaksa save
  try {
    const GA = require('./group-access')
    const live = GA.store(m.db)
    if (live && live.stats) live.stats.routed = (live.stats.routed || 0) + 1
  } catch (_) {}

  // 4) penanda di grup supaya orang tahu jawabannya ke mana
  const label = opts.label || 'agent'
  const who =
    topic === 'admin'
      ? 'admin grup'
      : topic === 'owner'
        ? 'owner'
        : isOwnerHere
          ? 'kamu (chat pribadi)'
          : 'owner & kamu (chat pribadi)'
  const notice =
    `🔒 *${label}* menjawab di *chat privat ${who}* — topik ${TOPIC_LABEL[topic] || topic} tidak ditampilkan di grup.\n` +
    (opts.note ? `${opts.note}\n` : '') +
    (isOwnerHere ? '' : `Bilas perlu dibagikan di grup, minta owner mengubah rute: \`.groupaccess route group\`.`)
  await m.reply(truncate(notice), { mentions: dmable(requester) ? [requester] : [] }).catch(() => {})
  return { topic, dest: 'private', sent, notice }
}

/** Ringkasan singkat untuk grup setelah hasil dikirim privat (mis. approval). */
function summary(name, command, topic) {
  return `✅ *${name}* menyelesaikan \`${command}\` — hasilnya dikirim ke ${
    topic === 'admin' ? 'admin grup' : 'chat privat owner'
  } (topik ${TOPIC_LABEL[topic] || topic}).`
}

module.exports = {
  TOPICS,
  TOPIC_RANK,
  TOPIC_LABEL,
  CATEGORY_TOPIC,
  PATTERN,
  MAX_LEN,
  truncate,
  sanitize,
  classify,
  routeFor,
  ownerJids,
  dmable,
  groupAdmins,
  deliver,
  summary,
}
