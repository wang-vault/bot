module.exports = {
  name: 'promogroup',
  aliases: ['pgroup', 'promogrup'],
  category: 'marketing',
  isOwner: true,
  desc: 'Kelola daftar grup tujuan promosi.',
  use: 'add [jid] | del <index> | list',
  run: async (m) => {
    const mk = m.db.data.marketing
    const [action, ...rest] = m.args.toLowerCase().split(/\s+/)

    if (action === 'list' || !action) {
      if (!mk.groups.length) return m.reply('ℹ️ Belum ada grup promosi.')
      let t = '📢 *GRUP PROMOSI*\n\n'
      mk.groups.forEach((g, i) => (t += `${i + 1}. ${g}\n`))
      return m.reply(t.trim())
    }

    if (action === 'add') {
      let jid = rest[0] && rest[0].endsWith('@g.us') ? rest[0] : m.isGroup ? m.chat : ''
      if (!jid) return m.reply('Gunakan di grup, atau: .promogroup add <jid@g.us>')
      if (mk.groups.includes(jid)) return m.reply('ℹ️ Sudah ada.')
      mk.groups.push(jid)
      m.db.save()
      return m.reply('✅ Grup ditambahkan ke daftar promosi.')
    }

    if (action === 'del') {
      if (rest[0] && rest[0].endsWith('@g.us')) {
        const i = mk.groups.indexOf(rest[0])
        if (i < 0) return m.reply('ℹ️ Tidak ada.')
        mk.groups.splice(i, 1)
      } else {
        const idx = parseInt(rest[0], 10) - 1
        if (isNaN(idx) || idx < 0 || idx >= mk.groups.length) return m.reply('Contoh: .promogroup del 1')
        mk.groups.splice(idx, 1)
      }
      m.db.save()
      return m.reply('✅ Grup dihapus dari daftar promosi.')
    }

    await m.reply('Format salah. .promogroup add|del|list')
  },
}
