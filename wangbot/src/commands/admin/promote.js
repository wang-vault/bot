module.exports = {
  name: 'promote',
  aliases: ['jadadmin', 'prom', 'naikinadmin'], // 'admin' dilepas: bentrok dgn .owner (kontak admin)
  category: 'admin',
  isGroup: true,
  isAdmin: true,
  isBotAdmin: true,
  desc: 'Jadikan member sebagai admin grup (nomor / reply / tag).',
  use: '[nomor ...]   contoh: 081234567890',
  run: async (m) => {
    const targets = m.func.targets(m)
    if (!targets.length) return m.reply('Contoh: ' + m.config.prefix + 'promote 081234567890\nAtau reply / tag member.')
    try {
      await m.sock.groupParticipantsUpdate(m.chat, targets, 'promote')
      await m.reply('✅ Berhasil promote ' + targets.map((t) => m.func.num(t)).join(', ') + ' jadi admin.')
    } catch (e) {
      await m.reply('❌ Gagal: ' + e.message)
    }
  },
}
