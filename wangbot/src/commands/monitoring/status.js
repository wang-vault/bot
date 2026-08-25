const Panel = require('../../lib/panel')

function pct(v) {
  return v != null ? v + '%' : '-'
}

module.exports = {
  name: 'status',
  aliases: ['mon', 'statushost', 'monitor', 'panel'],
  category: 'monitoring',
  desc: 'Status website, panel, node & server.',
  run: async (m) => {
    await m.reply('📡 Mengecek status hosting...')
    const ws = await Panel.websiteStatus()
    const ps = await Panel.panelStatus()

    let t = '📊 *MONITORING HOSTING - WANGSTORE*\n\n'
    t += `🌐 Website : ${ws.ok ? '🟢 Online (' + ws.status + ')' : '🔴 Down (' + (ws.error || ws.status) + ')'}\n`
    t += `🟦 Panel   : ${ps.ok ? '🟢 Online (' + ps.status + ')' : '🔴 Down (' + (ps.error || ps.status) + ')'}\n`

    const summary = await Panel.summary()
    if (!summary.configured) {
      t += '\nℹ️ *Panel API belum dikonfigurasi*.\nIsi PANEL_API_URL & PANEL_API_TOKEN di .env untuk monitoring node.'
      return m.reply(t)
    }
    if (summary.error) {
      t += '\n⚠️ Node: ' + summary.error
      return m.reply(t)
    }

    t += `🖥️ Node    : ${summary.totalNodes}\n`
    t += `📦 Server  : ${summary.activeServers}/${summary.totalServers} aktif\n\n`
    t += '*━━ DETAIL NODE ━━*\n'
    for (const n of summary.nodes) {
      const icon = n.maintenance ? '🛠️' : n.online ? '🟢' : '🔴'
      t += `\n${icon} *${n.name}* (#${n.id})\n`
      t += `   CPU ${pct(n.cpuPct)} | RAM ${pct(n.ramPct)} | Disk ${pct(n.diskPct)} | ${n.servers} srv\n`
    }
    await m.reply(t.trim())
  },
}
