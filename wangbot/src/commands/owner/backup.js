const fs = require('fs')
const path = require('path')

module.exports = {
  name: 'backup',
  aliases: ['savedb'],
  category: 'owner',
  isOwner: true,
  desc: 'Backup database bot (kirim file database.json).',
  run: async (m) => {
    try {
      m.db.save(true)
      const file = path.resolve(m.config.dbPath)
      if (!fs.existsSync(file)) return m.reply('❌ File database tidak ditemukan.')
      const buffer = fs.readFileSync(file)
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
      await m.sock.sendMessage(m.chat, {
        document: buffer,
        mimetype: 'application/json',
        fileName: `wangbot-backup-${stamp}.json`,
        caption: `✅ Backup database berhasil.\nUkuran: ${(buffer.length / 1024).toFixed(1)} KB`,
      })
    } catch (e) {
      await m.reply('❌ ' + e.message)
    }
  },
}
