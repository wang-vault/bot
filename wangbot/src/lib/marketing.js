const config = require('../config')
const logger = require('./logger')

let _timer = null
let _running = false

function buildMessage(template, db, sock) {
  const mk = db.data.marketing
  const m = template.replace(/\{website\}/g, config.website || '-')
    .replace(/\{panel\}/g, config.panelUrl || '-')
    .replace(/\{group\}/g, config.communityGroup || '-')
    .replace(/\{admin\}/g, config.waAdmin || '-')
    .replace(/\{bot\}/g, config.botName)
  return m
}

async function sendPromo(sock, db, manual = false) {
  if (_running) return { ok: false, reason: 'sedang mengirim' }
  _running = true
  try {
    const mk = db.data.marketing
    if (mk.paused && !manual) return { ok: false, reason: 'dijeda' }
    if (!mk.templates.length) return { ok: false, reason: 'belum ada template' }
    if (!mk.groups.length) return { ok: false, reason: 'belum ada grup tujuan' }

    const tpl = mk.templates[Math.floor(Math.random() * mk.templates.length)]
    const text = buildMessage(tpl, db, sock)
    // jeda aman anti-flag WhatsApp (lebih lama dari biasanya)
    const baseDelay = 5000
    let sent = 0
    for (let i = 0; i < mk.groups.length; i++) {
      const gid = mk.groups[i]
      try {
        await sock.sendMessage(gid, { text })
        sent++
        if (i < mk.groups.length - 1) {
          const jitter = baseDelay * (0.8 + Math.random() * 0.7)
          await new Promise((r) => setTimeout(r, jitter))
        }
      } catch (e) {
        logger.error('sendPromo group', e)
      }
    }
    mk.stats.sent += sent
    if (manual) mk.stats.manual += sent
    else mk.stats.auto += sent
    mk.lastSent = Date.now()
    db.save()
    logger.promo(`${manual ? 'MANUAL' : 'AUTO'} promosi terkirim ke ${sent}/${mk.groups.length} grup`)
    return { ok: true, sent, total: mk.groups.length }
  } catch (e) {
    logger.error('sendPromo', e)
    return { ok: false, reason: e.message }
  } finally {
    _running = false
  }
}

function nextRunTime(mk) {
  // jadwal HH:MM harian
  if (mk.schedule) {
    const [h, m] = mk.schedule.split(':').map(Number)
    const now = new Date()
    const next = new Date(now)
    next.setHours(h, m, 0, 0)
    if (next <= now) next.setDate(next.getDate() + 1)
    return next
  }
  if (mk.intervalMinutes > 0) {
    return new Date(mk.lastSent + mk.intervalMinutes * 60000)
  }
  return null
}

// Satu putaran scheduler (dipanggil tiap menit; diekspor agar bisa diuji)
async function tick(sock, db) {
  const mk = db.data.marketing
  if (!mk.enabled || mk.paused) return { sent: false, reason: 'nonaktif/dijeda' }
  const now = Date.now()
  const todayKey = new Date().toISOString().slice(0, 10)
  const MIN_INTERVAL = 30 // menit minimum (anti-flag WhatsApp)
  const wanted = mk.intervalMinutes || 0
  // interval 0 = OFF. Sebelumnya Math.max(30, 0) membuat interval selalu
  // 30 menit, jadi promosi tetap jalan tiap 30 menit walau owner hanya
  // memakai schedule harian (atau sudah mematikan interval).
  const effectiveInterval = wanted > 0 ? Math.max(MIN_INTERVAL, wanted) : 0

  if (effectiveInterval > 0 && now - (mk.lastSent || 0) >= effectiveInterval * 60000) {
    const res = await sendPromo(sock, db, false)
    return { sent: true, by: 'interval', res }
  }
  // schedule harian
  if (mk.schedule) {
    const [h, m] = mk.schedule.split(':').map(Number)
    const d = new Date()
    if (d.getHours() === h && d.getMinutes() === m && mk.lastScheduleRun !== todayKey) {
      mk.lastScheduleRun = todayKey
      db.save()
      const res = await sendPromo(sock, db, false)
      return { sent: true, by: 'schedule', res }
    }
  }
  return { sent: false, reason: 'belum waktunya' }
}

const Marketing = {
  start(sock, db) {
    if (_timer) clearInterval(_timer)
    logger.info('Marketing scheduler aktif (cek tiap 1 menit)')
    _timer = setInterval(() => tick(sock, db), 60 * 1000)
  },
  tick,
  stop() {
    if (_timer) clearInterval(_timer)
    _timer = null
  },
  send(sock, db, manual = true) {
    return sendPromo(sock, db, manual)
  },
  nextRun(mk) {
    return nextRunTime(mk)
  },
}

module.exports = Marketing
