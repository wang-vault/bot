module.exports = {
  name: 'kick',
  aliases: ['remove', 'keluarkan'],
  category: 'admin',
  isGroup: true,
  isAdmin: true,
  isBotAdmin: true,
  desc: 'Keluarkan member dari grup (Admin). Nomor / reply / tag.',
  use: '[nomor ...]   contoh: 081234567890 081311112222',
  run: async (m) => {
    const targets = m.func.targets(m)
    if (!targets.length) return m.reply('Contoh: ' + m.config.prefix + 'kick 081234567890\nAtau reply / tag member yang ingin dikeluarkan.')
    const admins = (await m.getMeta())?.participants.filter((p) => p.admin).map((p) => p.id) || []
    const safe = targets.filter((t) => !m.func.isOwner(t, m.db) && !admins.includes(t))
    if (!safe.length) return m.reply('⚠️ Tidak ada yang bisa dikeluarkan (semua admin/owner).')
    try {
      await m.sock.groupParticipantsUpdate(m.chat, safe, 'remove')
      await m.reply('✅ Berhasil mengeluarkan ' + safe.map((t) => m.func.num(t)).join(', ') + '.')
    } catch (e) {
      await m.reply('❌ Gagal: ' + e.message)
    }
  },
}
