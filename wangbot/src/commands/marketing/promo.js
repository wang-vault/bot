const Marketing = require('../../lib/marketing')

module.exports = {
  name: 'promo',
  aliases: ['sendpromo', 'promosekarang'],
  category: 'marketing',
  isOwner: true,
  desc: 'Kirim promosi manual ke seluruh grup promosi (Owner).',
  run: async (m) => {
    await m.reply('📢 Mengirim promosi manual...')
    const res = await Marketing.send(m.sock, m.db, true)
    if (res.ok) await m.reply(`✅ Promosi terkirim ke ${res.sent}/${res.total} grup.`)
    else await m.reply('❌ ' + (res.reason || 'gagal'))
  },
}
