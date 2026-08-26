module.exports = {
  name: 'demote',
  aliases: ['hapusadmin', 'unadmin'],
  category: 'admin',
  isGroup: true,
  isAdmin: true,
  isBotAdmin: true,
  desc: 'Cabut status admin grup.',
  run: async (m) => {
    const targets = []
    if (m.quoted) targets.push(m.quoted.sender)
    for (const t of m.mentionedJid) if (!targets.includes(t)) targets.push(t)
    if (!targets.length) return m.reply('Reply / tag admin.')
    const safe = targets.filter((t) => !m.func.isOwner(t, m.db))
    if (!safe.length) return m.reply('⚠️ Tidak bisa demote owner.')
    try {
      await m.sock.groupParticipantsUpdate(m.chat, safe, 'demote')
      await m.reply('✅ Berhasil demote ' + safe.length + ' admin.')
    } catch (e) {
      await m.reply('❌ Gagal: ' + e.message)
    }
  },
}
