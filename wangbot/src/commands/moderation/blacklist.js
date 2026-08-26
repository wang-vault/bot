module.exports = {
  name: 'blacklist',
  aliases: ['bl'],
  category: 'moderation',
  isOwner: true,
  desc: 'Blacklist user/grup dari bot (Owner).',
  use: 'add user <reply/tag/nomor> | add group | del user | list',
  run: async (m) => {
    const bl = m.db.data.blacklist
    const [action, type, ...rest] = (m.args || '').toLowerCase().split(/\s+/)

    if (action === 'list' || !action) {
      let t = '🖤 *BLACKLIST*\n\n'
      t += '*User:*\n' + (bl.users.length ? bl.users.map((u) => '@' + u.split('@')[0]).join('\n') : '(kosong)')
      t += '\n\n*Grup:*\n' + (bl.groups.length ? bl.groups.join('\n') : '(kosong)')
      return m.reply(t, { mentions: bl.users })
    }

    if (action === 'add') {
      if (type === 'user') {
        let target = rest[0] ? rest[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net' : m.quoted ? m.quoted.sender : m.mentionedJid[0]
        if (!target) return m.reply('Reply/tag/nomor user.')
        if (m.func.isOwner(target, m.db)) return m.reply('⚠️ Tidak bisa blacklist owner.')
        if (!bl.users.includes(target)) {
          bl.users.push(target)
          m.db.save()
        }
        return m.reply('✅ User diblacklist.')
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
        let target = rest[0] ? rest[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net' : m.quoted ? m.quoted.sender : m.mentionedJid[0]
        const i = bl.users.indexOf(target)
        if (i < 0) return m.reply('ℹ️ Tidak ada.')
        bl.users.splice(i, 1)
        m.db.save()
        return m.reply('✅ Dihapus dari blacklist.')
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
