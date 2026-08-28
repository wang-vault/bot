const Assistant = require('../../lib/assistant')

module.exports = {
  name: 'asisten',
  aliases: ['assistant', 'agent', 'bantuaku'],
  category: 'assistant',
  isOwner: true,
  isPrivate: true,
  cooldown: 2,
  desc: 'Asisten pribadi: bicara, merencanakan, dan menjalankan command yang diizinkan.',
  use: '<instruksi bahasa natural>',
  run: async (m) => Assistant.respond(m, m.args || (m.quoted && m.quoted.body) || ''),
}
