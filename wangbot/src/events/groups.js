const config = require('../config')
const func = require('../lib/func')
const logger = require('../lib/logger')

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
    try {
      const meta = await sock.groupMetadata(id)
      subject = meta.subject || 'Grup'
    } catch (_) {}

    const cleanParticipants = (participants || []).filter(Boolean)

    if (action === 'add') {
      logger.join(`JOIN ${subject} +${cleanParticipants.length}`)
      for (const jid of cleanParticipants) {
        db.registerUser(jid, '')
        const vars = { user: jid.split('@')[0], subject }

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
        for (const jid of cleanParticipants) {
          const vars = { user: jid.split('@')[0], subject }
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
