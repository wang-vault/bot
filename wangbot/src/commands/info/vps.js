const Layanan = require('../../lib/layanan')
module.exports = {
  name: 'vps',
  category: 'info',
  desc: 'Informasi VPS.',
  run: async (m) => m.reply(Layanan.get(m.db, 'vps')),
}
