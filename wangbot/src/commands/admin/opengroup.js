module.exports = {
  name: 'opengroup',
  aliases: ['open', 'bukagc'],
  category: 'admin',
  isGroup: true,
  isAdmin: true,
  isBotAdmin: true,
  desc: 'Buka grup (semua member bisa chat).',
  run: async (m) => {
    try {
      await m.sock.groupSettingUpdate(m.chat, 'not_announcement')
      await m.reply('✅ Grup dibuka.')
    } catch (e) {
      await m.reply('❌ Gagal: ' + e.message)
    }
  },
}
