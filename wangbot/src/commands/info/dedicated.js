const Layanan = require('../../lib/layanan')
module.exports = {
  name: 'dedicated',
  aliases: ['dedicatedserver', 'ds'],
  category: 'info',
  desc: 'Informasi Dedicated Server.',
  run: async (m) => m.reply(Layanan.get(m.db, 'dedicated')),
}
