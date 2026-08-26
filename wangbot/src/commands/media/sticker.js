const { makeSticker } = require('../../lib/sticker')

module.exports = {
  name: 'sticker',
  aliases: ['s', 'stiker'],
  category: 'media',
  desc: 'Buat sticker dari gambar. Reply/kirim gambar + caption.',
  use: '[pack|author]',
  run: async (m) => {
    const media = m.media || (m.quoted && m.quoted.media)
    if (media && media.type === 'video') {
      return m.reply('⚠️ Sticker dari *video* tidak didukung. Kirim/*reply gambar* saja ya.')
    }
    const buf = await m.download()
    if (!buf) return m.reply('⚠️ Kirim/reply *gambar* dengan caption .sticker')
    const [pack, author] = (m.args || '').split('|').map((s) => s.trim())
    try {
      const sticker = await makeSticker(buf, { pack, author })
      await m.sock.sendMessage(m.chat, { sticker }, { quoted: m.quotedRef })
    } catch (e) {
      await m.reply('❌ Gagal membuat sticker: ' + e.message)
    }
  },
}
