const Panel = require('../../lib/panel')
const { humanMB } = Panel

module.exports = {
  name: 'servers',
  aliases: ['jumlahserver', 'serveraktif'],
  category: 'monitoring',
  desc: 'Jumlah server aktif & total resource terpakai.',
  run: async (m) => {
    const summary = await Panel.summary()
    if (!summary.configured) return m.reply('⚙️ Panel API belum dikonfigurasi.')
    if (summary.error) return m.reply('❌ ' + summary.error)

    let totalCpu = 0
    let totalRam = 0
    let totalDisk = 0
    let maxRam = 0
    let maxDisk = 0
    for (const n of summary.nodes) {
      totalCpu += n.cpuAlloc || parseInt(String(n.cpu).replace('%', '')) || 0
      totalRam += n.ramMB || 0
      totalDisk += n.diskMB || 0
      maxRam += n.memoryLimit || 0
      maxDisk += n.diskLimit || 0
    }

    const t =
      '📦 *STATISTIK SERVER*\n\n' +
      `Total Node  : ${summary.totalNodes}\n` +
      `Server Aktif: ${summary.activeServers} / ${summary.totalServers}\n` +
      `Total CPU   : ${totalCpu}%\n` +
      `RAM terpakai: ${humanMB(totalRam)} / ${humanMB(maxRam)}\n` +
      `Disk terpakai: ${humanMB(totalDisk)} / ${humanMB(maxDisk)}`
    await m.reply(t)
  },
}
