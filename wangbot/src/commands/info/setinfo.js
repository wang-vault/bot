const Layanan = require('../../lib/layanan')

module.exports = {
  name: 'setinfo',
  aliases: ['editinfo'],
  category: 'info',
  isOwner: true,
  desc: 'Ubah teks informasi layanan.',
  use: '<key> <teks baru>',
  run: async (m) => {
    const parts = (m.args || '').split(' ')
    const key = (parts.shift() || '').toLowerCase()
    const value = parts.join(' ').trim()
    const keys = Layanan.listKeys()
    if (!key) {
      return m.reply('ℹ️ Key tersedia:\n' + keys.join(', ') + '\n\nContoh: .setinfo paket <teks>')
    }
    if (!keys.includes(key)) {
      return m.reply('❌ Key tidak valid. Pilih: ' + keys.join(', '))
    }
    if (!value) {
      return m.reply('Contoh: .setinfo ' + key + ' <teks baru>')
    }
    Layanan.set(m.db, key, value)
    await m.reply('✅ Info *' + key + '* diperbarui.')
  },
}
