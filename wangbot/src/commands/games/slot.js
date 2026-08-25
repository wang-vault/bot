const { pickRandom } = require('../../lib/func')

const REEL = ['🍋', '🍊', '🍇', '🍒', '🔔', '⭐', '7️⃣']

module.exports = {
  name: 'slot',
  aliases: ['slotgame', 'jackpot'],
  category: 'games',
  cooldown: 2,
  desc: 'Game slot sederhana.',
  run: async (m) => {
    const a = pickRandom(REEL)
    const b = pickRandom(REEL)
    const c = pickRandom(REEL)
    let msg = `🎰 *SLOT MACHINE*\n\n    [ ${a} | ${b} | ${c} ]\n\n`
    if (a === b && b === c) msg += '🎉 *JACKPOT!* Kamu menang besar!'
    else if (a === b || b === c || a === c) msg += '✨ Lumayan! Dua sama, dapat hadiah kecil.'
    else msg += '💔 Belum beruntung. Coba lagi!'
    await m.reply(msg)
  },
}
