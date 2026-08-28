const Assistant = require('../../lib/assistant')

module.exports = {
  name: 'approve',
  aliases: ['setujui', 'izinkan'],
  category: 'assistant',
  isOwner: true,
  isPrivate: true,
  desc: 'Setujui tindakan sensitif yang diusulkan Personal Agent.',
  use: '<ID>',
  run: async (m) => {
    if (!m.args) return m.reply(Assistant.formatPending(m.db, m.config.prefix))
    return Assistant.approve(m, m.args.split(/\s+/)[0])
  },
}
