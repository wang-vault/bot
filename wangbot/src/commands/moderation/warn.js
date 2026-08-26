const { addWarning, resetWarning } = require('../../lib/moderation')

module.exports = {
  name: 'warn',
  aliases: ['peringatan'],
  category: 'moderation',
  isGroup: true,
  isAdmin: true,
  desc: 'Beri peringatan ke member (Admin). Reply / tag.',
  use: '[alasan]',
  run: async (m) => {
    let target = m.quoted ? m.quoted.sender : m.mentionedJid[0]
    if (!target) return m.reply('Reply / tag member yang ingin di-warn.')
    if (m.func.isOwner(target, m.db) || (await m.func.isAdmin(m.sock, m.chat, target))) {
      return m.reply('⚠️ Tidak bisa warn admin/owner.')
    }
    const g = m.db.getGroup(m.chat)
    const reason = m.args.replace(/@\d+/g, '').trim() || 'Pelanggaran'
    const count = addWarning(m.db, m.chat, target)
    const limit = g.warnLimit || 3
    let text = `⚠️ *WARN ${count}/${limit}*\n@${target.split('@')[0]}\nAlasan: ${reason}`
    if (count >= limit && g.autokick && m.isBotAdmin) {
      text += '\n\n🚪 Dikeluarkan karena mencapai batas peringatan.'
      await m.reply(text, { mentions: [target] })
      try {
        await m.sock.groupParticipantsUpdate(m.chat, [target], 'remove')
      } catch (e) {
        await m.reply('❌ Gagal kick: ' + e.message)
      }
      resetWarning(m.db, m.chat, target)
      return
    }
    await m.reply(text, { mentions: [target] })
  },
}
