module.exports = {
  name: 'listlaporan',
  aliases: ['laporanlist', 'reportlist'],
  category: 'cs',
  isOwner: true,
  desc: 'Lihat daftar laporan (Owner).',
  run: async (m) => {
    const list = m.db.data.reports
    if (!list.length) return m.reply('ℹ️ Belum ada laporan.')
    let t = '🚨 *DAFTAR LAPORAN*\n\n'
    const last = list.slice(-20)
    const offset = list.length - last.length
    last.forEach((f, i) => {
      t += `${offset + i + 1}. @${f.from.split('@')[0]}\n   ${f.text.slice(0, 100)}\n   ${new Date(f.time).toLocaleString('id-ID')}\n\n`
    })
    await m.reply(t.trim(), { mentions: list.slice(-20).map((f) => f.from) })
  },
}
