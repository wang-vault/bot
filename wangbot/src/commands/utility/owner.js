module.exports = {
  name: 'owner',
  aliases: ['creator', 'admin'],
  category: 'utility',
  desc: 'Menampilkan kontak owner/admin.',
  run: async (m) => {
    const { config } = m
    // Selalu tampilkan NOMOR WhatsApp (bukan LID / JID). Lihat src/lib/identity.js
    const owners = m.func.ownerJids(m.db)
    const list = owners.map((o) => `wa.me/${m.func.num(o)}`).join('\n') || '-'
    const text =
      `👑 *OWNER & ADMIN*\n\n` +
      `${list}\n\n` +
      `🌐 Website : ${config.website || '-'}\n` +
      `🟦 Panel   : ${config.panelUrl || '-'}\n` +
      `👥 Grup    : ${config.communityGroup || '-'}`
    await m.reply(text)
  },
}
