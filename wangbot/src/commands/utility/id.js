const Identity = require('../../lib/identity')

module.exports = {
  name: 'id',
  aliases: ['me', 'myid', 'whoami'],
  category: 'utility',
  desc: 'Cek nomor WhatsApp kamu & daftar owner yang dibaca bot (debug).',
  run: async (m) => {
    const entries = m.func.ownerEntries(m.db)
    // Identitas yang ditampilkan selalu NOMOR. Entri LID hanya ditandai supaya
    // owner tahu ada yang belum punya nomor (lihat src/lib/identity.js).
    const nomorKamu = Identity.num(m.sender)
    const lidKamu = m.lid || (Identity.isLid(m.sender) ? m.sender : '')

    let t = `🪪 *DATA KAMU DI BOT*\n\n`
    t += `Nomor kamu     : ${nomorKamu}\n`
    if (lidKamu) {
      t += `LID kamu       : ${lidKamu}\n`
      t += `Status nomor   : ${
        Identity.isPn(m.sender) ? '✅ sudah terpetakan ke nomor di atas' : '⚠️ belum diketahui (bot belum pernah melihat pasangan LID → nomor)'
      }\n`
    }
    t += `Nama           : ${m.pushName || '-'}\n`
    t += `Lokasi         : ${m.isGroup ? 'Grup ' + m.chat : 'Private chat'}\n`
    t += `Owner          : ${m.isOwner ? '✅ YA' : '❌ BUKAN'}\n\n`
    t += `📋 *Daftar owner saat ini di bot (nomor):*\n`
    if (!entries.pn.length) {
      t += `(KOSONG — OWNER_NUMBER di .env belum terbaca / kosong!)\n`
    } else {
      entries.pn.forEach((o, i) => {
        const match = o === m.sender ? '  ← NOMOR KAMU' : ''
        t += `${i + 1}. ${m.func.num(o)}  (wa.me/${m.func.num(o)})${match}\n`
      })
    }
    if (entries.unresolved.length) {
      t += `\n⚠️ *Owner yang masih berbentuk LID (nomornya belum diketahui):*\n`
      entries.unresolved.forEach((l) => {
        t += `• ${l}\n`
      })
      t += `Bot hanya menyimpan owner sebagai NOMOR. Perbaiki dengan:\n`
      t += `• ${m.config.prefix}addowner <nomor> (nomor asli orang itu), atau\n`
      t += `• isi OWNER_LID_MAP=${entries.unresolved[0]}:62xxxxxxxxxx di .env lalu restart.\n`
    }
    t += `\n`
    if (m.isOwner) {
      t += `✅ Semua baik. Kamu owner.`
    } else {
      t += `❌ Kamu BELUM diakui owner.\n`
      t += `Cek:\n`
      t += `• Apakah nomor kamu (${nomorKamu}) ada di daftar di atas?\n`
      if (!Identity.isPn(m.sender)) {
        t += `• Pesanmu datang sebagai LID dan nomornya belum diketahui bot.\n`
        t += `  Kirim satu pesan di grup yang ada botnya, lalu cek ${m.config.prefix}id lagi.\n`
      }
      t += `• Jika daftar KOSONG / salah -> .env belum terbaca. Lakukan STOP lalu START server (bukan restart).\n`
      t += `• Format .env: OWNER_NUMBER=${nomorKamu}\n`
      t += `• Atau tambahkan lewat chat: ${m.config.prefix}addowner ${nomorKamu}`
    }
    await m.reply(t)
  },
}
