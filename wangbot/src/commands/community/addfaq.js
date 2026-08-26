module.exports = {
  name: 'addfaq',
  aliases: ['setfaq'],
  category: 'community',
  isOwner: true,
  desc: 'Menambah FAQ (Owner). Format: pertanyaan | jawaban.',
  use: '<q> | <a>',
  run: async (m) => {
    if (!m.args || !m.args.includes('|')) {
      return m.reply('Contoh: ' + m.config.prefix + 'addfaq cara order | ketik .paket')
    }
    const [q, a] = m.args.split('|').map((s) => s.trim())
    if (!q || !a) return m.reply('Pertanyaan dan jawaban wajib diisi.')
    m.db.data.faq.push({ q, a })
    m.db.save()
    await m.reply('✅ FAQ ditambahkan.')
  },
}
