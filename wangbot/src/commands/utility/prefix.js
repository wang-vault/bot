module.exports = {
  name: 'prefix',
  aliases: ['prefixinfo', 'cekganti'],
  category: 'utility',
  desc: 'Menampilkan prefix aktif & cara ganti.',
  run: async (m) => {
    const text =
      `⌨️ *PREFIX BOT*\n\n` +
      `Prefix saat ini: *${m.config.prefix}*\n\n` +
      `Contoh penggunaan:\n` +
      `${m.config.prefix}menu\n${m.config.prefix}ping\n\n` +
      `Ganti prefix lewat owner: *${m.config.prefix}setprefix <simbol>*`
    await m.reply(text)
  },
}
