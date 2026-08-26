const logger = require('../../lib/logger')

module.exports = {
  name: 'restart',
  aliases: ['reboot'],
  category: 'owner',
  isOwner: true,
  desc: 'Restart bot (butuh process manager seperti PM2).',
  run: async (m) => {
    await m.reply('♻️ Bot akan direstart dalam 3 detik...')
    logger.warn('Restart dipicu oleh owner')
    setTimeout(() => {
      try {
        m.db.save(true)
      } catch (_) {}
      // exit code 1 agar PM2/systemd auto-restart
      process.exit(1)
    }, 3000)
  },
}
