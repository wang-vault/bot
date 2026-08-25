const Layanan = require('../../lib/layanan')
module.exports = {
  name: 'website',
  aliases: ['web', 'situs'],
  category: 'info',
  desc: 'Link website resmi.',
  run: async (m) => m.reply(Layanan.get(m.db, 'website')),
}
