const logger = require('../../lib/logger')

module.exports = {
  name: 'restore',
  aliases: ['restoredb'],
  category: 'owner',
  isOwner: true,
  desc: 'Restore database dari file json (reply file database).',
  run: async (m) => {
    try {
      if (!m.quoted || !m.quoted.media || m.quoted.media.type !== 'document') {
        return m.reply('⚠️ Reply pesan *file database.json* lalu ketik command ini.')
      }
      const buf = await m.quoted.download()
      if (!buf) return m.reply('❌ Gagal mengunduh file.')
      let parsed
      try {
        parsed = JSON.parse(buf.toString('utf8'))
      } catch (e) {
        return m.reply('❌ File bukan JSON yang valid.')
      }
      if (typeof parsed !== 'object' || parsed === null) {
        return m.reply('❌ Format database tidak valid.')
      }
      // backup lama dulu
      const old = JSON.parse(JSON.stringify(m.db.data))
      try {
        m.db.data = m.db._deepMerge(m.db.data, parsed)
        m.db.save(true)
        await m.reply('✅ Database berhasil di-restore.\n\nKetik *' + m.config.prefix + 'restart* agar sepenuhnya aktif.')
      } catch (e) {
        m.db.data = old
        m.db.save(true)
        await m.reply('❌ Gagal restore, database lama dikembalikan: ' + e.message)
      }
    } catch (e) {
      logger.error('restore', e)
      await m.reply('❌ ' + e.message)
    }
  },
}
