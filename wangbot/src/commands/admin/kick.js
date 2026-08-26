module.exports = {
  name: 'kick',
  aliases: ['remove', 'keluarkan'],
  category: 'admin',
  isGroup: true,
  isAdmin: true,
  isBotAdmin: true,
  desc: 'Keluarkan member dari grup (Admin). Reply / tag.',
  run: async (m) => {
    const targets = []
    if (m.quoted) targets.push(m.quoted.sender)
    for (const t of m.mentionedJid) if (!targets.includes(t)) targets.push(t)
    if (!targets.length) return m.reply('Reply / tag member yang ingin dikeluarkan.')
    const admins = (await m.getMeta())?.participants.filter((p) => p.admin).map((p) => p.id) || []
    const safe = targets.filter((t) => !m.func.isOwner(t, m.db) && !admins.includes(t))
    if (!safe.length) return m.reply('⚠️ Tidak ada yang bisa dikeluarkan (semua admin/owner).')
    try {
      await m.sock.groupParticipantsUpdate(m.chat, safe, 'remove')
      await m.reply('✅ Berhasil mengeluarkan ' + safe.length + ' member.')
    } catch (e) {
      await m.reply('❌ Gagal: ' + e.message)
    }
  },
}
