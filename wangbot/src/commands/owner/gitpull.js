const { exec } = require('child_process')

module.exports = {
  name: 'gitpull',
  aliases: ['update', 'pull'],
  category: 'owner',
  isOwner: true,
  desc: 'Pull update terbaru dari Git (Owner only).',
  run: async (m) => {
    await m.reply('📥 Menjalankan git pull...')
    exec('git pull', { timeout: 60000 }, async (err, stdout, stderr) => {
      let out = ''
      if (err) out += `Error: ${err.message}\n`
      if (stderr) out += stderr + '\n'
      if (stdout) out += stdout
      out += `\n\nℹ️ Jalankan *${m.config.prefix}restart* agar update aktif.`
      await m.reply('```' + (out || '(no output)') + '```').catch((e) => logger.error('gitpull reply', e))
    })
  },
}
