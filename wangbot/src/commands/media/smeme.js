const { memeImage, makeSticker } = require('../../lib/sticker')

module.exports = {
  name: 'smeme',
  aliases: ['stickermeme', 'memesticker'],
  category: 'media',
  desc: 'Sticker dari gambar + teks (meme). Reply gambar.',
  use: '<atas|bawah>',
  run: async (m) => {
    if (!m.quoted) return m.reply('⚠️ Reply gambar dulu.')
    if (m.quoted.media && m.quoted.media.type === 'video') {
      return m.reply('⚠️ Sticker dari *video* tidak didukung. Reply *gambar* saja ya.')
    }
    const buf = await m.quoted.download()
    if (!buf) return m.reply('❌ Gagal mengunduh gambar.')
    let [top, bottom] = (m.args || '').split('|').map((s) => s.trim())
    if (!top && !bottom) {
      top = m.args || ''
      bottom = ''
    }
    try {
      const img = await memeImage(buf, top, bottom)
      const sticker = await makeSticker(img, { pack: 'WangBot', author: 'Meme' })
      await m.sock.sendMessage(m.chat, { sticker }, { quoted: m.quotedRef })
    } catch (e) {
      await m.reply('❌ ' + e.message + '\nℹ️ Pastikan *sharp* terinstall: npm i sharp')
    }
  },
}
