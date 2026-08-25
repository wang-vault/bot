const Panel = require('../../lib/panel')

function pct(v) {
  return v != null ? v + '%' : '-'
}

function bar(p) {
  if (p == null) return '?????'
  const f = Math.min(100, Math.max(0, p))
  const filled = Math.round(f / 10)
  return '█'.repeat(filled) + '░'.repeat(10 - filled) + ' ' + f + '%'
}

module.exports = {
  name: 'resource',
  aliases: ['res', 'resources'],
  category: 'monitoring',
  desc: 'Resource node (CPU, RAM, Disk).',
  run: async (m) => {
    const summary = await Panel.summary()
    if (!summary.configured) return m.reply('⚙️ Panel API belum dikonfigurasi.')
    if (summary.error) return m.reply('❌ ' + summary.error)

    let t = '📊 *RESOURCE NODE*\n'
    for (const n of summary.nodes) {
      t += `\n${n.online ? '🟢' : '🔴'} *${n.name}* (#${n.id})\n`
      t += `CPU  : ${bar(n.cpuPct)}\n`
      t += `RAM  : ${bar(n.ramPct)}\n`
      t += `Disk : ${bar(n.diskPct)}\n`
    }
    await m.reply(t)
  },
}
