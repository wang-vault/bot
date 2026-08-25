const { makeSticker } = require('../../lib/sticker')

module.exports = {
  name: 'wm',
  aliases: ['watermark', 'swm'],
  category: 'media',
  desc: 'Sticker dengan watermark (pack|author). Reply gambar.',
  use: '<pack|author>',
  run: async (m) => {
    if (!m.quoted) return m.reply('⚠️ Reply gambar dulu.')
    if (m.quoted.media && m.quoted.media.type === 'video') {
      return m.reply('⚠️ Sticker dari *video* tidak didukung. Reply *gambar* saja ya.')
    }
    const buf = await m.quoted.download()
    if (!buf) return m.reply('❌ Gagal mengunduh gambar.')
    let [pack, author] = (m.args || '').split('|').map((s) => s.trim())
    if (!pack && !author) {
      pack = 'WangBot'
      author = m.config.botName
    }
    try {
      const sticker = await makeSticker(buf, { pack, author })
      await m.sock.sendMessage(m.chat, { sticker }, { quoted: m.quotedRef })
    } catch (e) {
      await m.reply('❌ Gagal membuat sticker: ' + e.message)
    }
  },
}
