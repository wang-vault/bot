module.exports = {
  name: 'link',
  aliases: ['linkgrup', 'invitelink', 'linkinvite'], // 'linkgc' dilepas: dipakai info/linkgc (link grup komunitas)
  category: 'admin',
  isGroup: true,
  isAdmin: true,
  desc: 'Ambil link invite grup.',
  run: async (m) => {
    try {
      const code = await m.sock.groupInviteCode(m.chat)
      await m.reply('🔗 *LINK GRUP*\nhttps://chat.whatsapp.com/' + code)
    } catch (e) {
      await m.reply('❌ Gagal: ' + e.message)
    }
  },
}
