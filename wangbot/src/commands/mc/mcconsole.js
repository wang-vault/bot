const Mc = require('../../lib/mc')
const config = require('../../config')

// Jalankan console command Minecraft dari WhatsApp.
// Jalur utama: websocket console panel (tembus NAT). Cadangan: RCON.
module.exports = {
  name: 'mcconsole',
  aliases: ['mccmd', 'mcsay'],
  category: 'mc',
  desc: 'Kirim console command ke server Minecraft (mis. say, list, whitelist).',
  use: '[server] <command>   |  .mcconsole say Server restart 5 menit lagi',
  cooldown: 6,
  run: async (m) => {
    // Command console bisa mengganggu player, jadi dibatasi di private chat.
    if (m.isGroup && !m.isOwner && !config.mcConsoleInGroup) {
      return m.reply('⛔ Console command hanya bisa di *chat pribadi* bot. Ketik `' + m.config.prefix + 'mcconsole` di DM.')
    }

    const raw = m.args.trim()
    let srv = null
    let cmd = ''
    let lastErr = 'server tidak ditemukan'

    // Dua kemungkinan bentuk: "<command>" (server tunggal) atau
    // "<server> <command>". Dicoba keduanya supaya pelanggan tidak perlu
    // menghafal kapan harus menulis nama server.
    const r1 = Mc.resolveServer(m.db, m.sender, m.isOwner, raw)
    if (!r1.error) {
      srv = r1.server
      cmd = raw
    } else {
      lastErr = r1.error
      const sp = raw.search(/\s/)
      if (sp > 0) {
        const r2 = Mc.resolveServer(m.db, m.sender, m.isOwner, raw.slice(0, sp))
        if (!r2.error) {
          srv = r2.server
          cmd = raw.slice(sp + 1).trim()
        }
      }
    }
    if (!srv) return m.reply('❌ ' + lastErr)
    if (!cmd) return m.reply('Contoh: `' + m.config.prefix + 'mcconsole ' + srv.name + ' list`')

    if (Mc.isDangerous(cmd) && !m.isOwner && !/\s--ya$/.test(cmd)) {
      return m.reply(
        '⚠️ Command `' + cmd.split(/\s+/)[0] + '` berisiko (bisa menghentikan server / mengubah izin player).\n' +
          'Kalau memang yakin, ulangi dengan akhiran `--ya`:\n`' +
          m.config.prefix + 'mcconsole ' + srv.name + ' ' + cmd + ' --ya`'
      )
    }
    cmd = cmd.replace(/\s--ya$/, '').trim()

    await m.react('⏳').catch(() => {})

    // 1) coba console panel
    let out = await Mc.sendConsole(m.db, srv, cmd)
    let via = 'console panel'

    // 2) cadangan: RCON bila diset
    if (out.error && srv.rcon && srv.rcon.password) {
      const alt = await Mc.sendRcon(srv, cmd)
      if (!alt.error) {
        out = alt
        via = 'RCON'
      } else {
        out.error = out.error + '\nRCON juga gagal: ' + alt.error
      }
    }

    if (out.error && !(out.lines && out.lines.length)) {
      return m.reply(
        '❌ Gagal menjalankan command.\n' + out.error +
          '\n\nKemungkinan penyebab:\n' +
          '• Client API key belum punya izin *Control* (ulangi `' + m.config.prefix + 'mclink`)\n' +
          '• Server dalam keadaan mati\n' +
          '• Panel memblokir websocket (coba set RCON: `' + m.config.prefix + 'mcrcon`)'
      )
    }

    let t = `🖥️ *CONSOLE — ${srv.name}* (via ${via})\n`
    t += `> ${cmd}\n\n`
    const lines = (out.lines || []).slice(-20)
    t += lines.length ? lines.join('\n').slice(0, 3000) : '(server tidak mengirim output)'
    await m.reply(t.trim())
  },
}
