const { resetWarning } = require('../../lib/moderation')

module.exports = {
  name: 'delwarn',
  aliases: ['resetwarn', 'unwarn'],
  category: 'moderation',
  isGroup: true,
  isAdmin: true,
  desc: 'Reset peringatan member (Admin). Nomor / reply / tag.',
  use: '[nomor]   contoh: 081234567890',
  run: async (m) => {
    const target = m.func.target(m, m.args, { firstOnly: true })
    if (!target) return m.reply('Contoh: ' + m.config.prefix + 'delwarn 081234567890\nAtau reply / tag member yang ingin di-reset.')
    const ok = resetWarning(m.db, m.chat, target)
    if (ok) await m.reply('✅ Peringatan direset untuk @' + m.func.num(target), { mentions: [target] })
    else await m.reply('ℹ️ Member tersebut tidak punya peringatan.')
  },
}
