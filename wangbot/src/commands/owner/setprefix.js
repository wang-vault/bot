module.exports = {
  name: 'setprefix',
  aliases: ['gantiprefix'],
  category: 'owner',
  isOwner: true,
  desc: 'Mengubah prefix command (Owner only).',
  use: '<simbol baru>',
  run: async (m) => {
    if (!m.args) return m.reply('Contoh: ' + m.config.prefix + 'setprefix !')
    // prefix disimpan di env? kita override lewat config runtime + db
    if (!m.db.data.runtime) m.db.data.runtime = {}
    m.db.data.runtime.prefix = m.args.trim().split(' ')[0]
    m.config.prefix = m.db.data.runtime.prefix
    m.db.save()
    await m.reply('✅ Prefix diubah menjadi: *' + m.config.prefix + '*')
  },
}
