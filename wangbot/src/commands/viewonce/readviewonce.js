module.exports = {
  name: 'readviewonce',
  aliases: ['rvo', 'tovv', 'readvv', 'bukavv', 'bukalihat'],
  category: 'viewonce',
  desc: 'Buka media sekali lihat (view once). Reply pesannya.',
  run: async (m) => {
    if (!m.quoted || !m.quoted.media) {
      return m.reply('⚠️ Reply pesan *view once* (sekali lihat).')
    }
    const media = m.quoted.media
    try {
      const buf = await m.quoted.download()
      if (!buf || !buf.length) return m.reply('❌ Gagal mengunduh media (mungkin sudah kedaluwarsa).')
      let content
      const tag = media.isViewOnce ? '🔓 View-once dibuka' : '🖼️ Media'
      if (media.type === 'image') content = { image: buf, caption: tag }
      else if (media.type === 'video') content = { video: buf, caption: tag }
      else if (media.type === 'audio') content = { audio: buf, mimetype: 'audio/mpeg', ptt: true }
      else return m.reply('❌ Tipe media tidak didukung.')
      await m.sock.sendMessage(m.chat, content, { quoted: m.quotedRef })
    } catch (e) {
      await m.reply('❌ Gagal: ' + e.message)
    }
  },
}
