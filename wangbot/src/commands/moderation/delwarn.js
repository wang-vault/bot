const { resetWarning } = require('../../lib/moderation')

module.exports = {
  name: 'delwarn',
  aliases: ['resetwarn', 'unwarn'],
  category: 'moderation',
  isGroup: true,
  isAdmin: true,
  desc: 'Reset peringatan member (Admin). Reply / tag.',
  run: async (m) => {
    const target = m.quoted ? m.quoted.sender : m.mentionedJid[0]
    if (!target) return m.reply('Reply / tag member yang ingin di-reset.')
    const ok = resetWarning(m.db, m.chat, target)
    if (ok) await m.reply('✅ Peringatan direset untuk @' + target.split('@')[0], { mentions: [target] })
    else await m.reply('ℹ️ Member tersebut tidak punya peringatan.')
  },
}
