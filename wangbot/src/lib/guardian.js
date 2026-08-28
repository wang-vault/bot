const crypto = require('crypto')
const config = require('../config')
const logger = require('./logger')
const Persona = require('./persona')
const CodeHealth = require('./code-health')

let _sock = null
let _db = null
let _loader = null
let _interval = null
let _startupTimer = null
let _errorTimer = null
let _unsubscribe = null
let _running = false
const _runtimeErrors = new Map()

function boolEnv(name, fallback) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  return !['0', 'false', 'off', 'no'].includes(String(raw).trim().toLowerCase())
}

function store(db) {
  const a = Persona.assistantStore(db)
  if (!a) return null
  if (!a.guardian || typeof a.guardian !== 'object') a.guardian = {}
  const g = a.guardian
  if (!g.runtimeSeen || typeof g.runtimeSeen !== 'object' || Array.isArray(g.runtimeSeen)) g.runtimeSeen = {}
  return g
}

function resolve(db) {
  const g = store(db) || {}
  const envInterval = Number(process.env.ASSISTANT_CHECK_INTERVAL || 360)
  const envRepeat = Number(process.env.ASSISTANT_REPORT_REPEAT_HOURS || 24)
  return {
    enabled: g.enabled === true || g.enabled === false ? g.enabled : boolEnv('ASSISTANT_GUARDIAN', true),
    intervalMinutes:
      Number(g.intervalMinutes) >= 15
        ? Math.min(10080, Number(g.intervalMinutes))
        : Math.max(15, Math.min(10080, Number.isFinite(envInterval) ? envInterval : 360)),
    runtimeErrors:
      g.runtimeErrors === true || g.runtimeErrors === false
        ? g.runtimeErrors
        : boolEnv('ASSISTANT_REPORT_RUNTIME_ERRORS', true),
    reportHealthy:
      g.reportHealthy === true || g.reportHealthy === false
        ? g.reportHealthy
        : boolEnv('ASSISTANT_REPORT_HEALTHY', false),
    repeatHours: Math.max(1, Math.min(168, Number.isFinite(envRepeat) ? envRepeat : 24)),
  }
}

function setOption(db, key, value) {
  const g = store(db)
  if (!g) return { ok: false, error: 'Database tidak tersedia.' }
  if (['enabled', 'runtimeErrors', 'reportHealthy'].includes(key)) {
    if (value !== true && value !== false) return { ok: false, error: 'Nilai harus on atau off.' }
    g[key] = value
  } else if (key === 'intervalMinutes') {
    const n = Number(value)
    if (!Number.isFinite(n) || n < 15 || n > 10080) {
      return { ok: false, error: 'Interval harus 15–10080 menit.' }
    }
    g.intervalMinutes = Math.round(n)
  } else {
    return { ok: false, error: `Pengaturan guardian "${key}" tidak dikenal.` }
  }
  db.save()
  return { ok: true, key, value: g[key] }
}

function ownerJids(db) {
  return [...new Set([...config.envOwners, ...((db && db.data && db.data.owners) || [])])].filter(
    (jid) => typeof jid === 'string' && jid.endsWith('@s.whatsapp.net')
  )
}

async function sendOwners(sock, db, text) {
  if (!sock || typeof sock.sendMessage !== 'function' || !text) return { sent: 0 }
  let sent = 0
  for (const jid of ownerJids(db)) {
    try {
      await sock.sendMessage(jid, { text: String(text).slice(0, 4000) })
      sent++
    } catch (e) {
      // Jangan pakai logger.error di sini: kegagalan laporan guardian tidak
      // boleh memicu laporan guardian baru secara rekursif.
      console.error(`[GUARDIAN] gagal kirim ke ${jid}: ${e.message}`)
    }
  }
  return { sent }
}

function rememberReport(db, report) {
  const g = store(db)
  if (!g) return
  g.lastRun = report.at
  g.lastFingerprint = report.fingerprint
  g.lastErrors = report.errors
  g.lastWarnings = report.warnings
  g.lastDurationMs = report.durationMs
  db.save()
}

async function runCheck(options = {}) {
  const sock = options.sock || _sock
  const db = options.db || _db
  const loader = options.loader || _loader
  if (!db || !loader || _running) return { skipped: true, reason: _running ? 'busy' : 'not-ready' }
  _running = true
  try {
    const g = store(db)
    const cfg = resolve(db)
    const previousFingerprint = g.lastFingerprint || ''
    const previousProblems = Number(g.lastErrors || 0) + Number(g.lastWarnings || 0)
    const previousReportAt = Number(g.lastReportAt || 0)
    const report = await CodeHealth.run({ db, loader, deep: !!options.deep })
    rememberReport(db, report)

    if (options.notify === false) return report

    let shouldSend = false
    let title = 'LAPORAN PROAKTIF — PENJAGA KODE'
    if (!report.ok) {
      shouldSend =
        report.fingerprint !== previousFingerprint ||
        Date.now() - previousReportAt >= cfg.repeatHours * 60 * 60 * 1000
    } else if (previousProblems > 0) {
      shouldSend = true
      title = 'PEMULIHAN — KODE KEMBALI SEHAT'
    } else if (cfg.reportHealthy && Date.now() - previousReportAt >= cfg.repeatHours * 60 * 60 * 1000) {
      shouldSend = true
      title = 'LAPORAN RUTIN — BOT SEHAT'
    }

    if (shouldSend) {
      const name = Persona.resolve(db).name
      const intro = report.ok
        ? `✅ *${name}* selesai memeriksa dirinya sendiri dan tidak menemukan masalah utama.\n\n`
        : `Aku menemukan perubahan kondisi yang perlu diperhatikan owner. Aku hanya mendiagnosis dan melapor; aku tidak mengubah source code sendiri.\n\n`
      await sendOwners(sock, db, intro + CodeHealth.format(report, { title, maxIssues: 8 }))
      g.lastReportAt = Date.now()
      db.save()
    }
    return report
  } catch (e) {
    // Ini dicetak langsung untuk menghindari listener runtime merekam dirinya.
    console.error('[GUARDIAN] self-check gagal:', e)
    return { ok: false, internalError: e.message }
  } finally {
    _running = false
  }
}

