module.exports = {
  name: 'promoset',
  aliases: ['promosetting', 'setpromo'],
  category: 'marketing',
  isOwner: true,
  desc: 'Atur promosi otomatis.',
  use: 'enable on|off | interval <menit> | schedule HH:MM | schedule off | pause | resume | status',
  run: async (m) => {
    const mk = m.db.data.marketing
    const [a, b] = m.args.toLowerCase().split(/\s+/)

    if (!a || a === 'status') {
      const next = mk.enabled && !mk.paused ? nextRunStr(mk) : '-'
      let t = '⚙️ *STATUS PROMOSI*\n\n'
      t += `Enabled  : ${mk.enabled ? '✅ ON' : '❌ OFF'}\n`
      t += `Paused   : ${mk.paused ? '⏸️ YA' : '▶️ TIDAK'}\n`
      t += `Interval : ${mk.intervalMinutes ? mk.intervalMinutes + ' menit' : 'off'}\n`
      t += `Schedule : ${mk.schedule || 'off'}\n`
      t += `Templates: ${mk.templates.length}\n`
      t += `Grup     : ${mk.groups.length}\n`
      t += `Terakhir : ${mk.lastSent ? new Date(mk.lastSent).toLocaleString('id-ID') : '-'}\n`
      t += `Berikutnya: ${next}`
      return m.reply(t)
    }

    if (a === 'enable') {
      if (b !== 'on' && b !== 'off') return m.reply('Contoh: .promoset enable on')
      mk.enabled = b === 'on'
      m.db.save()
      return m.reply('✅ Promosi ' + (mk.enabled ? 'diaktifkan' : 'dinonaktifkan') + '.')
    }
    if (a === 'pause') {
      mk.paused = true
      m.db.save()
      return m.reply('⏸️ Promosi otomatis dijeda.')
    }
    if (a === 'resume') {
      mk.paused = false
      m.db.save()
      return m.reply('▶️ Promosi otomatis dilanjutkan.')
    }
    if (a === 'interval') {
      const min = parseInt(b, 10)
      if (isNaN(min) || min < 0) return m.reply('Contoh: .promoset interval 60 (0 = off)')
      mk.intervalMinutes = min
      m.db.save()
      return m.reply('✅ Interval: ' + (min ? min + ' menit' : 'OFF'))
    }
    if (a === 'schedule') {
      if (b === 'off') {
        mk.schedule = ''
        m.db.save()
        return m.reply('✅ Schedule promosi dimatikan.')
      }
      if (!/^\d{1,2}:\d{2}$/.test(b)) return m.reply('Contoh: .promoset schedule 09:00')
      mk.schedule = b
      m.db.save()
      return m.reply('✅ Schedule promosi: ' + b + ' setiap hari')
    }

    await m.reply('Format salah. .promoset status|enable|pause|resume|interval|schedule')
  },
}

function nextRunStr(mk) {
  if (mk.schedule) return 'hari ini/jam ' + mk.schedule
  if (mk.intervalMinutes > 0) {
    const t = new Date((mk.lastSent || Date.now()) + mk.intervalMinutes * 60000)
    return t.toLocaleString('id-ID')
  }
  return '-'
}
