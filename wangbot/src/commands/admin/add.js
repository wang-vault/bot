const { toJid } = require('../../config')

module.exports = {
  name: 'add',
  aliases: ['tambah', 'invite'],
  category: 'admin',
  isGroup: true,
  isAdmin: true,
  isBotAdmin: true,
  desc: 'Tambah member ke grup (Admin).',
  use: '<nomor>',
  run: async (m) => {
    let input = m.args
    if (!input && m.quoted) input = m.quoted.sender
    const jid = input && input.endsWith('@s.whatsapp.net') ? input : toJid(input)
    if (!jid) return m.reply('Contoh: ' + m.config.prefix + 'add 6281234567890')
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
      await m.reply('✅ Berhasil menambah ' + jid.split('@')[0])
    } catch (e) {
      await m.reply('❌ Gagal: ' + e.message)
    }
  },
}
