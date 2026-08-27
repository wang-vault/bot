module.exports = {
  name: 'whitelist',
  aliases: ['wl'],
  category: 'moderation',
  isGroup: true,
  isAdmin: true,
  desc: 'Kelola whitelist link & member (Anti Link/Promo kebal).',
  use: 'add link <domain> | add member <nomor> | del link <idx> | del member <nomor> | list',
  run: async (m) => {
    const g = m.db.getGroup(m.chat)
    const [action, type, ...rest] = m.args.toLowerCase().split(/\s+/)
    const data = rest.join(' ')

    if (action === 'list' || !action) {
      let t = '🤍 *WHITELIST GRUP*\n\n'
      t += '*Link:*\n'
      t += g.wlLinks.length ? g.wlLinks.map((l, i) => `${i + 1}. ${l}`).join('\n') : '(kosong)'
      t += '\n\n*Member:*\n'
      t += g.wlMembers.length ? g.wlMembers.map((l, i) => `${i + 1}. @${m.func.num(l)}`).join('\n') : '(kosong)'
      return m.reply(t, { mentions: g.wlMembers })
    }

    if (action === 'add') {
      if (type === 'link') {
        const link = data.replace(/^https?:\/\//, '').replace(/\/$/, '').trim()
        if (!link) return m.reply('Contoh: .whitelist add link wangstore.id')
        if (g.wlLinks.includes(link)) return m.reply('ℹ️ Sudah ada.')
        g.wlLinks.push(link)
        m.db.save()
        return m.reply('✅ Link *' + link + '* di-whitelist.')
      }
      if (type === 'member') {
        const target = m.func.target(m, data)
        if (!target) {
          return m.reply('Contoh: ' + m.config.prefix + 'whitelist add member 081234567890\nAtau reply / tag member untuk di-whitelist.')
        }
        if (g.wlMembers.includes(target)) return m.reply('ℹ️ @' + m.func.num(target) + ' sudah ada.', { mentions: [target] })
        g.wlMembers.push(target)
        m.db.save()
        return m.reply('✅ @' + m.func.num(target) + ' di-whitelist.', { mentions: [target] })
      }
    }

    if (action === 'del') {
      if (type === 'link') {
        const idx = parseInt(data, 10) - 1
        if (isNaN(idx) || idx < 0 || idx >= g.wlLinks.length) return m.reply('Contoh: .whitelist del link 1')
        const removed = g.wlLinks.splice(idx, 1)[0]
        m.db.save()
        return m.reply('✅ Link *' + removed + '* dihapus.')
      }
      if (type === 'member') {
        const target = m.func.target(m, data)
        if (!target) return m.reply('Contoh: ' + m.config.prefix + 'whitelist del member 081234567890')
        const i = g.wlMembers.indexOf(target)
        if (i < 0) return m.reply('ℹ️ @' + m.func.num(target) + ' tidak ada di whitelist.', { mentions: [target] })
        g.wlMembers.splice(i, 1)
        m.db.save()
        return m.reply('✅ @' + m.func.num(target) + ' dihapus dari whitelist.', { mentions: [target] })
      }
    }

    await m.reply('Format salah. Ketik *.whitelist list* untuk lihat.')
  },
}
