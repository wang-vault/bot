const config = require('../../config')

module.exports = {
  name: 'maintenance',
  aliases: ['maintenancemode', 'mtnc'],
  category: 'monitoring',
  isOwner: true,
  desc: 'Toggle maintenance mode sebuah node (Owner).',
  use: '<id node> <on|off>',
  run: async (m) => {
    if (!config.panelApiUrl || !config.panelApiToken) return m.reply('⚙️ Panel API belum dikonfigurasi.')
    const [id, mode] = m.args.toLowerCase().split(/\s+/)
    if (!id || (mode !== 'on' && mode !== 'off')) {
      return m.reply('Contoh: ' + m.config.prefix + 'maintenance 1 on')
    }
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 15000)
      const res = await fetch(`${config.panelApiUrl}/api/application/nodes/${id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${config.panelApiToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ maintenance_mode: mode === 'on' }),
        signal: ctrl.signal,
      })
      clearTimeout(timer)
      if (res.ok) await m.reply(`✅ Node #${id} maintenance mode: *${mode.toUpperCase()}*`)
      else await m.reply(`❌ Gagal (HTTP ${res.status})`)
    } catch (e) {
      await m.reply('❌ ' + e.message)
    }
  },
}
