const games = new Map()

module.exports = {
  name: 'tebakangka',
  aliases: ['guess', 'tebaknomor'],
  category: 'games',
  desc: 'Game tebak angka 1-100.',
  use: '<angka> | start | stop',
  cooldown: 1,
  run: async (m) => {
    const arg = (m.args || '').toLowerCase()
    if (arg === 'stop' || arg === 'reset') {
      games.delete(m.sender)
      return m.reply('🛑 Game tebak angka dihentikan.')
    }
    if (!m.args) {
      games.set(m.sender, { num: 1 + Math.floor(Math.random() * 100), attempts: 0 })
      return m.reply('🎮 *TEBAK ANGKA*\nAku sudah pilih angka 1-100.\nTebak dengan: ' + m.config.prefix + 'tebakangka <angka>')
    }
    let g = games.get(m.sender)
    if (!g) {
      g = { num: 1 + Math.floor(Math.random() * 100), attempts: 0 }
      games.set(m.sender, g)
    }
    const guess = parseInt(m.args, 10)
    if (isNaN(guess)) return m.reply('Masukkan angka yang benar.')
    g.attempts++
    if (guess === g.num) {
      await m.reply(`🎉 *BENAR!*\nAngkanya *${g.num}*.\nBerhasil dalam ${g.attempts} percobaan.`)
      games.delete(m.sender)
    } else if (guess < g.num) {
      await m.reply('⬆️ Terlalu *kecil*! Coba lagi.')
    } else {
      await m.reply('⬇️ Terlalu *besar*! Coba lagi.')
    }
  },
}
