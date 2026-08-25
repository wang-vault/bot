module.exports = {
  name: 'promostats',
  aliases: ['statpromo', 'promostat'],
  category: 'marketing',
  isOwner: true,
  desc: 'Statistik promosi.',
  run: async (m) => {
    const s = m.db.data.marketing.stats
    const t =
      '📈 *STATISTIK PROMOSI*\n\n' +
      `Total terkirim : ${s.sent}\n` +
      `Promo manual   : ${s.manual}\n` +
      `Promo otomatis : ${s.auto}\n` +
      `Template       : ${m.db.data.marketing.templates.length}\n` +
      `Grup tujuan    : ${m.db.data.marketing.groups.length}\n` +
      `Terakhir       : ${m.db.data.marketing.lastSent ? new Date(m.db.data.marketing.lastSent).toLocaleString('id-ID') : '-'}`
    await m.reply(t)
  },
}
