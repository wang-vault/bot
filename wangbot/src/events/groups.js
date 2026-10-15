const config = require('../config')
const func = require('../lib/func')
const Identity = require('../lib/identity')
const logger = require('../lib/logger')

// handler menyimpan cache metadata grup (TTL 60 detik); dibatalkan di sini
// supaya perubahan anggota/admin langsung terbaca. require() ditaruh di dalam
// fungsi agar tidak ada dependensi melingkar saat module dimuat.
function invalidateMeta(jid) {
  try {
    require('../handler').invalidateMeta(jid)
  } catch (_) {}
}

function fillTemplate(text, vars) {
  return (text || '')
    .replace(/@user/g, `@${vars.user}`)
    .replace(/@subject/g, vars.subject)
    .replace(/{website}/g, config.website || '-')
    .replace(/{panel}/g, config.panelUrl || '-')
    .replace(/{group}/g, config.communityGroup || '-')
    .replace(/{admin}/g, config.waAdmin || '-')
    .replace(/{bot}/g, config.botName)
}

async function handleParticipantsUpdate(sock, db, { id, participants, action }) {
  try {
    if (!id || !id.endsWith('@g.us')) return
    const g = db.getGroup(id)
    let subject = 'Grup'
    // Metadata dipakai sekaligus untuk memetakan peserta ber-`@lid` ke NOMOR
    // (nama di welcome/goodbye & data pengguna selalu nomor — src/lib/identity.js).
    let meta = null
    try {
      meta = await sock.groupMetadata(id)
      subject = meta.subject || 'Grup'
    } catch (_) {}

    const metaParticipants = meta && Array.isArray(meta.participants) ? meta.participants : []
    // `mentions` tetap memakai JID asli dari WhatsApp (di grup ber-LID, tag
    // memang harus LID), tapi data yang disimpan & ditampilkan memakai nomor.
    const entries = (participants || [])
      .filter(Boolean)
      .map((jid) => ({ jid, pn: Identity.resolve(jid, { db, participants: metaParticipants }) }))
    const cleanParticipants = entries
    const anyLid = entries.some((e) => Identity.isLid(e.pn))
    invalidateMeta(id) // anggota/admin berubah -> cache lama tidak valid
    if (anyLid) {
      logger.info(`Identitas: ${entries.filter((e) => Identity.isLid(e.pn)).length} peserta masih @lid (nomor belum diketahui) di ${subject}`)
    }

    if (action === 'add') {
      logger.join(`JOIN ${subject} +${cleanParticipants.length}`)
      for (const { jid, pn } of cleanParticipants) {
        db.registerUser(pn, '') // identitas disimpan sebagai NOMOR
        const vars = { user: Identity.num(pn), subject }

        if (g.welcome) {
          const text = fillTemplate(g.welcomeText, vars)
          await sock.sendMessage(id, { text, mentions: [jid] }).catch(() => {})
        }
        if (g.autorules) {
          await sock.sendMessage(id, { text: g.rulesText }).catch(() => {})
        }
        if (g.autowebsite && config.website) {
          await sock
            .sendMessage(id, {
              text: `🌐 *Website Resmi ${config.botName}*\n${config.website}\n\nYuk kunjungi untuk lihat layanan terlengkap!`,
            })
            .catch(() => {})
        }
        if (g.autogrouplink && config.communityGroup) {
          await sock
            .sendMessage(id, {
              text: `👥 *Gabung Grup Komunitas ${config.botName}:*\n${config.communityGroup}`,
            })
            .catch(() => {})
        }
        // anti-flood: jeda antar pesan agar tidak kena rate-limit
        await new Promise((r) => setTimeout(r, 600))
      }
    } else if (action === 'remove' || action === 'leave') {
      logger.join(`LEAVE ${subject} -${cleanParticipants.length}`)
      if (g.goodbye) {
        for (const { jid, pn } of cleanParticipants) {
          const vars = { user: Identity.num(pn), subject }
          const text = fillTemplate(g.goodbyeText, vars)
          await sock.sendMessage(id, { text, mentions: [jid] }).catch(() => {})
          await new Promise((r) => setTimeout(r, 400))
        }
      }
    } else if (action === 'promote' || action === 'demote') {
      // opsional: bisa ditambah notifikasi
    }
  } catch (e) {
    logger.error('participants update', e)
  }
}

module.exports = { handleParticipantsUpdate }
