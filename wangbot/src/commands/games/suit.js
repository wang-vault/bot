const { pickRandom } = require('../../lib/func')

const ITEMS = ['batu', 'kertas', 'gunting']
const EMOJI = { batu: '✊', kertas: '✋', gunting: '✌️' }

function result(p, b) {
  if (p === b) return 'SERI'
  if (
    (p === 'batu' && b === 'gunting') ||
    (p === 'gunting' && b === 'kertas') ||
    (p === 'kertas' && b === 'batu')
  )
    return 'MENANG'
  return 'KALAH'
}

module.exports = {
  name: 'suit',
  aliases: ['suten', 'rockpaperscissors'],
  category: 'games',
  desc: 'Game suit (batu/kertas/gunting).',
  use: '<batu|kertas|gunting>',
  run: async (m) => {
    const p = (m.args || '').toLowerCase()
    if (!ITEMS.includes(p)) {
      return m.reply('Pilih: *batu*, *kertas*, atau *gunting*.\nContoh: ' + m.config.prefix + 'suit batu')
    }
    const b = pickRandom(ITEMS)
    const r = result(p, b)
    const text =
      `🎮 *SUIT*\n\n` +
      `Kamu    : ${EMOJI[p]} ${p}\n` +
      `Bot     : ${EMOJI[b]} ${b}\n\n` +
      `Hasil   : *${r === 'MENANG' ? '🎉 Kamu MENANG!' : r === 'KALAH' ? '😢 Kamu KALAH!' : '🤝 SERI!'}*`
    await m.reply(text)
  },
}
