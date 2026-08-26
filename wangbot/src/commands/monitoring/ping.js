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
  aliases: ['pingserver', 'latency'],
  category: 'monitoring',
  desc: 'Ping ke node/host (latensi).',
  use: '<id node | nama node | url>',
  run: async (m) => {
    if (!m.args) return m.reply('Contoh: ' + m.config.prefix + 'pingnode 1')

    let url = m.args

    // Cek apakah arg = node id/nama — tapi pakai timeout ketat 5 detik
    // agar tidak block pingHost kalau panel lambat
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 5000)
      const summaryPromise = Panel.summary()
      const summary = await Promise.race([
        summaryPromise,
        new Promise((_, rej) => setTimeout(() => rej(new Error('summary timeout')), 5000))
      ])
      clearTimeout(timer)

      if (summary && summary.configured && !summary.error && Array.isArray(summary.nodes)) {
        const q = m.args.toLowerCase()
        const node = summary.nodes.find(
          (n) => String(n.id) === m.args || (n.name || '').toLowerCase() === q
        )
        if (node && node.fqdn) {
          // Wings pakai port 8080 (HTTP) atau 8443 (HTTPS) — bukan 443
          url = 'https://' + node.fqdn + ':8443'
        }
      }
    } catch (_) {
      // panel timeout/error → lanjut ping url langsung
    }

    if (!/^https?:\/\//.test(url)) url = 'https://' + url

    const r = await pingHost(url)
    let text = `📡 *PING*\n${url}\n\n`
    if (r.error) text += `Status: 🔴 ${r.error} (${r.ms} ms)`
    else text += `Status: 🟢 ${r.status}\nLatensi: *${r.ms} ms*`
    await m.reply(text)
  },
}
