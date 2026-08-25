module.exports = {
  name: 'feedback',
  aliases: ['saran', 'kritik'],
  category: 'cs',
  desc: 'Kirim saran & feedback untuk WangStore.',
  use: '<pesan>',
  run: async (m) => {
    if (!m.args) return m.reply('Contoh: ' + m.config.prefix + 'feedback Pelayanan bagus, tapi mohon tambah node baru.')
    const entry = {
      from: m.sender,
      name: m.pushName || '',
      text: m.args,
      time: Date.now(),
    }
    m.db.data.feedback.push(entry)
    m.db.save()
    await m.reply('✅ Terima kasih atas feedback kamu! Kami menghargainya. 💚')
    // beri tahu owner
    const owners = [...new Set([...m.config.envOwners, ...(m.db.data.owners || [])])]
    for (const owner of owners) {
      try {
        await m.sock.sendMessage(owner, {
          text: `💬 *FEEDBACK BARU*\nDari: @${m.sender.split('@')[0]}\n\n${m.args}`,
          mentions: [m.sender],
        })
      } catch (_) {}
    }
  },
}
