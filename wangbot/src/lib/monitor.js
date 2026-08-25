const config = require('../config')
const logger = require('./logger')
const Panel = require('./panel')

// Menentukan target notifikasi alert
function notifyTarget(db) {
  if (config.monitorNotify && config.monitorNotify.endsWith('@s.whatsapp.net')) return config.monitorNotify
  const owners = [...config.envOwners, ...(db.data.owners || [])]
  return owners[0] || null
}

async function sendAlert(db, sock, text) {
  const target = notifyTarget(db)
  if (!target) return
  try {
    await sock.sendMessage(target, { text })
  } catch (e) {
    logger.error('sendAlert', e)
  }
}

let _running = false
let _timer = null
let _firstTimer = null

// true saat nilai melewati/menyentuh threshold dan sebelumnya masih di bawah
// (atau belum pernah tercatat sama sekali -> prev == null)
function crossed(cur, prev, threshold) {
  if (cur == null || threshold == null) return false
  if (cur < threshold) return false
  return prev == null || prev < threshold
}

async function tick(sock, db) {
  if (_running) return
  _running = true
  try {
    const summary = await Panel.summary()
    const mon = db.data.monitor
    const alerts = []

    if (!summary.configured) {
      // panel tidak dikonfigurasi -> cek website saja
      const ws = await Panel.websiteStatus()
      if (!ws.ok && !mon.websiteDown) {
        mon.websiteDown = true
        alerts.push(`🔴 *ALERT: Website Down*\n${config.website}\nStatus/error: ${ws.error || ws.status}`)
      } else if (ws.ok && mon.websiteDown) {
        mon.websiteDown = false
        alerts.push(`🟢 *RECOVER: Website Online*\n${config.website}`)
      }
      if (alerts.length) await sendAlert(db, sock, alerts.join('\n\n'))
      logger.monitor('monitoring cek (website only): ' + (ws.ok ? 'up' : 'down'))
      db.save()
      _running = false
      return
    }

    if (summary.error) {
      if (!mon.panelDown) {
        mon.panelDown = true
        alerts.push(`🔴 *ALERT: Panel/Node tidak terjangkau*\n${summary.error}`)
      }
      if (alerts.length) await sendAlert(db, sock, alerts.join('\n\n'))
      db.save()
      _running = false
      return
    }

    if (mon.panelDown) {
      mon.panelDown = false
      alerts.push('🟢 *RECOVER: Panel kembali online*')
    }

    // Cek per-node
    for (const n of summary.nodes) {
      const prev = mon.lastNodeState[n.id] || {}
      const cur = {
        online: n.online,
        maintenance: n.maintenance,
        ramPct: n.ramPct,
        cpuPct: n.cpuPct,
        diskPct: n.diskPct,
      }

      // Node yang sedang maintenance jangan dilaporkan "Offline" — sudah ada
      // alert maintenance sendiri (sebelumnya dua-duanya muncul bersamaan).
      if (!n.online && !n.maintenance && prev.online !== false) {
        alerts.push(`🔴 *ALERT: Node Offline*\nNode: ${n.name}\nFQDN: ${n.fqdn || '-'}`)
      } else if (n.online && prev.online === false && !prev.maintenance) {
        alerts.push(`🟢 *RECOVER: Node Online*\nNode: ${n.name}`)
      }

      if (n.maintenance && !prev.maintenance) {
        alerts.push(`🛠️ *Maintenance Mode*\nNode ${n.name} sedang maintenance`)
      } else if (!n.maintenance && prev.maintenance) {
        alerts.push(`✅ *Maintenance Selesai*\nNode ${n.name} kembali normal`)
      }

      // Alert resource: kirim saat pertama kali terlihat di atas threshold
      // (prev == null berarti node baru dipantau) DAN saat naik melewati batas.
      // Sebelumnya `prev.ramPct < threshold` selalu false untuk data pertama
      // (undefined < 90 === false), jadi node yang sudah kritis sejak awal
      // tidak pernah memicu alert sama sekali.
      if (crossed(n.ramPct, prev.ramPct, config.alertRam)) {
        alerts.push(`⚠️ *Alert RAM Tinggi*\nNode: ${n.name} — RAM ${n.ramPct}%`)
      }
      if (crossed(n.cpuPct, prev.cpuPct, config.alertCpu)) {
        alerts.push(`⚠️ *Alert CPU Tinggi*\nNode: ${n.name} — CPU ${n.cpuPct}%`)
      }
      if (crossed(n.diskPct, prev.diskPct, config.alertDisk)) {
        alerts.push(`⚠️ *Alert Disk Hampir Penuh*\nNode: ${n.name} — Disk ${n.diskPct}%`)
      }

      mon.lastNodeState[n.id] = cur
    }

    // Website check
    const ws = await Panel.websiteStatus()
    if (!ws.ok && !mon.websiteDown) {
      mon.websiteDown = true
      alerts.push(`🔴 *ALERT: Website Down*\n${config.website}\n${ws.error || ws.status}`)
    } else if (ws.ok && mon.websiteDown) {
      mon.websiteDown = false
      alerts.push(`🟢 *RECOVER: Website Online*\n${config.website}`)
    }

    if (alerts.length) {
      const text = '🚨 *MONITORING OTOMATIS - WANGBOT*\n\n' + alerts.join('\n\n')
      logger.monitor('alerts: ' + alerts.length)
      await sendAlert(db, sock, text)
    } else {
      logger.monitor(`cek OK — nodes: ${summary.totalNodes}, servers: ${summary.totalServers}`)
    }
    db.save()
  } catch (e) {
    logger.error('monitor tick', e)
  } finally {
    _running = false
  }
}

const Monitor = {
  start(sock, db) {
    this.stop()
    const ms = Math.max(1, config.monitorInterval) * 60 * 1000
    logger.info(`Monitoring otomatis aktif setiap ${config.monitorInterval} menit`)
    // delay pertama 10 detik (timer disimpan supaya bisa dibatalkan saat
    // reconnect, agar tick tidak jalan dengan sock lama)
    _firstTimer = setTimeout(() => tick(sock, db), 10000)
    _timer = setInterval(() => tick(sock, db), ms)
  },
  stop() {
    if (_timer) clearInterval(_timer)
    if (_firstTimer) clearTimeout(_firstTimer)
    _timer = null
    _firstTimer = null
  },
  now(sock, db) {
    return tick(sock, db)
  },
}

module.exports = Monitor
