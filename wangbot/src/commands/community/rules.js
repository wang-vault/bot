module.exports = {
  name: 'rules',
  aliases: ['peraturan', 'rule'],
  category: 'community',
  isGroup: true,
  desc: 'Menampilkan peraturan grup.',
  run: async (m) => {
    const g = m.db.getGroup(m.chat)
    await m.reply(g.rulesText)
  },
}
