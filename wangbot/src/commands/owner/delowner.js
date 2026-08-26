const { toJid } = require('../../config')

module.exports = {
  name: 'delowner',
  aliases: ['removeowner'],
  category: 'owner',
  isOwner: true,
  desc: 'Hapus nomor dari daftar owner.',
  use: '<nomor / reply / tag>',
  run: async (m) => {
    let input = m.args
    if (!input && m.quoted) input = m.quoted.sender
    if (!input && m.mentionedJid[0]) input = m.mentionedJid[0]
    const jid = m.mentionedJid[0] && !m.args ? m.mentionedJid[0] : toJid(input)
    if (!jid) return m.reply('Contoh: ' + m.config.prefix + 'delowner 0831xxxx atau 62831xxxx')
    if (m.config.envOwners.includes(jid)) {
      return m.reply('ℹ️ Owner dari .env tidak bisa dihapus lewat command. Edit file .env.')
    }
    const removed = m.db.delOwner(jid)
    if (removed) await m.reply('✅ ' + jid.split('@')[0] + ' dihapus dari owner.')
    else await m.reply('ℹ️ Nomor tersebut bukan owner tambahan.')
  },
}
