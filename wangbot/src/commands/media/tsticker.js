const { textToImage, makeSticker } = require('../../lib/sticker')

module.exports = {
  name: 'tsticker',
  aliases: ['ttg', 'quotely', 'qc', 'textsticker'],
  category: 'media',
  desc: 'Sticker dari teks.',
  use: '<teks>',
  run: async (m) => {
    const text = m.quoted ? (m.args || m.quoted.body || '') : m.args
    if (!text) return m.reply('Contoh: ' + m.config.prefix + 'tsticker Halo WangStore')
    try {
      const img = await textToImage(text)
      const sticker = await makeSticker(img, { pack: 'WangBot', author: m.pushName || 'Text' })
      await m.sock.sendMessage(m.chat, { sticker }, { quoted: m.quotedRef })
    } catch (e) {
      await m.reply('❌ ' + e.message + '\nℹ️ Pastikan *sharp* terinstall: npm i sharp')
    }
  },
}
