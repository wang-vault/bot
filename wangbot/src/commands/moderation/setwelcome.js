module.exports = {
  name: 'setwelcome',
  aliases: ['aturwelcome'],
  category: 'moderation',
  isGroup: true,
  isAdmin: true,
  desc: 'Atur teks welcome. Variabel: @user @subject {website}.',
  use: '<teks>',
  run: async (m) => {
    if (!m.args) {
      return m.reply('Contoh: ' + m.config.prefix + 'setwelcome Selamat datang @user di @subject!')
    }
    const g = m.db.getGroup(m.chat)
    g.welcomeText = m.args
    m.db.save()
    await m.reply('✅ Teks welcome diperbarui.')
  },
}
