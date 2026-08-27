const Ai = require('../../lib/ai')

// Lupakan riwayat percakapan AI di chat ini (riwayat cuma di memori, TTL 30 menit).
module.exports = {
  name: 'aiclear',
  aliases: ['aireset', 'lupachat', 'aiforget'],
  category: 'ai',
  desc: 'Lupakan obrolan AI sebelumnya di chat ini.',
  run: async (m) => {
    const before = Ai.historyOf(m.chat).length
    Ai.clearHistory(m.chat)
    return m.reply(
      before
        ? `🧹 Riwayat AI di chat ini dihapus (${before} pesan). Topik baru dimulai.`
        : 'ℹ️ Belum ada riwayat AI di chat ini.'
    )
  },
}
