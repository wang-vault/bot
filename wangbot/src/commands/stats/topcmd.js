module.exports = {
  name: 'topcmd',
  aliases: ['topcommand', 'commandstats'],
  category: 'stats',
  desc: 'Command paling sering dipakai.',
  run: async (m) => {
    const entries = Object.entries(m.db.data.cmdUsage || {})
    if (!entries.length) return m.reply('ℹ️ Belum ada data command.')
    entries.sort((a, b) => b[1] - a[1])
    let t = '🏆 *TOP COMMAND*\n\n'
    entries.slice(0, 10).forEach(([cmd, count], i) => {
      t += `${i + 1}. ${m.config.prefix}${cmd} — ${count}x\n`
    })
    await m.reply(t.trim())
  },
}
