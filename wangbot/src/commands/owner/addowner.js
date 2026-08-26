// ============================================================
//  .addowner  —  daftar owner tambahan
//
//  PENTING: proteksi owner TIDAK boleh dimatikan. Versi lama
//  file ini tidak punya proteksi sama sekali, sehingga siapa
//  pun bisa mengetik .addowner -> jadi owner -> .eval/.exec
//  (eksekusi kode/shell di server bot).
//
//  Proteksi dilakukan di dalam run() (bukan lewat flag isOwner)
//  supaya tetap ada jalan "bootstrap": kalau bot BELUM punya
//  owner sama sekali (OWNER_NUMBER kosong & db.owners kosong),
//  klaim pertama diizinkan agar bot tetap bisa di-setup.
// ============================================================
const { toJid } = require('../../config')

function jidFromInput(m) {
  if (m.mentionedJid && m.mentionedJid[0]) return m.mentionedJid[0]
  if (m.quoted && m.quoted.sender) return m.quoted.sender
  if (m.args && m.args.trim()) {
    const n = m.args.replace(/[^0-9]/g, '')
    if (!n) return ''
    return toJid(n)
  }
  return m.sender // tanpa argumen -> JID pengirim apa adanya
}

module.exports = {
  name: 'addowner',
  aliases: ['setowner', 'claimowner', 'claim', 'jadikanowner'],
  category: 'owner',
  desc: 'Tambah owner (Owner only). Tanpa nomor = pakai JID kamu sendiri.',
  use: '[nomor]   <- kosongkan untuk pakai JID sendiri',
  run: async (m) => {
    const hasOwner = m.config.envOwners.length > 0 || (m.db.data.owners || []).length > 0

    // Sudah ada owner -> hanya owner yang boleh menambah owner.
    if (hasOwner && !m.isOwner) return m.reply('⛔ Command khusus *Owner*.')

    const jid = jidFromInput(m)
    if (!jid) return m.reply('❌ Gagal ambil JID. Coba: ' + m.config.prefix + 'addowner 082189822272')

    // Bootstrap: bot belum punya owner sama sekali.
    if (!hasOwner) {
      m.db.addOwner(jid)
      return m.reply(
        '✅ ' + jid + ' didaftarkan sebagai owner pertama (bootstrap).\n' +
          '⚠️ Sebaiknya isi OWNER_NUMBER di .env lalu restart bot.\n\nKetik .id untuk cek.'
      )
    }

    const added = m.db.addOwner(jid)
    const note = jid === m.sender ? '\n📌 (Ini JID kamu persis yang dilihat bot, jadi pasti cocok.)' : ''
    if (added) {
      await m.reply('✅ ' + jid + ' sekarang jadi *OWNER*.' + note + '\n\nKetik .id untuk cek.')
    } else {
      await m.reply('ℹ️ ' + jid + ' sudah terdaftar owner. Ketik .id untuk cek.')
    }
  },
}
