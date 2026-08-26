module.exports = {
  name: 'listwarn',
  aliases: ['warns', 'cekwarn'],
  category: 'moderation',
  isGroup: true,
  isAdmin: true,
  desc: 'Lihat daftar peringatan di grup (Admin).',
  run: async (m) => {
    const prefix = m.chat + ':'
    const entries = Object.entries(m.db.data.warnings).filter(([k]) => k.startsWith(prefix))
    if (!entries.length) return m.reply('✅ Tidak ada peringatan di grup ini.')
    let t = '⚠️ *DAFTAR PERINGATAN*\n\n'
    entries.forEach(([k, v]) => {
      t += `• @${k.split(':')[1].split('@')[0]} — ${v.count}\n`
    })
    await m.reply(t.trim(), {
      mentions: entries.map(([k]) => k.split(':')[1]).filter(Boolean),
    })
  },
}
