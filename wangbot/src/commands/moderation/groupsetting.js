const FEATURES = [
  ['welcome', '👋 Auto Welcome'],
  ['goodbye', '👋 Auto Goodbye'],
  ['autorules', '📜 Auto Rules (saat join)'],
  ['autowebsite', '🌐 Auto Website (saat join)'],
  ['autogrouplink', '👥 Auto Link Grup (saat join)'],
  ['autofaq', '💬 Auto Reply FAQ'],
  ['antilink', '🔗 Anti Link'],
  ['antipromo', '📢 Anti Promo'],
  ['antispam', '♻️ Anti Spam'],
  ['antiflood', '🌊 Anti Flood'],
  ['antivirtex', '☣️ Anti Virtex'],
  ['antitagall', '🔇 Anti Tag All'],
  ['autokick', '🚪 Auto Kick (saat warn penuh)'],
  ['mute', '🔇 Mute (matikan command)'],
]

module.exports = {
  name: 'groupsetting',
  aliases: ['setting', 'gs', 'grupsetting'],
  category: 'moderation',
  isGroup: true,
  isAdmin: true,
  desc: 'Atur fitur grup ON/OFF per grup.',
  use: '<fitur> <on/off>',
  run: async (m) => {
    const g = m.db.getGroup(m.chat)
    const validKeys = FEATURES.map((f) => f[0])

    if (!m.args) {
      let t = '⚙️ *PENGATURAN GRUP*\n'
      t += `Nama: ${m.groupName || m.chat}\n\n`
      for (const [k, label] of FEATURES) {
        const on = g[k]
        t += `${on ? '✅' : '❌'} ${label} — *${on ? 'ON' : 'OFF'}*\n`
      }
      t += `\nUbah: *${m.config.prefix}groupsetting <fitur> on/off*\nContoh: *${m.config.prefix}groupsetting antilink on*`
      return m.reply(t)
    }

    const parts = m.args.toLowerCase().split(/\s+/)
    const key = parts[0]
    const val = parts[1]

    if (key === 'list') {
      return m.reply('Fitur: ' + validKeys.join(', '))
    }
    if (!validKeys.includes(key)) {
      return m.reply('❌ Fitur tidak valid. Ketik *' + m.config.prefix + 'groupsetting list*')
    }
    if (val !== 'on' && val !== 'off') {
      return m.reply('Contoh: *' + m.config.prefix + 'groupsetting ' + key + ' on*')
    }
    g[key] = val === 'on'
    m.db.save()
    const label = FEATURES.find((f) => f[0] === key)[1]
    await m.reply(`✅ *${label}* sekarang *${val.toUpperCase()}*.`)
  },
}
