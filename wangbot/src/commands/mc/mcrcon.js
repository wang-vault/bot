const Mc = require('../../lib/mc')

module.exports = {
  name: 'mcrcon',
  aliases: ['setrcon'],
  category: 'mc',
  isPrivate: true,
  desc: 'Set / uji RCON server Minecraft (jalur cadangan console command).',
  use: '[server] <port> <password>  |  .mcrcon <server> test  |  .mcrcon <server> off',
  run: async (m) => {
    const parts = m.args.trim().split(/\s+/).filter(Boolean)
    if (parts.length < 2) {
      return m.reply(
        '🔐 *SET RCON*\n\n' +
          'Format: `' + m.config.prefix + 'mcrcon <server> <port> <password>`\n' +
          'Uji koneksi: `' + m.config.prefix + 'mcrcon <server> test`\n' +
          'Hapus: `' + m.config.prefix + 'mcrcon <server> off`\n\n' +
          'Di server.properties:\n' +
          '```\nenable-rcon=true\nrcon.port=25575\nrcon.password=<password>\n```\n' +
          'Lalu buka port rcon di panel (Allocation) dan di firewall.'
      )
    }

    const r = Mc.resolveServer(m.db, m.sender, m.isOwner, parts[0])
    if (r.error) return m.reply('❌ ' + r.error)
    const srv = r.server

    if (parts[1] === 'test') {
      const host = srv.rcon && srv.rcon.host ? srv.rcon.host : srv.host
      const port = (srv.rcon && srv.rcon.port) || 25575
      if (!srv.rcon || !srv.rcon.password) return m.reply('⚠️ RCON belum diset untuk *' + srv.name + '*.')
      await m.react('⏳').catch(() => {})
      const probe = await Mc.tcpProbe(host, port)
      if (!probe.ok) return m.reply(`❌ Port RCON ${host}:${port} tidak bisa dihubungi (${probe.error}).`)
      const res = await Mc.sendRcon(srv, 'list')
      if (res.error) return m.reply('⚠️ Port terbuka, tapi RCON gagal: ' + res.error)
      return m.reply('✅ RCON berfungsi.\n`list` → ' + ((res.lines || []).join(' ') || '(kosong)'))
    }

    if (parts[1] === 'off') {
      srv.rcon = { host: '', port: 25575, password: '' }
      m.db.save()
      return m.reply('✅ Kredensial RCON *' + srv.name + '* dihapus.')
    }

    const port = parseInt(parts[1], 10)
    const password = parts.slice(2).join(' ')
    if (!port || !password) return m.reply('Contoh: `' + m.config.prefix + 'mcrcon ' + srv.name + ' 25575 rahasia123`')

    srv.rcon = { host: srv.host, port, password }
    m.db.save()

    await m.react('⏳').catch(() => {})
    const res = await Mc.sendRcon(srv, 'list')
    if (res.error) {
      return m.reply(
        `💾 RCON disimpan untuk *${srv.name}*, tapi uji koneksi gagal:\n${res.error}\n\n` +
          'Periksa: enable-rcon=true, password sama, dan port RCON terbuka.'
      )
    }
    await m.reply('✅ RCON aktif untuk *' + srv.name + '*.\nUji `list` → ' + ((res.lines || []).join(' ') || '(kosong)'))
  },
}
