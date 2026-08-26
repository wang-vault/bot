const Mc = require('../../lib/mc')
const Panel = require('../../lib/panel')
const config = require('../../config')

module.exports = {
  name: 'mcstatus',
  aliases: ['mccek', 'mcinfo', 'cekmc'],
  category: 'mc',
  desc: 'Status server Minecraft: online, player, versi, MOTD, resource.',
  use: '[nama|identifier server]',
  cooldown: 5,
  run: async (m) => {
    const r = Mc.resolveServer(m.db, m.sender, m.isOwner, m.args)
    if (r.error) return m.reply('❌ ' + r.error)
    const srv = r.server

    await m.react('⏳').catch(() => {})
    const chk = await Mc.checkServer(m.db, srv)

    let t = `🎮 *${chk.name}*\n`
    t += `Status : ${chk.online ? '🟢 *ONLINE*' : '🔴 *OFFLINE*'}\n`
    t += `Alamat : ${srv.host ? srv.host + ':' + srv.port : '-'}\n`

    if (chk.slp && chk.slp.online) {
      const p = chk.slp.players
      t += `Player : ${p.online}/${p.max}\n`
      t += `Versi  : ${chk.slp.version.name}${chk.slp.version.protocol != null ? ' (' + chk.slp.version.protocol + ')' : ''}\n`
      t += `Ping   : ${chk.slp.latency} ms\n`
      if (chk.slp.description) t += `MOTD   : ${chk.slp.description.slice(0, 120)}\n`
    } else if (chk.slp && chk.slp.error) {
      t += `Ping MC: ❌ ${chk.slp.error}\n`
    } else {
      t += `Ping MC: ⚠️ host belum diset\n`
    }

    if (chk.res) {
      const res = chk.res
      t += `Power  : ${res.state || '-'}\n`
      t += `Uptime : ${res.uptimeMs ? require('../../lib/minecraft').uptimeText(res.uptimeMs) : '-'}\n`
      t += `RAM    : ${Mc.bar(res.ramPct)}${res.memoryLimitMB ? ' (' + Panel.humanMB(res.memoryMB) + '/' + Panel.humanMB(res.memoryLimitMB) + ')' : ' (' + Panel.humanMB(res.memoryMB) + ')' }\n`
      t += `CPU    : ${res.cpuPct != null ? res.cpuPct + '% dari ' + res.cpuLimit + '%' : res.cpuPctRaw + '%'}\n`
      t += `Disk   : ${Panel.humanMB(res.diskMB)}${res.diskLimitMB ? '/' + Panel.humanMB(res.diskLimitMB) : ''}\n`
    } else if (srv.panel !== false) {
      t += `Resource: ⚠️ butuh Client API key (${m.config.prefix}mclink)\n`
    }

    t += `\nSumber data: ${chk.source.length ? chk.source.join(' + ') : '-'}`
    t += `\n\n${m.config.prefix}mcplayers ${srv.name} — siapa saja yang main`
    if (!chk.online) t += `\n${m.config.prefix}mcpower ${srv.name} start — nyalakan server`
    await m.reply(t.trim())
  },
}
