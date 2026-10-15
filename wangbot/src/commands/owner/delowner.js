// Hapus owner tambahan. Input-nya NOMOR WhatsApp, bukan JID — sama seperti
// .addowner. LID hanya dipakai sebagai kunci pencarian nomor (src/lib/identity.js).
const Identity = require('../../lib/identity')

module.exports = {
  name: 'delowner',
  aliases: ['removeowner', 'hapusowner'],
  category: 'owner',
  isOwner: true,
  desc: 'Hapus nomor dari daftar owner.',
  use: '<nomor>   contoh: 081234567890  (boleh juga reply / tag)',
  run: async (m) => {
    const P = m.config.prefix
    const jid = m.func.pnTarget(m)
    if (!jid) {
      const asIs = m.func.target(m)
      const lidNote = asIs && Identity.isLid(asIs)
        ? `\n\n⚠️ Yang di-tag/balas itu identitas *LID* (\`${asIs}\`) — bukan nomor.\n` +
          `Tulis nomornya: \`${P}delowner 081234567890\`.`
        : ''
      return m.reply(
        `Contoh: ${P}delowner 081234567890\n` +
          `Atau: ${P}delowner +62 812-3456-7890  (boleh juga reply / tag orangnya)${lidNote}`
      )
    }
    const nomor = m.func.num(jid)
    if (m.config.envOwners.includes(jid)) {
      return m.reply(`ℹ️ *${nomor}* adalah owner dari .env, tidak bisa dihapus lewat command. Edit file .env.`)
    }
    // Owner yang hanya dikenal sebagai LID (mis. OWNER_LID) juga bisa dilepas,
    // tapi hanya lewat .env — di sini kita urus daftar berbasis nomor.
    const removed = m.db.delOwner(jid)
    if (removed) await m.reply(`✅ *${nomor}* dihapus dari daftar owner.`)
    else await m.reply(`ℹ️ *${nomor}* bukan owner tambahan. Ketik ${P}id untuk lihat daftarnya.`)
  },
}
