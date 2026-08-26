const Panel = require('../../lib/panel')

async function pingHost(url) {
  const t = Date.now()
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 8000)
    const r = await fetch(url, { signal: ctrl.signal, redirect: 'manual' })
    clearTimeout(timer)
    return { ms: Date.now() - t, status: r.status }
  } catch (e) {
    return { ms: Date.now() - t, error: e.name === 'AbortError' ? 'timeout' : e.message }
  }
}

module.exports = {
  name: 'pingnode',
  aliases: ['pingserver', 'latency'], // 'ping' dilepas: dipakai utility/ping (kecepatan bot)
  category: 'monitoring',
  desc: 'Ping ke node/host (latensi).',
  use: '<id node | nama node | url>',
  run: async (m) => {
    if (!m.args) return m.reply('Contoh: ' + m.config.prefix + 'pingnode 1')
    let url = m.args
    // cek apakah arg = node id/nama
    const summary = await Panel.summary()
    if (summary.configured && !summary.error && Array.isArray(summary.nodes)) {
      const q = m.args.toLowerCase()
      const node = summary.nodes.find((n) => String(n.id) === m.args || (n.name || '').toLowerCase() === q)
      if (node && node.fqdn) url = 'https://' + node.fqdn
    }
    if (!/^https?:\/\//.test(url)) url = 'https://' + url
    const r = await pingHost(url)
    let text = `📡 *PING*\n${url}\n\n`
    if (r.error) text += `Status: 🔴 ${r.error} (${r.ms} ms)`
    else text += `Status: 🟢 ${r.status}\nLatensi: *${r.ms} ms*`
    await m.reply(text)
  },
}
