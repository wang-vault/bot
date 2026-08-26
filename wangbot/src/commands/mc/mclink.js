const Mc = require('../../lib/mc')
const Panel = require('../../lib/panel')
const config = require('../../config')

// Hubungkan akun WhatsApp pelanggan ke akun panel-nya lewat Client API key.
// Key ini sekaligus jadi batas hak akses: pelanggan hanya bisa melihat server
// yang memang terlihat oleh akun panel-nya.
module.exports = {
  name: 'mclink',
  aliases: ['mcregister', 'mcreg', 'mclogin'],
  category: 'mc',
  isPrivate: true,
  desc: 'Hubungkan akun panel WangStore untuk monitoring server Minecraft.',
  use: '<email panel> <Client API key>  |  .mclink off',
  run: async (m) => {
    if (!config.panelApiUrl) {
      return m.reply('⚙️ Bot belum dikonfigurasi dengan PANEL_API_URL. Hubungi admin WangStore.')
    }

    const args = m.args.trim()
    if (/^(off|hapus|unlink|stop)$/i.test(args)) {
      const had = Mc.delEntry(m.db, m.sender)
      return m.reply(
        had
          ? '✅ Tautan akun panel dihapus. Data servermu tidak dipantau lagi.'
          : 'ℹ️ Belum ada tautan yang perlu dihapus.'
      )
    }

    const [email, token] = args.split(/\s+/)
    if (!email || !token) {
      return m.reply(
        '🔗 *HUBUNGKAN AKUN PANEL*\n\n' +
          'Format: `' +
          m.config.prefix +
          'mclink <email panel> <Client API key>`\n\n' +
          'Ambil key-nya:\n' +
          '1. Login ke ' +
          (config.panelUrl || 'panel WangStore') +
          '\n' +
          '2. Klik foto profil → *API Credentials*\n' +
          '3. *Create New* → centang *Read* (boleh juga *Control* bila ingin restart dari WA)\n' +
          '4. Salin key-nya ke sini\n\n' +
          '🔒 Key hanya dipakai bot untuk membaca server *milikmu sendiri*.\n' +
          'Lepas kapan saja: `' +
          m.config.prefix +
          'mclink off`'
      )
    }

    await m.react('⏳').catch(() => {})

    const prev = config.panelClientToken
    config.panelClientToken = token
    let list
    try {
      list = await Panel.clientListServers()
    } finally {
      config.panelClientToken = prev
    }
    if (list.error) return m.reply('❌ ' + list.error)

    Mc.setEntry(m.db, m.sender, { email, token })
    const monitored = Mc.allServers(m.db).filter((s) => s.ownerJid === m.sender)

    let t = `✅ *Akun panel terhubung*\nEmail: ${email}\nServer terlihat: ${list.length}\n`
    if (list.length) {
      t += '\n*Daftar server:*\n'
      t += list.slice(0, 10).map((s) => `• ${s.name} \`${s.identifier}\`${s.mcPort ? ' — ' + s.mcHost + ':' + s.mcPort : ''}`).join('\n')
      if (list.length > 10) t += `\n… dan ${list.length - 10} lainnya`
    }
    t += monitored.length
      ? `\n\nDipantau bot: ${monitored.length} server.`
      : `\n\nAktifkan pemantauan: \`${m.config.prefix}mcwatch <nama server>\``
    await m.reply(t.trim())
  },
}
