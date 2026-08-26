const Mc = require('../../lib/mc')
const config = require('../../config')

module.exports = {
  name: 'mcservers',
  aliases: ['mclist', 'mcserver'],
  category: 'mc',
  desc: 'Daftar server Minecraft yang kamu pantau lewat bot.',
  run: async (m) => {
    const mine = Mc.allServers(m.db).filter((s) => s.ownerJid === m.sender)
    const entry = Mc.getEntry(m.db, m.sender)

    let t = '🎮 *SERVER MINECRAFT-KU*\n\n'
    t += entry
      ? `🔗 Panel: ${entry.email} (token ${Mc.maskToken(entry.token)})\n`
      : '🔗 Panel: *belum terhubung* — pakai `' + m.config.prefix + 'mclink`\n'

    if (!mine.length) {
      t += '\nBelum ada server dipantau.\n'
      t += entry
        ? `Aktifkan: \`${m.config.prefix}mcwatch <nama server>\``
        : `Hubungkan akun dulu: \`${m.config.prefix}mclink\``
      return m.reply(t.trim())
    }

    for (const s of mine) {
      t += `\n• *${s.name}* \`${s.identifier}\`\n`
      t += `  Alamat : ${s.host ? s.host + ':' + s.port : '-'}\n`
      t += `  Pantau : ${s.monitor === false ? '❌ nonaktif' : '✅ aktif'}\n`
      t += `  RCON   : ${s.rcon && s.rcon.password ? '✅ (' + s.rcon.host + ':' + s.rcon.port + ')' : '❌ belum diset'}\n`
    }

    t += `\n\n${m.config.prefix}mcwatch <server> — pantau / hentikan pantau\n`
    t += `${m.config.prefix}mcstatus <server> — cek status\n`
    t += `${m.config.prefix}mcres <server> — CPU/RAM\n`
    if (m.isOwner) t += `\n👑 ${m.config.prefix}mcadmin — semua server pelanggan (${Mc.allServers(m.db).length})`
    await m.reply(t.trim())
  },
}
