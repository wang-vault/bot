const { exec } = require('child_process')
const logger = require('../../lib/logger')

module.exports = {
  name: 'exec',
  aliases: ['$', 'terminal'],
  category: 'owner',
  isOwner: true,
  desc: 'Eksekusi perintah terminal (Owner only).',
  use: '<perintah>',
  run: async (m) => {
    if (!m.args) return m.reply('Contoh: ' + m.config.prefix + 'exec ls -la')
    exec(m.args, { timeout: 30000 }, (err, stdout, stderr) => {
      let out = ''
      if (err) out += `Error: ${err.message}\n`
      if (stderr) out += stderr + '\n'
      if (stdout) out += stdout
      if (!out.trim()) out = '(no output)'
      if (out.length > 3800) out = out.slice(0, 3800) + '\n... (truncated)'
      m.reply('```' + out + '```').catch((e) => logger.error('exec reply', e))
    })
  },
}
