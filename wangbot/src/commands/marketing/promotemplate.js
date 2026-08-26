module.exports = {
  name: 'promotemplate',
  aliases: ['ptemplate', 'templatespromo'],
  category: 'marketing',
  isOwner: true,
  desc: 'Kelola template promosi. Mendukung multi-line & reply pesan.',
  use: 'add <teks> | add (reply pesan) | del <index> | list',
  run: async (m) => {
    const mk = m.db.data.marketing
    const trimmed = (m.args || '').trim()
    // pisahkan action saja; SISANYA dipertahankan apa adanya (termasuk newline)
    const sp = trimmed.search(/\s/)
    const action = (sp >= 0 ? trimmed.slice(0, sp) : trimmed).toLowerCase()
    let data = sp >= 0 ? trimmed.slice(sp + 1).trim() : ''

    if (action === 'list' || !m.args) {
      if (!mk.templates.length) return m.reply('ℹ️ Belum ada template.')
      let t = '📝 *TEMPLATE PROMOSI*\n\n'
      mk.templates.forEach((tp, i) => {
        const preview = tp.replace(/\n/g, ' ').slice(0, 70)
        t += `${i + 1}. ${preview}${tp.length > 70 ? '...' : ''}\n\n`
      })
      return m.reply(t.trim())
    }

    if (action === 'add') {
      // Kalau teks setelah 'add' kosong -> pakai isi pesan yang di-reply
      if (!data && m.quoted && m.quoted.body) data = m.quoted.body.trim()
      if (!data) {
        return m.reply(
          'Cara tambah template:\n\n' +
            '1) Ketik langsung (multi-line pakai Shift+Enter):\n' +
            m.config.prefix + 'promotemplate add <teks>\n\n' +
            '2) ATAU reply pesan template, lalu ketik:\n' +
            m.config.prefix + 'promotemplate add'
        )
      }
      mk.templates.push(data)
      m.db.save()
      return m.reply(
        '✅ Template ditambahkan (' + data.length + ' karakter).\n' +
          'ℹ️ Variabel opsional: {website} {panel} {group} {admin} {bot}\n' +
          'Total template sekarang: ' + mk.templates.length
      )
    }

    if (action === 'del') {
      const idx = parseInt(data, 10) - 1
      if (isNaN(idx) || idx < 0 || idx >= mk.templates.length) {
        return m.reply('Contoh: ' + m.config.prefix + 'promotemplate del 1')
      }
      mk.templates.splice(idx, 1)
      m.db.save()
      return m.reply('✅ Template dihapus.')
    }

    await m.reply('Format salah. .promotemplate add|del|list')
  },
}
