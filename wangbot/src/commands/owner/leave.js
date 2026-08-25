module.exports = {
  name: 'leave',
  aliases: ['out', 'keluar'],
  category: 'owner',
  isOwner: true,
  isGroup: true,
  desc: 'Bot keluar dari grup.',
  run: async (m) => {
    await m.reply('👋 Bot akan keluar dari grup ini. Sampai jumpa!')
    setTimeout(async () => {
      try {
        await m.sock.groupLeave(m.chat)
      } catch (e) {
        await m.reply('❌ Gagal keluar: ' + e.message)
      }
    }, 1500)
  },
}
