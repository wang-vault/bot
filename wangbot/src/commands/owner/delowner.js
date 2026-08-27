// Hapus owner tambahan. Input-nya NOMOR, bukan JID — sama seperti .addowner.
module.exports = {
  name: 'delowner',
  aliases: ['removeowner', 'hapusowner'],
  category: 'owner',
  isOwner: true,
  desc: 'Hapus nomor dari daftar owner.',
  use: '<nomor>   contoh: 081234567890  (boleh juga reply / tag)',
  run: async (m) => {
    const P = m.config.prefix
    const jid = m.func.target(m)
    if (!jid) {
      return m.reply(
        `Contoh: ${P}delowner 081234567890\n` +
          `Atau: ${P}delowner +62 812-3456-7890  (boleh juga reply / tag orangnya)`
      )
    }
    const nomor = m.func.num(jid)
    if (m.config.envOwners.includes(jid)) {
      return m.reply(`ℹ️ *${nomor}* adalah owner dari .env, tidak bisa dihapus lewat command. Edit file .env.`)
    }
    const removed = m.db.delOwner(jid)
    if (removed) await m.reply(`✅ *${nomor}* dihapus dari daftar owner.`)
    else await m.reply(`ℹ️ *${nomor}* bukan owner tambahan. Ketik ${P}id untuk lihat daftarnya.`)
  },
}
