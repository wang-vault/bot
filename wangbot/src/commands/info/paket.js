const Layanan = require('../../lib/layanan')
module.exports = {
  name: 'paket',
  aliases: ['hosting', 'layanan'],
  category: 'info',
  desc: 'Daftar paket hosting.',
  run: async (m) => m.reply(Layanan.get(m.db, 'paket')),
}
