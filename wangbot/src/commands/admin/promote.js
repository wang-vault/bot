module.exports = {
  name: 'promote',
  aliases: ['jadadmin', 'prom', 'naikinadmin'], // 'admin' dilepas: bentrok dgn .owner (kontak admin)
  category: 'admin',
  isGroup: true,
  isAdmin: true,
  isBotAdmin: true,
  desc: 'Jadikan member sebagai admin grup.',
  run: async (m) => {
    const targets = []
    if (m.quoted) targets.push(m.quoted.sender)
    for (const t of m.mentionedJid) if (!targets.includes(t)) targets.push(t)
    if (!targets.length) return m.reply('Reply / tag member.')
    try {
      await m.sock.groupParticipantsUpdate(m.chat, targets, 'promote')
      await m.reply('✅ Berhasil promote ' + targets.length + ' member.')
    } catch (e) {
      await m.reply('❌ Gagal: ' + e.message)
    }
  },
}
