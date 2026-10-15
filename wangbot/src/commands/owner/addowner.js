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
//  Input selalu NOMOR WhatsApp (0812xxx / +62 812-xxx / 62812xxx),
//  bukan JID — dan BUKAN LID. Bot menormalkan sendiri:
//  0812xxx -> 62812xxx@s.whatsapp.net.
//  Kalau pesan ini datang sebagai `@lid` (grup "sembunyikan nomor" /
//  chat pribadi baru), bot lebih dulu mencari nomor aslinya
//  (src/lib/identity.js). Bila nomornya belum diketahui, bot meminta
//  nomornya, bukan menyimpan LID sebagai owner.
// ============================================================
const Identity = require('../../lib/identity')

/** Penjelasan kenapa LID tidak bisa dipakai sebagai owner. */
function lidHelp(m, P, lid) {
  return (
    `⚠️ *Nomor WhatsApp belum bisa dibaca bot.*\n\n` +
    `Identitas yang terlihat: *LID* (\`${lid || m.lid || '-'}\`) — itu bukan nomor\n` +
    `telepon, jadi tidak bisa dipakai untuk wa.me, laporan, atau monitoring.\n` +
    `Bot menyimpan owner selalu sebagai *nomor*.\n\n` +
    `Pilih salah satu cara:\n` +
    `1. Tulis nomornya langsung: \`${P}addowner 081234567890\`\n` +
    `2. Kirim satu pesan di *grup* yang ada botnya, lalu ulangi di sini\n` +
    `   (metadata grup memuat pasangan LID → nomor).\n` +
    `3. Admin server: isi \`OWNER_NUMBER\` (atau \`OWNER_LID_MAP=…\`) di .env lalu restart bot.`
  )
}

module.exports = {
  name: 'addowner',
  aliases: ['setowner', 'claimowner', 'claim', 'jadikanowner'],
  category: 'owner',
  desc: 'Tambah owner pakai nomor (Owner only). Tanpa nomor = nomor kamu sendiri.',
  use: '[nomor]   contoh: 081234567890 | +62 812-3456-7890 | 6281234567890',
  run: async (m) => {
    const P = m.config.prefix
    const entries = m.func.ownerEntries(m.db)
    const hasOwner = entries.pn.length > 0 || entries.lids.length > 0

    // Sudah ada owner -> hanya owner yang boleh menambah owner.
    if (hasOwner && !m.isOwner) return m.reply('⛔ Command khusus *Owner*.')

    const typed = (m.args || '').trim()
    const targets = m.func.pnTargets(m) // nomor di argumen -> tag -> reply (harus NOMOR)
    if (!targets.length) {
      const asIs = m.func.target(m)
      if (typed) {
        // Bisa jadi nomornya belum ketebak, atau yang di-tag/reply ber-LID.
        const lidNote = asIs && Identity.isLid(asIs) ? `\n\n${lidHelp(m, P, asIs)}` : ''
        return m.reply(
          `❌ "${typed}" bukan nomor yang bisa dipakai.${lidNote}\n\n` +
            `Contoh: ${P}addowner 081234567890\nAtau: ${P}addowner +62 812-3456-7890`
        )
      }
      // Tanpa argumen & tanpa tag -> pakai nomor pengirim.
      const self = m.func.jidToPn(m, m.sender)
      if (!self) {
        if (Identity.isLid(m.sender) || m.lid) return m.reply(lidHelp(m, P, m.sender))
        return m.reply(`Contoh: ${P}addowner 081234567890`)
      }
      targets.push(self)
    }

    // Bootstrap: bot belum punya owner sama sekali.
    if (!hasOwner) {
      m.db.addOwner(targets[0])
      return m.reply(
        `✅ *${m.func.num(targets[0])}* didaftarkan sebagai owner pertama (bootstrap).\n` +
          '⚠️ Sebaiknya isi OWNER_NUMBER di .env lalu restart bot.\n\n' +
          `Ketik ${P}id untuk cek.`
      )
    }

    const added = []
    const already = []
    for (const jid of targets) {
      if (m.db.addOwner(jid)) added.push(m.func.num(jid))
      else already.push(m.func.num(jid))
    }
    if (added.length) {
      await m.reply(
        `✅ *${added.join(', ')}* sekarang jadi *OWNER*.\n` +
          `📌 Disimpan sebagai *nomor WhatsApp*, bukan LID.\n\nKetik ${P}id untuk cek.`
      )
      if (already.length) await m.reply(`ℹ️ Sudah terdaftar sebelumnya: ${already.join(', ')}`)
    } else {
      await m.reply(`ℹ️ *${already.join(', ')}* sudah terdaftar owner. Ketik ${P}id untuk cek.`)
    }
  },
}
