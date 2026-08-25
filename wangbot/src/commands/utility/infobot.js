const pkg = require('../../../package.json')

module.exports = {
  name: 'infobot',
  aliases: ['botinfo', 'info'],
  category: 'utility',
  desc: 'Informasi detail tentang bot.',
  run: async (m) => {
    const { config, db } = m
    const ms = process.uptime() * 1000
    const text =
      `🤖 *INFORMASI BOT*\n\n` +
      `Nama      : ${config.botName}\n` +
      `Versi     : v${pkg.version}\n` +
      `Runtime   : ${m.func.uptime(ms)}\n` +
      `Prefix    : ${config.prefix}\n` +
      `Total Grup : ${Object.keys(db.data.groups).length}\n` +
      `Total User : ${Object.keys(db.data.users).length}\n` +
      `Total Cmd  : ${db.data.stats.commands || 0}\n` +
      `Node.js   : ${process.version}\n` +
      `Platform  : ${process.platform}\n\n` +
      `🌐 Website : ${config.website || '-'}\n` +
      `🟦 Panel   : ${config.panelUrl || '-'}`
    await m.reply(text)
  },
}
