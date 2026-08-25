module.exports = {
  name: 'setrules',
  aliases: ['aturperaturan'],
  category: 'community',
  isGroup: true,
  isAdmin: true,
  desc: 'Mengatur teks peraturan grup (Admin).',
  use: '<teks peraturan>',
  run: async (m) => {
    if (!m.args) return m.reply('Contoh: ' + m.config.prefix + 'setrules 1. Dilarang spam\n2. Sopan')
    const g = m.db.getGroup(m.chat)
    g.rulesText = m.args
    m.db.save()
    await m.reply('✅ Peraturan grup diperbarui.')
  },
}
