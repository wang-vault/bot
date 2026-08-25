module.exports = {
  name: 'kontak',
  aliases: ['contact', 'csadmin'],
  category: 'info',
  desc: 'Kontak admin & platform.',
  run: async (m) => {
    const c = m.config
    const text =
      '📞 *KONTAK ADMIN WANGSTORE*\n\n' +
      `📱 WhatsApp : wa.me/${(c.waAdmin || '').split('@')[0]}\n` +
      `🌐 Website  : ${c.website || '-'}\n` +
      `🟦 Panel    : ${c.panelUrl || '-'}\n` +
      `👥 Grup     : ${c.communityGroup || '-'}\n` +
      (c.telegramAdmin ? `✈️ Telegram : ${c.telegramAdmin}\n` : '') +
      (c.instagramAdmin ? `📷 Instagram : ${c.instagramAdmin}\n` : '') +
      `\n🕒 Jam Operasional: ${c.operationalHours}`
    await m.reply(text)
  },
}
