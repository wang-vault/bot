module.exports = {
  name: 'runtime',
  aliases: ['uptime'],
  category: 'utility',
  desc: 'Cek lama bot berjalan.',
  run: async (m) => {
    const ms = process.uptime() * 1000
    const started = new Date(Date.now() - ms)
    const text =
      `⏱️ *BOT RUNTIME*\n\n` +
      `Duration : ${m.func.uptime(ms)}\n` +
      `Start    : ${started.toLocaleString('id-ID')}\n` +
      `Memory   : ${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB\n` +
      `Node.js  : ${process.version}\n` +
      `Platform : ${process.platform}`
    await m.reply(text)
  },
}
