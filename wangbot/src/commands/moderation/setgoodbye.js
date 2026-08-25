module.exports = {
  name: 'setgoodbye',
  aliases: ['aturgoodbye'],
  category: 'moderation',
  isGroup: true,
  isAdmin: true,
  desc: 'Atur teks goodbye. Variabel: @user @subject.',
  use: '<teks>',
  run: async (m) => {
    if (!m.args) {
      return m.reply('Contoh: ' + m.config.prefix + 'setgoodbye @user keluar dari @subject.')
    }
    const g = m.db.getGroup(m.chat)
    g.goodbyeText = m.args
    m.db.save()
    await m.reply('✅ Teks goodbye diperbarui.')
  },
}
