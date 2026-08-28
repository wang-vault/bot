const { CATEGORY_META } = require('../index')
const pkg = require('../../../package.json')

module.exports = {
  name: 'menu',
  aliases: ['help', 'menuall', '?'],
  category: 'utility',
  desc: 'Menampilkan daftar semua command WangBot.',
  run: async (m) => {
    const { loader, config, db } = m
    const groups = {}
    for (const c of loader.commands) {
      if (!groups[c.category]) groups[c.category] = []
      groups[c.category].push(c)
    }

    const totalGroups = Object.keys(db.data.groups).length
    const totalUsers = Object.keys(db.data.users).length
    const uptime = m.func.uptime(process.uptime() * 1000)

    let text =
      `╭━━❲ *${config.botName}* ❳━━╮\n` +
      `┃ 🤖 ${config.botName} v${pkg.version}\n` +
      `┃ ⏱️ Uptime: ${uptime}\n` +
      `┃ 👥 ${totalUsers} user | ${totalGroups} grup\n` +
      `┃ ⌨️ Prefix: *${config.prefix}*\n` +
      `┃ 🧩 ${loader.commands.length} command\n` +
      `╰━━━━━━━━━━━━━━━━━━╯\n\n`

    const order = [
      'utility', 'info', 'community', 'moderation', 'admin', 'media',
      'viewonce', 'monitoring', 'mc', 'marketing', 'broadcast', 'cs', 'assistant', 'ai', 'stats',
      'games', 'owner',
    ]

    for (const cat of order) {
      if (!groups[cat]) continue
      const meta = CATEGORY_META[cat] || { title: cat, emoji: '📁' }
      text += `\n${meta.emoji} *${meta.title.toUpperCase()}*\n`
      for (const c of groups[cat]) {
        const tag =
          (c.isOwner ? '👑' : '') + (c.isAdmin ? '👮' : '') + (c.isGroup ? '👥' : '')
        text += `  ${config.prefix}${c.name}${tag ? ' ' + tag : ''} — ${c.desc || ''}\n`
      }
    }

    text += `\n━━━━━━━━━━━━━━━━━━\n`
    text += `Ketik *${config.prefix}help <command>* untuk detail.\n`
    text += `👥 = grup | 👮 = admin | 👑 = owner\n`

    await m.reply(text.trim())
  },
}
