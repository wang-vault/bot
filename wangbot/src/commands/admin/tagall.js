module.exports = {
  name: 'tagall',
  aliases: ['everyone', 'mentionall'],
  category: 'admin',
  isGroup: true,
  isAdmin: true,
  desc: 'Tag semua member grup.',
  use: '[pesan]',
  run: async (m) => {
    const meta = await m.getMeta()
    if (!meta) return m.reply('❌ Gagal ambil metadata grup.')
    const mentions = meta.participants.map((p) => p.id)
    let text = m.args ? m.args + '\n\n' : ''
    text += '━━━ *TAG ALL* ━━━\n'
    text += meta.participants.map((p) => ' @' + p.id.split('@')[0]).join('\n')
    await m.sock.sendMessage(m.chat, { text: text.trim(), mentions })
  },
}
