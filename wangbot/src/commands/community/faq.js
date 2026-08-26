module.exports = {
  name: 'faq',
  aliases: ['faqlist'],
  category: 'community',
  desc: 'Menampilkan daftar FAQ.',
  run: async (m) => {
    const list = m.db.data.faq
    if (!list.length) return m.reply('Belum ada FAQ.')
    let t = '❓ *DAFTAR FAQ WANGSTORE*\n\n'
    list.forEach((f, i) => {
      t += `${i + 1}. *${f.q}*\n➜ ${f.a}\n\n`
    })
    t += `Ketik pertanyaan kamu langsung di grup (jika auto-FAQ aktif).`
    await m.reply(t.trim())
  },
}
