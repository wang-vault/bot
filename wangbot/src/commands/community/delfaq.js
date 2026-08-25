module.exports = {
  name: 'delfaq',
  category: 'community',
  isOwner: true,
  desc: 'Menghapus FAQ berdasarkan nomor (Owner).',
  use: '<nomor>',
  run: async (m) => {
    const i = parseInt(m.args, 10) - 1
    if (isNaN(i) || i < 0 || i >= m.db.data.faq.length) {
      return m.reply('Contoh: ' + m.config.prefix + 'delfaq 1')
    }
    m.db.data.faq.splice(i, 1)
    m.db.save()
    await m.reply('✅ FAQ dihapus.')
  },
}
