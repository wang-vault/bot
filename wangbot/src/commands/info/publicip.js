const Layanan = require('../../lib/layanan')
module.exports = {
  name: 'publicip',
  aliases: ['ip', 'ipv4'],
  category: 'info',
  desc: 'Informasi Public IP / IPv4 Addon.',
  run: async (m) => m.reply(Layanan.get(m.db, 'publicip')),
}
