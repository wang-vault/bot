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
//
//  Input selalu NOMOR (0812xxx / +62 812-xxx / 62812xxx), bukan JID.
//  Bot yang menormalkan sendiri: 0812xxx -> 62812xxx@s.whatsapp.net.
// ============================================================
module.exports = {
  name: 'addowner',
  aliases: ['setowner', 'claimowner', 'claim', 'jadikanowner'],
  category: 'owner',
  desc: 'Tambah owner pakai nomor (Owner only). Tanpa nomor = nomor kamu sendiri.',
  use: '[nomor]   contoh: 081234567890 | +62 812-3456-7890 | 6281234567890',
  run: async (m) => {
    const P = m.config.prefix
    const hasOwner = m.config.envOwners.length > 0 || (m.db.data.owners || []).length > 0

    // Sudah ada owner -> hanya owner yang boleh menambah owner.
    if (hasOwner && !m.isOwner) return m.reply('⛔ Command khusus *Owner*.')

    const typed = (m.args || '').trim()
    let jid = m.func.target(m) // nomor di argumen -> orang yang di-tag -> pesan yang di-reply
    if (!jid && typed) {
      return m.reply(
        `❌ "${typed}" bukan nomor yang bisa dipakai.\n` +
          `Contoh: ${P}addowner 081234567890\nAtau: ${P}addowner +62 812-3456-7890`
      )
    }
    // Tanpa argumen & tanpa tag -> pakai nomor pengirim (JID persis yang dilihat bot)
    const self = !jid
    if (self) jid = m.sender
    const nomor = m.func.num(jid)

    // Bootstrap: bot belum punya owner sama sekali.
    if (!hasOwner) {
      m.db.addOwner(jid)
      return m.reply(
        `✅ *${nomor}* didaftarkan sebagai owner pertama (bootstrap).\n` +
          '⚠️ Sebaiknya isi OWNER_NUMBER di .env lalu restart bot.\n\n' +
          `Ketik ${P}id untuk cek.`
      )
    }

    const added = m.db.addOwner(jid)
    if (added) {
      const note = self ? '\n📌 (Ini nomor kamu persis yang dilihat bot, jadi pasti cocok.)' : ''
      await m.reply(`✅ *${nomor}* sekarang jadi *OWNER*.${note}\n\nKetik ${P}id untuk cek.`)
    } else {
      await m.reply(`ℹ️ *${nomor}* sudah terdaftar owner. Ketik ${P}id untuk cek.`)
    }
  },
}
