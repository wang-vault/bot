const Assistant = require('../../lib/assistant')

// Boleh dipakai di private chat (khusus owner) DAN di grup yang sudah
// didaftarkan owner lewat `.groupaccess` — lengkap dengan batas role per grup.
// Karena itu command ini tidak memakai isOwner/isPrivate: keputusan akses dibuat
// di Assistant.respond() supaya jalur auto-chat dan jalur prefix memakai pagar
// yang sama.
module.exports = {
  name: 'asisten',
  aliases: ['assistant', 'agent', 'bantuaku'],
  category: 'assistant',
  cooldown: 2,
  desc: 'Asisten pribadi: bicara, merencanakan, dan menjalankan command yang diizinkan (grup: lihat .groupaccess).',
  use: '<instruksi bahasa natural>',
  run: async (m) => Assistant.respond(m, m.args || (m.quoted && m.quoted.body) || ''),
}
