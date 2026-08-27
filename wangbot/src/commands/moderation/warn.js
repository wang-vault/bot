const { addWarning, resetWarning } = require('../../lib/moderation')

module.exports = {
  name: 'warn',
  aliases: ['peringatan'],
  category: 'moderation',
  isGroup: true,
  isAdmin: true,
  desc: 'Beri peringatan ke member (Admin). Nomor / reply / tag.',
  use: '<nomor> [alasan]   contoh: 081234567890 spam link',
  run: async (m) => {
    // Target = nomor pertama di argumen; sisanya dianggap alasan.
    let target = m.func.target(m, m.args, { firstOnly: true })
    if (!target) return m.reply('Contoh: ' + m.config.prefix + 'warn 081234567890 spam link\nAtau reply / tag member yang ingin di-warn.')
    if (m.func.isOwner(target, m.db) || (await m.func.isAdmin(m.sock, m.chat, target))) {
      return m.reply('⚠️ Tidak bisa warn admin/owner.')
    }
    const g = m.db.getGroup(m.chat)
    let reason = (m.args || '').replace(/@\d+/g, '').trim()
    // buang nomor target dari awal teks supaya tidak ikut terbaca sebagai alasan
    const first = (reason.split(/\s+/)[0] || '')
    if (first && m.func.jidFromInput(first.replace(/^@/, '')) === target) {
      reason = reason.slice(first.length).trim()
    }
    reason = reason || 'Pelanggaran'
    const count = addWarning(m.db, m.chat, target)
    const limit = g.warnLimit || 3
    let text = `⚠️ *WARN ${count}/${limit}*\n@${m.func.num(target)}\nAlasan: ${reason}`
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
