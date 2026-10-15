module.exports = {
  name: 'blacklist',
  aliases: ['bl'],
  category: 'moderation',
  isOwner: true,
  desc: 'Blacklist user/grup dari bot (Owner).',
  use: 'add user <nomor> | add group | del user <nomor> | list',
  run: async (m) => {
    const bl = m.db.data.blacklist
    const [action, type, ...rest] = (m.args || '').toLowerCase().split(/\s+/)

    if (action === 'list' || !action) {
      let t = '🖤 *BLACKLIST*\n\n'
      t += '*User (nomor):*\n' + (bl.users.length ? bl.users.map((u) => '@' + m.func.num(u)).join('\n') : '(kosong)')
      t += '\n\n*Grup (JID grup, bukan nomor):*\n' + (bl.groups.length ? bl.groups.join('\n') : '(kosong)')
      return m.reply(t, { mentions: bl.users })
    }

    if (action === 'add') {
      if (type === 'user') {
        // Utamakan NOMOR (identitas utama bot); LID cuma dipakai kalau nomornya
        // belum diketahui — tanpa ini blacklist bisa meleset saat LID dipetakan.
        const target = m.func.pnTarget(m, rest.join(' ')) || m.func.target(m, rest.join(' '))
        if (!target) return m.reply('Contoh: ' + m.config.prefix + 'blacklist add user 081234567890\nAtau reply / tag user-nya.')
        if (m.func.isOwner(target, m.db)) return m.reply('⚠️ Tidak bisa blacklist owner.')
        if (!bl.users.includes(target)) {
          bl.users.push(target)
          m.db.save()
        }
        return m.reply('✅ ' + m.func.num(target) + ' diblacklist.')
      }
      if (type === 'group') {
        if (!m.isGroup) return m.reply('Gunakan di grup.')
        if (!bl.groups.includes(m.chat)) {
          bl.groups.push(m.chat)
          m.db.save()
        }
        return m.reply('✅ Grup ini diblacklist.')
      }
    }

    if (action === 'del') {
      if (type === 'user') {
        const raw = m.func.target(m, rest.join(' '))
        const target = m.func.pnTarget(m, rest.join(' ')) || raw
        if (!target) return m.reply('Contoh: ' + m.config.prefix + 'blacklist del user 081234567890')
        let i = bl.users.indexOf(target)
        if (i < 0 && raw && raw !== target) i = bl.users.indexOf(raw)
        if (i < 0) return m.reply('ℹ️ ' + m.func.num(target) + ' tidak ada di blacklist.')
        bl.users.splice(i, 1)
        m.db.save()
        return m.reply('✅ ' + m.func.num(target) + ' dihapus dari blacklist.')
      }
      if (type === 'group') {
        const i = bl.groups.indexOf(m.chat)
        if (i < 0) return m.reply('ℹ️ Tidak ada.')
        bl.groups.splice(i, 1)
        m.db.save()
        return m.reply('✅ Grup dihapus dari blacklist.')
      }
    }

    await m.reply('Format salah. Ketik *.blacklist list*.')
  },
}
