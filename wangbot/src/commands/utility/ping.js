module.exports = {
  name: 'ping',
  aliases: ['speed'],
  category: 'utility',
  desc: 'Cek respon / kecepatan bot.',
  run: async (m) => {
    const start = Date.now()
    await m.reply('⏱️ Menghitung...')
    const ms = Date.now() - start
    const speed = ms < 300 ? '⚡ Lancar' : ms < 800 ? '🙂 Normal' : '🐢 Lambat'
    await m.reply(`*PONG!* 🏓\nRespon: *${ms} ms*\nStatus: ${speed}`)
  },
}
