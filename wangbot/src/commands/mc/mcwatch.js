const Mc = require('../../lib/mc')
const config = require('../../config')

// Mengambil server dari panel pelanggan lalu memasukkannya ke daftar pantau
// (atau mengeluarkannya bila sudah ada).
module.exports = {
  name: 'mcwatch',
  aliases: ['mcadd', 'mcmonitor', 'mcpantau'],
  category: 'mc',
  desc: 'Pantau / hentikan pantau sebuah server Minecraft.',
  use: '<nama|identifier server> [on|off]',
  cooldown: 5,
  run: async (m) => {
    const entry = Mc.getEntry(m.db, m.sender)
    if (!entry) return m.reply('🔗 Hubungkan akun panel dulu: `' + m.config.prefix + 'mclink`')

    const parts = m.args.trim().split(/\s+/)
    const mode = (parts[parts.length - 1] || '').toLowerCase()
    const explicit = mode === 'on' || mode === 'off'
    const query = (explicit ? parts.slice(0, -1) : parts).join(' ')
    if (!query) return m.reply('Contoh: `' + m.config.prefix + 'mcwatch Survival on`')

    await m.react('⏳').catch(() => {})
    const list = await Mc.listFromPanel(entry)
    if (list.error) return m.reply('❌ ' + list.error)

    const servers = list.servers
    const q = query.toLowerCase()
    const hit =
      servers.find((s) => s.identifier.toLowerCase() === q || s.name.toLowerCase() === q) ||
      servers.find((s) => s.name.toLowerCase().includes(q))
    if (!hit) {
      return m.reply(
        '❌ Server "' + query + '" tidak ditemukan di akun panelmu.\nServermu:\n' +
          (servers.length ? servers.map((s) => '• ' + s.name + ' `' + s.identifier + '`').join('\n') : '(kosong)')
      )
    }

    const existing = Mc.serverOf(m.db, hit.identifier)
    if (existing && existing.ownerJid === m.sender) {
      if (explicit && mode === 'off') {
        Mc.removeServer(m.db, hit.identifier)
        return m.reply('✅ *' + hit.name + '* dikeluarkan dari pemantauan.')
      }
      Mc.registerServer(m.db, m.sender, hit, { monitor: explicit ? true : !existing.monitor })
      const on = Mc.serverOf(m.db, hit.identifier).monitor
      return m.reply(
        `${on ? '✅' : '⏸️'} Pemantauan *${hit.name}* ${on ? 'DIAKTIFKAN' : 'DIJEDAKAN'}.\nInterval cek: tiap ${config.mcInterval} menit.`
      )
    }

    if (existing && existing.ownerJid !== m.sender) {
      return m.reply('⛔ Server itu sudah didaftarkan oleh akun lain.')
    }

    if (Mc.countFor(m.db, m.sender) >= config.mcMaxPerUser) {
      return m.reply('⚠️ Batas ' + config.mcMaxPerUser + ' server per akun. Hapus salah satu dulu.')
    }

    const reg = Mc.registerServer(m.db, m.sender, hit, { monitor: explicit ? mode === 'on' : true })
    if (reg.error) return m.reply('❌ ' + reg.error)
    const s = reg.server
    let t = `✅ *${s.name}* sekarang dipantau.\n`
    t += `Alamat: ${s.host ? s.host + ':' + s.port : '-'}\n`
    t += `Interval: tiap ${config.mcInterval} menit\n\n`
    t += `Coba: \`${m.config.prefix}mcstatus ${s.name}\``
    if (!s.host) t += '\n\n⚠️ Alamat belum kebaca dari panel. Set manual: `' + m.config.prefix + 'mcadmin sethost ' + s.identifier + ' <ip> <port>`'
    await m.reply(t.trim())
  },
}
