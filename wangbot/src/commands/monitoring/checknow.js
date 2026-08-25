const Monitor = require('../../lib/monitor')

module.exports = {
  name: 'checkmonitor',
  aliases: ['monitorcheck', 'cekmonitor'],
  category: 'monitoring',
  isOwner: true,
  desc: 'Jalankan cek monitoring otomatis secara manual (Owner).',
  run: async (m) => {
    await m.reply('🔍 Menjalankan cek monitoring...')
    await Monitor.now(m.sock, m.db)
    await m.reply('✅ Cek monitoring selesai. Notifikasi alert (jika ada) terkirim ke target.')
  },
}
