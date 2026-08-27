const config = require('../../config')

module.exports = {
  name: 'id',
  aliases: ['me', 'myid', 'whoami'],
  category: 'utility',
  desc: 'Cek ID WhatsApp kamu & daftar owner yang dibaca bot (debug).',
  run: async (m) => {
    const envOwners = config.envOwners
    const dbOwners = (m.db.data.owners || []).filter((o) => !envOwners.includes(o))
    const allOwners = [...envOwners, ...dbOwners]

    const nomorKamu = m.func.num(m.sender)
    let t = `🪪 *DATA KAMU DI BOT*\n\n`
    t += `Nomor kamu     : ${nomorKamu}\n`
    // JID mentah hanya ditampilkan kalau bukan JID nomor (mis. @lid) — untuk debugging
    if (!String(m.sender).endsWith('@s.whatsapp.net')) t += `JID kamu       : ${m.sender}\n`
    t += `Nama           : ${m.pushName || '-'}\n`
    t += `Lokasi         : ${m.isGroup ? 'Grup ' + m.chat : 'Private chat'}\n`
    t += `Owner          : ${m.isOwner ? '✅ YA' : '❌ BUKAN'}\n\n`
    t += `📋 *Daftar owner saat ini di bot:*\n`
    if (!allOwners.length) {
      t += `(KOSONG — OWNER_NUMBER di .env belum terbaca / kosong!)\n`
    } else {
      allOwners.forEach((o, i) => {
        const match = o === m.sender ? '  ← NOMOR KAMU' : ''
        t += `${i + 1}. ${m.func.num(o)}  (wa.me/${m.func.num(o)})${match}\n`
      })
    }
    t += `\n`
    if (m.isOwner) {
      t += `✅ Semua baik. Kamu owner.`
    } else {
      t += `❌ Kamu BELUM diakui owner.\n`
      t += `Cek:\n`
      t += `• Apakah nomor kamu (${nomorKamu}) ada di daftar di atas?\n`
      t += `• Jika KOSONG / salah -> .env belum terbaca. Lakukan STOP lalu START server (bukan restart).\n`
      t += `• Format .env: OWNER_NUMBER=${nomorKamu}\n`
      t += `• Atau tambahkan lewat chat: ${m.config.prefix}addowner ${nomorKamu}`
    }
    await m.reply(t)
  },
}
