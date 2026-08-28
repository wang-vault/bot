const Assistant = require('../../lib/assistant')

module.exports = {
  name: 'reject',
  aliases: ['tolak', 'batalkanaksi'],
  category: 'assistant',
  isOwner: true,
  isPrivate: true,
  desc: 'Tolak tindakan Personal Agent yang sedang menunggu persetujuan.',
  use: '<ID>',
  run: async (m) => {
    if (!m.args) return m.reply(Assistant.formatPending(m.db, m.config.prefix))
    return Assistant.reject(m, m.args.split(/\s+/)[0])
  },
}
