module.exports = {
  name: 'laporan',
  aliases: ['report', 'adu', 'pengaduan'],
  category: 'cs',
  desc: 'Laporkan masalah / gangguan layanan.',
  use: '<deskripsi masalah>',
  run: async (m) => {
    if (!m.args) return m.reply('Contoh: ' + m.config.prefix + 'laporan Server saya tidak bisa diakses sejak tadi.')
    const entry = {
      from: m.sender,
      name: m.pushName || '',
      text: m.args,
      time: Date.now(),
    }
    m.db.data.reports.push(entry)
    m.db.save()
    await m.reply('🚨 Laporan kamu tercatat. Tim kami akan segera menindaklanjuti. Terima kasih.')
    // Owner selalu nomor WhatsApp (@s.whatsapp.net) — LID dipetakan dulu
    const owners = m.func.ownerJids(m.db)
    for (const owner of owners) {
      try {
        await m.sock.sendMessage(owner, {
          text: `🚨 *LAPORAN BARU*\nDari: @${m.sender.split('@')[0]}\n\n${m.args}`,
          mentions: [m.sender],
        })
      } catch (_) {}
    }
  },
}
