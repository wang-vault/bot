const Mc = require('../../lib/mc')
const config = require('../../config')

// Panel kontrol untuk owner WangStore: lihat semua server pelanggan, tambahkan
// server secara manual (mis. server di luar panel / butuh alamat khusus),
// atur host-port, dan paksa cek sekarang.
module.exports = {
  name: 'mcadmin',
  aliases: ['mcall'],
  category: 'mc',
  isOwner: true,
  desc: 'Kelola semua server Minecraft pelanggan (Owner).',
  use: 'list | add <ownerJid> <nama> <host> <port> | sethost <id> <host> <port> | monitor <id> <on|off> | rm <id>',
  run: async (m) => {
    const [sub, ...rest] = m.args.trim().split(/\s+/).filter(Boolean)
    const all = Mc.allServers(m.db)
    const entries = Object.values(Mc.store(m.db).entries)
    const P = m.config.prefix

    if (!sub || sub === 'list') {
      let t = `🎮 *SEMUA SERVER MC* (${all.length})\n`
      t += `🔗 Pelanggan terhubung: ${entries.length}\n`
      if (!all.length) return m.reply(t + '\nBelum ada server didaftarkan.')
      for (const s of all) {
        t += `\n• *${s.name}* \`${s.identifier}\`\n`
        t += `  Owner  : ${Mc.num(s.ownerJid)}${s.ownerJid === s.addedBy ? '' : ' (oleh ' + Mc.num(s.addedBy) + ')'}\n`
        t += `  Alamat : ${s.host ? s.host + ':' + s.port : '-'}\n`
        t += `  Pantau : ${s.monitor === false ? 'off' : 'on'} | RCON: ${s.rcon && s.rcon.password ? 'ya' : 'tidak'}\n`
      }
      t += `\n\nInterval cek: tiap ${config.mcInterval} menit (MC_MONITOR_INTERVAL)`
      return m.reply(t.trim())
    }

    if (sub === 'add') {
      const [ownerRaw, name, host, port] = rest
      if (!ownerRaw || !name || !host) {
        return m.reply(`Contoh: \`${P}mcadmin add 081234567890 Survival play.wangstore.id 25565\``)
      }
      // Nomor pelanggan dinormalkan (0812.. -> 62812..), JID penuh tetap diterima.
      const ownerJid = m.func.jidFromInput(ownerRaw)
      if (!ownerJid) {
        return m.reply(`❌ "${ownerRaw}" bukan nomor yang bisa dipakai. Contoh: \`${P}mcadmin add 081234567890 Survival play.wangstore.id 25565\``)
      }
      const id = 'manual-' + Date.now().toString(36)
      Mc.setEntry(m.db, ownerJid, {})
      const reg = Mc.registerServer(
        m.db,
        ownerJid,
        { identifier: id, name, mcHost: host, mcPort: parseInt(port, 10) || 25565 },
        { host, port: parseInt(port, 10) || 25565, panel: false, addedBy: m.sender, notes: 'manual owner' }
      )
      if (reg.error) return m.reply('❌ ' + reg.error)
      return m.reply(
        `✅ Server *${name}* didaftarkan untuk ${Mc.num(ownerJid)}.\nAlamat: ${host}:${port}\nPemantauan: aktif (tanpa data resource panel).`
      )
    }

    if (sub === 'sethost') {
      const [id, host, port] = rest
      const s = Mc.serverOf(m.db, id)
      if (!s) return m.reply('❌ Server `' + id + '` tidak ditemukan.')
      if (!host) return m.reply(`Contoh: \`${P}mcadmin sethost ${id} play.wangstore.id 25565\``)
      s.host = host
      if (port) s.port = parseInt(port, 10) || s.port
      if (s.rcon && !s.rcon.host) s.rcon.host = host
      m.db.save()
      return m.reply(`✅ Alamat *${s.name}* → ${s.host}:${s.port}`)
    }

    if (sub === 'monitor') {
      const [id, mode] = rest
      const s = Mc.serverOf(m.db, id)
      if (!s) return m.reply('❌ Server `' + id + '` tidak ditemukan.')
      s.monitor = mode !== 'off'
      m.db.save()
      return m.reply(`${s.monitor ? '✅' : '⏸️'} Pemantauan *${s.name}*: ${s.monitor ? 'aktif' : 'nonaktif'}`)
    }

    if (sub === 'rm') {
      const [id] = rest
      if (!Mc.removeServer(m.db, id)) return m.reply('❌ Server `' + id + '` tidak ditemukan.')
      return m.reply('✅ Server dihapus dari pemantauan.')
    }

    if (sub === 'check') {
      await m.react('⏳').catch(() => {})
      const res = await Mc.monitorTick(m.db)
      const out = [`✅ Cek manual selesai.\nDiperiksa: ${res.checked} server | Down: ${res.down}`]
      for (const a of res.alerts) out.push(`→ ${Mc.num(a.jid)}:\n${a.text}`)
      for (const a of res.adminAlerts) out.push('→ admin: ' + a)
      return m.reply(out.join('\n\n').slice(0, 3500))
    }

    return m.reply(
      `🎮 *MC ADMIN*\n\n` +
        `${P}mcadmin list — semua server & pelanggan\n` +
        `${P}mcadmin add <nomor> <nama> <host> <port> — daftarkan manual\n` +
        `${P}mcadmin sethost <id> <host> <port> — ganti alamat\n` +
        `${P}mcadmin monitor <id> <on|off> — jeda/aktifkan pantau\n` +
        `${P}mcadmin check — jalankan cek sekarang\n` +
        `${P}mcadmin rm <id> — hapus`
    )
  },
}
