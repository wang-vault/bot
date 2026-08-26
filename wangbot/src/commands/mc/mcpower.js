const Mc = require('../../lib/mc')
const Panel = require('../../lib/panel')
const config = require('../../config')

const LABEL = { start: 'menyalakan', stop: 'mematikan', restart: 'me-restart', kill: 'memaksa mati' }

module.exports = {
  name: 'mcpower',
  aliases: ['mcrestart', 'mcstart', 'mcstop'],
  category: 'mc',
  desc: 'Nyalakan / matikan / restart server Minecraft lewat panel.',
  use: '[server] <start|stop|restart|kill>',
  cooldown: 10,
  run: async (m) => {
    if (m.isGroup && !m.isOwner) {
      return m.reply('⛔ Kontrol server hanya bisa di *chat pribadi* bot.')
    }

    const parts = m.args.trim().split(/\s+/).filter(Boolean)
    let signal = (parts[parts.length - 1] || '').toLowerCase()
    // alias command: .mcrestart <server>
    if (!['start', 'stop', 'restart', 'kill'].includes(signal)) {
      if (m.command === 'mcrestart') signal = 'restart'
      else if (m.command === 'mcstart') signal = 'start'
      else if (m.command === 'mcstop') signal = 'stop'
    }
    if (!['start', 'stop', 'restart', 'kill'].includes(signal)) {
      return m.reply('Contoh: `' + m.config.prefix + 'mcpower ' + (parts[0] || '<server>') + ' restart`')
    }
    const query = parts.slice(0, -1).join(' ') || (m.command.startsWith('mc') && parts.length === 1 ? '' : m.args)

    const r = Mc.resolveServer(m.db, m.sender, m.isOwner, query)
    if (r.error) return m.reply('❌ ' + r.error)
    const srv = r.server

    const entry = Mc.getEntry(m.db, srv.ownerJid)
    if (!entry || !entry.token) {
      return m.reply('⚠️ Server ini tidak terhubung ke panel. Kontrol power tidak tersedia.')
    }

    await m.react('⏳').catch(() => {})

    const prev = config.panelClientToken
    config.panelClientToken = entry.token
    let res
    try {
      res = await Panel.clientPower(srv.identifier, signal)
    } finally {
      config.panelClientToken = prev
    }

    if (res.error) {
      return m.reply(
        '❌ ' + res.error +
          (res.error.indexOf('403') >= 0 || /Token ditolak/.test(res.error)
            ? '\nClient API key perlu izin *Control*. Buat ulang key di panel lalu `' + m.config.prefix + 'mclink` lagi.'
            : '')
      )
    }

    const label = LABEL[signal] || signal
    await m.react('✅').catch(() => {})
    await m.reply(`✅ Perintah *${label}* dikirim ke *${srv.name}*.\nCek: \`${m.config.prefix}mcstatus ${srv.name}\``)
  },
}
