const Mc = require('../../lib/mc')
const Panel = require('../../lib/panel')
const MC = require('../../lib/minecraft')

module.exports = {
  name: 'mcres',
  aliases: ['mcresource', 'mcram', 'mccpu'],
  category: 'mc',
  desc: 'Pemakaian CPU / RAM / disk server Minecraft (via panel).',
  use: '[nama|identifier server]',
  cooldown: 5,
  run: async (m) => {
    const r = Mc.resolveServer(m.db, m.sender, m.isOwner, m.args)
    if (r.error) return m.reply('❌ ' + r.error)
    const srv = r.server

    const res = await Mc.resourcesFor(m.db, srv)
    if (!res) {
      return m.reply(
        '⚠️ Data resource tidak tersedia.\n' +
          'Fitur ini membaca panel, jadi butuh Client API key: `' +
          m.config.prefix +
          'mclink`\n\n' +
          'Alternatif tanpa panel: `' +
          m.config.prefix +
          'mcstatus ' +
          srv.name +
          '` (status + player).'
      )
    }

    let t = `📊 *RESOURCE — ${srv.name}*\n\n`
    t += `Power : ${res.state || '-'}\n`
    t += `Uptime: ${res.uptimeMs ? MC.uptimeText(res.uptimeMs) : '-'}\n\n`
    t += `CPU  : ${Mc.bar(res.cpuPct)}\n`
    t += `       ${res.cpuPctRaw}% absolut (limit ${res.cpuLimit || 'unlimited'}%)\n`
    t += `RAM  : ${Mc.bar(res.ramPct)}\n`
    t += `       ${Panel.humanMB(res.memoryMB)} / ${res.memoryLimitMB ? Panel.humanMB(res.memoryLimitMB) : 'unlimited'}\n`
    t += `Disk : ${Mc.bar(res.diskPct)}\n`
    t += `       ${Panel.humanMB(res.diskMB)} / ${res.diskLimitMB ? Panel.humanMB(res.diskLimitMB) : 'unlimited'}`
    if (res.ramPct != null && res.ramPct >= 90) {
      t += `\n\n⚠️ RAM hampir habis — server berisiko lag / crash. Pertimbangkan upgrade paket.`
    }
    await m.reply(t.trim())
  },
}
