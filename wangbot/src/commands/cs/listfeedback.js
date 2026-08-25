module.exports = {
  name: 'listfeedback',
  aliases: ['feedbacklist', 'saranlist'],
  category: 'cs',
  isOwner: true,
  desc: 'Lihat daftar feedback (Owner).',
  run: async (m) => {
    const list = m.db.data.feedback
    if (!list.length) return m.reply('ℹ️ Belum ada feedback.')
    let t = '💬 *DAFTAR FEEDBACK*\n\n'
    const last = list.slice(-20)
    const offset = list.length - last.length
    last.forEach((f, i) => {
      t += `${offset + i + 1}. @${f.from.split('@')[0]}\n   ${f.text.slice(0, 100)}\n   ${new Date(f.time).toLocaleString('id-ID')}\n\n`
    })
    await m.reply(t.trim(), { mentions: list.slice(-20).map((f) => f.from) })
  },
}
