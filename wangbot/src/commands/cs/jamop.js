module.exports = {
  name: 'jamop',
  aliases: ['jam', 'jamoperasional', 'operasional'],
  category: 'cs',
  desc: 'Jam operasional & status buka/tutup.',
  run: async (m) => {
    const hours = m.config.operationalHours || '08:00-22:00'
    const [start, end] = hours.split('-')
    const now = new Date()
    const cur = now.getHours() * 60 + now.getMinutes()
    const parse = (s) => {
      const [h, mm] = (s || '').split(':').map(Number)
      return (h || 0) * 60 + (mm || 0)
    }
    const s = parse(start)
    const e = parse(end)
    // rentang yang lewat tengah malam (mis. 22:00-06:00) tetap terbaca buka
    const open = e >= s ? cur >= s && cur <= e : cur >= s || cur <= e
    const text =
      `🕒 *JAM OPERASIONAL*\n\n` +
      `Setiap hari: ${hours} WIB\n` +
      `Status: ${open ? '🟢 *BUKA* (admin online)' : '🔴 *TUTUP* (di luar jam)'}\n\n` +
      `Saat tutup, pesan tetap diterima & akan dibalas saat jam operasional.`
    await m.reply(text)
  },
}
