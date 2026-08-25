const Layanan = require('../../lib/layanan')
module.exports = {
  name: 'linkgc',
  aliases: ['grup', 'group', 'komunitas'],
  category: 'info',
  desc: 'Link grup komunitas.',
  run: async (m) => m.reply(Layanan.get(m.db, 'group')),
}
