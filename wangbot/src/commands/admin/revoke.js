module.exports = {
  name: 'revoke',
  aliases: ['revokelink', 'resetlink'],
  category: 'admin',
  isGroup: true,
  isAdmin: true,
  isBotAdmin: true,
  desc: 'Reset / revoke link invite grup.',
  run: async (m) => {
    try {
      await m.sock.groupRevokeInvite(m.chat)
      await m.reply('✅ Link invite grup sudah di-reset.')
    } catch (e) {
      await m.reply('❌ Gagal: ' + e.message)
    }
  },
}
