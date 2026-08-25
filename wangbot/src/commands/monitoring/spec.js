const Panel = require('../../lib/panel')
const { humanMB } = Panel

module.exports = {
  name: 'nodespec',
  aliases: ['spec', 'spesifikasi', 'nodespecs'],
  category: 'monitoring',
  desc: 'Spesifikasi node (limit CPU/RAM/Disk, lokasi, FQDN).',
  use: '[id|nama node]',
  run: async (m) => {
    const summary = await Panel.summary()
    if (!summary.configured) return m.reply('⚙️ Panel API belum dikonfigurasi.')
    if (summary.error) return m.reply('❌ ' + summary.error)

    let nodes = summary.nodes
    if (m.args) {
      const q = m.args.toLowerCase()
      nodes = nodes.filter((n) => String(n.id) === m.args || (n.name || '').toLowerCase().includes(q))
      if (!nodes.length) return m.reply('❌ Node tidak ditemukan.')
    }

    let t = '🖥️ *SPESIFIKASI NODE*\n'
    for (const n of nodes) {
      t += `\n*${n.name}* (#${n.id}) — ${n.online ? '🟢 Online' : '🔴 Offline'}\n`
      t += `FQDN     : ${n.fqdn || '-'}\n`
      t += `Lokasi   : ${n.location || '-'}\n`
      t += `CPU Limit: ${n.cpuLimit || '-'}%\n`
      t += `RAM Limit: ${n.memoryLimit ? humanMB(n.memoryLimit) : '-'}\n`
      t += `Disk     : ${n.diskLimit ? humanMB(n.diskLimit) : '-'}\n`
      t += `Terpakai : CPU ${n.cpu} | RAM ${n.ram} | Disk ${n.disk}\n`
      t += `Servers  : ${n.servers}\n`
      t += `Daemon   : ${n.fqdn || '-'}:${'8080'}\n`
    }
    await m.reply(t.trim())
  },
}
