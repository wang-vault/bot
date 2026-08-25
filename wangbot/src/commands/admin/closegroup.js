module.exports = {
  name: 'closegroup',
  aliases: ['close', 'tutupgc'],
  category: 'admin',
  isGroup: true,
  isAdmin: true,
  isBotAdmin: true,
  desc: 'Tutup grup (hanya admin bisa chat).',
  run: async (m) => {
    try {
      await m.sock.groupSettingUpdate(m.chat, 'announcement')
      await m.reply('✅ Grup ditutup.')
    } catch (e) {
      await m.reply('❌ Gagal: ' + e.message)
    }
  },
}
