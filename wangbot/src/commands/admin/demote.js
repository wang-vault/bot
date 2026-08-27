module.exports = {
  name: 'demote',
  aliases: ['hapusadmin', 'unadmin'],
  category: 'admin',
  isGroup: true,
  isAdmin: true,
  isBotAdmin: true,
  desc: 'Cabut status admin grup (nomor / reply / tag).',
  use: '[nomor ...]   contoh: 081234567890',
  run: async (m) => {
    const targets = m.func.targets(m)
    if (!targets.length) return m.reply('Contoh: ' + m.config.prefix + 'demote 081234567890\nAtau reply / tag admin.')
    const safe = targets.filter((t) => !m.func.isOwner(t, m.db))
    if (!safe.length) return m.reply('⚠️ Tidak bisa demote owner.')
    try {
      await m.sock.groupParticipantsUpdate(m.chat, safe, 'demote')
      await m.reply('✅ Berhasil demote ' + safe.map((t) => m.func.num(t)).join(', ') + '.')
    } catch (e) {
      await m.reply('❌ Gagal: ' + e.message)
    }
  },
}
