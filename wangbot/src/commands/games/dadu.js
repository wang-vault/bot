const { pickRandom } = require('../../lib/func')

module.exports = {
  name: 'dadu',
  aliases: ['dice', 'roll'],
  category: 'games',
  desc: 'Lempar dadu acak.',
  run: async (m) => {
    const n = Math.floor(Math.random() * 6) + 1
    const emoji = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'][n - 1]
    await m.reply(`🎲 *DADU*\n\nKamu dapet: *${n}* ${emoji}`)
  },
}
