module.exports = {
  name: 'add',
  aliases: ['tambah', 'invite'],
  category: 'admin',
  isGroup: true,
  isAdmin: true,
  isBotAdmin: true,
  desc: 'Tambah member ke grup pakai nomor (Admin).',
  use: '<nomor>   contoh: 081234567890 | +62 812-3456-7890',
  run: async (m) => {
    const jid = m.func.target(m)
    if (!jid) {
      return m.reply('Contoh: ' + m.config.prefix + 'add 081234567890\nAtau: ' + m.config.prefix + 'add +62 812-3456-7890')
    }
    try {
      const res = await m.sock.groupParticipantsUpdate(m.chat, [jid], 'add')
      const status = res && res[0] && res[0].status
      if (status === '403' || status === '408') {
        let code = ''
        try {
          code = await m.sock.groupInviteCode(m.chat)
        } catch (_) {}
        return m.reply('⚠️ Tidak bisa menambah langsung (privasi nomor). Kirim link invite:\nhttps://chat.whatsapp.com/' + code)
      }
      await m.reply('✅ Berhasil menambah ' + m.func.num(jid))
    } catch (e) {
      await m.reply('❌ Gagal: ' + e.message)
    }
  },
}
