module.exports = {
  name: 'owner',
  aliases: ['creator', 'admin'],
  category: 'utility',
  desc: 'Menampilkan kontak owner/admin.',
  run: async (m) => {
    const { config, db } = m
    const owners = [...new Set([...config.envOwners, ...(db.data.owners || [])])]
    const list = owners.map((o) => `wa.me/${o.split('@')[0]}`).join('\n') || '-'
    const text =
      `👑 *OWNER & ADMIN*\n\n` +
      `${list}\n\n` +
      `🌐 Website : ${config.website || '-'}\n` +
      `🟦 Panel   : ${config.panelUrl || '-'}\n` +
      `👥 Grup    : ${config.communityGroup || '-'}`
    await m.reply(text)
  },
}
