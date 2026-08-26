const Mc = require('../../lib/mc')
const MC = require('../../lib/minecraft')

module.exports = {
  name: 'mcplayers',
  aliases: ['mcplayer', 'mconline', 'siapamain'],
  category: 'mc',
  desc: 'Daftar player yang sedang online di server Minecraft.',
  use: '[nama|identifier server]',
  cooldown: 5,
  run: async (m) => {
    const r = Mc.resolveServer(m.db, m.sender, m.isOwner, m.args)
    if (r.error) return m.reply('❌ ' + r.error)
    const srv = r.server

    const addr = Mc.address(srv)
    if (!addr) return m.reply('⚠️ Host server belum diset. Minta admin mengisi alamat server.')

    const p = await MC.ping(addr.host, addr.port)
    if (!p.online) return m.reply(`🔴 *${srv.name}* tidak merespons.\n${p.error || ''}`)

    let t = `👥 *PLAYER ONLINE — ${srv.name}*\n`
    t += `${p.players.online}/${p.players.max} player\n\n`
    const list = MC.playerList(p, 25)
    t += list || 'ℹ️ Server tidak mengirim daftar nama (banyak plugin menyembunyikannya).\nJumlah player di atas tetap akurat.'
    await m.reply(t.trim())
  },
}
