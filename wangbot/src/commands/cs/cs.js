module.exports = {
  name: 'cs',
  aliases: ['customer', 'customerservice', 'bantuan'],
  category: 'cs',
  desc: 'Pusat bantuan Customer Service.',
  run: async (m) => {
    const p = m.config.prefix
    const text =
      '🎫 *CUSTOMER SERVICE - WANGSTORE*\n\n' +
      `Kami siap membantu kamu! Pilih menu:\n\n` +
      `❓ ${p}faq — Daftar pertanyaan umum\n` +
      `📞 ${p}kontak — Kontak admin\n` +
      `🕒 ${p}jamop — Jam operasional\n` +
      `💬 ${p}feedback <pesan> — Saran & feedback\n` +
      `🚨 ${p}laporan <pesan> — Laporkan masalah\n` +
      `📦 ${p}paket — Info layanan hosting\n\n` +
      `Sedang butuh bantuan langsung? Chat admin: wa.me/${(m.config.waAdmin || '').split('@')[0]}`
    await m.reply(text)
  },
}
