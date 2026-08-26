module.exports = {
  name: 'coinflip',
  aliases: ['coin', 'lemparcoin'],
  category: 'games',
  desc: 'Lempar koin ( kepala / ekor ).',
  use: '<kepala|ekor>',
  run: async (m) => {
    const p = (m.args || '').toLowerCase()
    const valid = ['kepala', 'ekor', 'head', 'tail']
    if (!valid.includes(p)) {
      return m.reply('Pilih: *kepala* atau *ekor*.\nContoh: ' + m.config.prefix + 'coinflip kepala')
    }
    const side = Math.random() < 0.5 ? 'kepala' : 'ekor'
    const pick = p === 'head' ? 'kepala' : p === 'tail' ? 'ekor' : p
    const win = side === pick
    await m.reply(
      `🪙 *COIN FLIP*\n\n` +
        `Kamu pilih : ${pick}\n` +
        `Hasil      : *${side}*\n\n` +
        `${win ? '🎉 Kamu menang!' : '😢 Kamu kalah.'}`
    )
  },
}