function runtimeFingerprint(message) {
  const normalized = CodeHealth.redact(message)
    .replace(/\b\d{6,}\b/g, '#')
    .replace(/\b[0-9a-f]{10,}\b/gi, '#')
    .replace(/:\d+:\d+/g, ':#:#')
    .slice(0, 1500)
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 14)
}

function onRuntimeError(event) {
  if (!_db || !resolve(_db).runtimeErrors) return
  const source = String(event && event.source || '')
  // Jangan buat siklus dari komponen pelapor sendiri.
  if (/^(guardian|assistant runtime report)/i.test(source)) return
  const message = CodeHealth.redact(event && event.message || source || 'unknown error')
  const id = runtimeFingerprint(message)
  const current = _runtimeErrors.get(id) || { id, count: 0, firstAt: Date.now(), lastAt: 0, message: '' }
  current.count++
  current.lastAt = Date.now()
  current.message = message.slice(0, 1600)
  _runtimeErrors.set(id, current)

  if (!_errorTimer) {
    _errorTimer = setTimeout(flushRuntimeErrors, 30000)
    if (typeof _errorTimer.unref === 'function') _errorTimer.unref()
  }
}

async function flushRuntimeErrors() {
  if (_errorTimer) clearTimeout(_errorTimer)
  _errorTimer = null
  if (!_db || !_sock || !_runtimeErrors.size) return
  const cfg = resolve(_db)
  if (!cfg.runtimeErrors) {
    _runtimeErrors.clear()
    return
  }

  const g = store(_db)
  const now = Date.now()
  const fresh = []
  for (const item of _runtimeErrors.values()) {
    const seenAt = Number(g.runtimeSeen[item.id] || 0)
    if (now - seenAt >= 60 * 60 * 1000) {
      fresh.push(item)
      g.runtimeSeen[item.id] = now
    }
  }
  _runtimeErrors.clear()

  // Batasi histori fingerprint di database.
  const seen = Object.entries(g.runtimeSeen).sort((a, b) => b[1] - a[1])
  g.runtimeSeen = Object.fromEntries(seen.slice(0, 50))
  _db.save()
  if (!fresh.length) return

  let text = `🚨 *${Persona.resolve(_db).name.toUpperCase()} — ERROR RUNTIME*\n\n`
  text += `Aku menangkap ${fresh.reduce((sum, item) => sum + item.count, 0)} error (${fresh.length} jenis) saat bot berjalan.\n`
  text += 'Ini bukan hasil tebakan AI; data berasal langsung dari logger aplikasi.\n'
  for (const item of fresh.slice(0, 6)) {
    const oneLine = item.message.replace(/\s+/g, ' ').slice(0, 500)
    text += `\n🔴 *${item.id}*${item.count > 1 ? ` (${item.count}x)` : ''}\n${oneLine}\n`
  }
  text += `\nJalankan \`${config.prefix}selfcheck\` untuk audit source, atau \`${config.prefix}selfcheck deep\` untuk sekaligus menjalankan test suite.`
  await sendOwners(_sock, _db, text)
}

function start(sock, db, loader) {
  stop()
  _sock = sock
  _db = db
  _loader = loader
  const cfg = resolve(db)
  if (!cfg.enabled) {
    logger.info('Assistant Guardian nonaktif')
    return
  }

  logger.info(`Assistant Guardian aktif setiap ${cfg.intervalMinutes} menit`)
  if (typeof logger.onError === 'function') _unsubscribe = logger.onError(onRuntimeError)

  // Jangan mengulang startup check pada reconnect cepat.
  const lastRun = Number((store(db) || {}).lastRun || 0)
  // Proses yang benar-benar baru selalu diperiksa (penting setelah deploy),
  // sedangkan reconnect WhatsApp pada proses lama memakai batas 15 menit.
  if (process.uptime() < 120 || Date.now() - lastRun > 15 * 60 * 1000) {
    _startupTimer = setTimeout(() => runCheck(), 20000)
    if (typeof _startupTimer.unref === 'function') _startupTimer.unref()
  }
  _interval = setInterval(() => runCheck(), cfg.intervalMinutes * 60 * 1000)
  if (typeof _interval.unref === 'function') _interval.unref()
}

function stop() {
  if (_interval) clearInterval(_interval)
  if (_startupTimer) clearTimeout(_startupTimer)
  if (_errorTimer) clearTimeout(_errorTimer)
  if (_unsubscribe) _unsubscribe()
  _interval = null
  _startupTimer = null
  _errorTimer = null
  _unsubscribe = null
  _runtimeErrors.clear()
}

function refresh() {
  if (_sock && _db && _loader) start(_sock, _db, _loader)
}

function status(db) {
  const cfg = resolve(db)
  const g = store(db) || {}
  return {
    ...cfg,
    lastRun: Number(g.lastRun || 0),
    lastReportAt: Number(g.lastReportAt || 0),
    lastFingerprint: g.lastFingerprint || '',
    lastErrors: Number(g.lastErrors || 0),
    lastWarnings: Number(g.lastWarnings || 0),
  }
}

module.exports = {
  store,
  resolve,
  setOption,
  ownerJids,
  sendOwners,
  runCheck,
  runtimeFingerprint,
  onRuntimeError,
  flushRuntimeErrors,
  start,
  stop,
  refresh,
  status,
  _runtimeErrors,
}
