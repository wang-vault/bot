module.exports = {
  name: 'join',
  aliases: ['joingc'],
  category: 'owner',
  isOwner: true,
  desc: 'Bot bergabung ke grup via link invite.',
  use: '<link grup>',
  run: async (m) => {
    if (!m.args) return m.reply('Contoh: ' + m.config.prefix + 'join https://chat.whatsapp.com/xxxx')
    const match = m.args.match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/)
    if (!match) return m.reply('❌ Link grup tidak valid.')
    const code = match[1]
    try {
      const res = await m.sock.groupAcceptInvite(code)
      await m.reply('✅ Berhasil join grup: ' + res)
    } catch (e) {
      await m.reply('❌ Gagal join: ' + e.message)
    }
  },
}
