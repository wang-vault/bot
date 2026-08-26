module.exports = {
  name: 'hidetag',
  aliases: ['h', 'hide'],
  category: 'admin',
  isGroup: true,
  isAdmin: true,
  desc: 'Kirim pesan dengan tag tersembunyi ke semua member.',
  use: '<pesan>',
  run: async (m) => {
    const meta = await m.getMeta()
    if (!meta) return m.reply('❌ Gagal ambil metadata grup.')
    const mentions = meta.participants.map((p) => p.id)
    const text = m.args || '(tidak ada pesan)'
    await m.sock.sendMessage(m.chat, { text, mentions })
  },
}
