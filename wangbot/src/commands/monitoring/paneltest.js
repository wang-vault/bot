const config = require('../../config')

module.exports = {
  name: 'paneltest',
  aliases: ['testpanel', 'cekpanel'],
  category: 'monitoring',
  isOwner: true,
  desc: 'Diagnosa koneksi & token panel API.',
  run: async (m) => {
    const url = config.panelApiUrl
    const token = config.panelApiToken
    if (!url || !token) {
      return m.reply('❌ PANEL_API_URL / PANEL_API_TOKEN belum diisi di .env.')
    }
    const masked = token.length > 12 ? token.slice(0, 6) + '...' + token.slice(-4) : '(terlalu pendek)'
    let report = `🧪 *PANEL API TEST*\n\n`
    report += `URL   : ${url}\n`
    report += `Token : ${masked} (panjang ${token.length})\n\n`

    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 15000)
    try {
      const res = await fetch(`${url}/api/application/nodes?per_page=1`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: ctrl.signal,
      })
      clearTimeout(t)
      report += `GET /api/application/nodes\n→ HTTP ${res.status} ${res.statusText}\n\n`
      if (res.ok) {
        const j = await res.json()
        report += `✅ Token VALID & punya izin Nodes.\nJumlah node: ${j.meta?.pagination?.total ?? (j.data && j.data.length) ?? '?'}`
      } else {
        let body = ''
        try { body = (await res.text()).slice(0, 180) } catch (_) {}
        if (body) report += `Body: ${body}\n\n`
        if (res.status === 401 || res.status === 403) {
          report += `💡 Penyebab & solusi:\n`
          report += `• Kamu kemungkinan pakai *Client API key* (Account → API). ` +
            `Yang dibutuhkan adalah *Application API key* (Admin → Application API).\n`
          report += `• Atau key-nya sudah benar tapi *permission Nodes* belum dicentang. ` +
            `Buat ulang key dgn permission: Locations, Nodes, Servers (Read).\n`
          report += `• Copy *seluruh* string key ke PANEL_API_TOKEN tanpa spasi.`
        } else if (res.status === 404) {
          report += `💡 404 = URL salah / bukan panel Pterodactyl. Cek PANEL_API_URL.`
        }
      }
    } catch (e) {
      clearTimeout(t)
      report += `❌ Tidak bisa terhubung: ${e.name === 'AbortError' ? 'timeout' : e.message}\n`
      report += `💡 Cek PANEL_API_URL bisa diakses dari server bot.`
    }
    await m.reply(report)
  },
}
