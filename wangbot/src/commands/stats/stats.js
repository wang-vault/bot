module.exports = {
  name: 'stats',
  aliases: ['statistik', 'stat'],
  category: 'stats',
  desc: 'Statistik bot (grup, user, command, uptime).',
  run: async (m) => {
    const db = m.db
    const ms = process.uptime() * 1000
    const text =
      '📈 *STATISTIK BOT*\n\n' +
      `👥 Total Grup    : ${Object.keys(db.data.groups).length}\n` +
      `👤 Total User    : ${Object.keys(db.data.users).length}\n` +
      `⌨️ Total Command : ${db.data.stats.commands || 0}\n` +
      `🕐 Sesi ini       : ${db.data.stats.commandsSession || 0}\n` +
      `⏱️ Uptime         : ${m.func.uptime(ms)}\n` +
      `🧩 Command tersedia: ${m.loader.commands.length}`
    await m.reply(text)
  },
}
