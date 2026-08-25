module.exports = {
  name: 'afk',
  category: 'community',
  desc: 'Set status AFK (Away From Keyboard).',
  use: '[alasan]',
  run: async (m) => {
    const reason = m.args || 'AFK'
    m.db.data.afk[m.sender] = { reason, time: Date.now() }
    m.db.save()
    await m.reply(`💤 @${m.sender.split('@')[0]} sekarang *AFK*.\nAlasan: ${reason}`, { mentions: [m.sender] })
  },
}
