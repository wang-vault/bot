const fs = require('fs')
const path = require('path')

// Guardian dapat berlangganan error runtime tanpa mengubah setiap call-site.
// Set sederhana dipakai (bukan EventEmitter event "error") agar listener yang
// bermasalah tidak pernah membuat proses ikut crash.
const errorListeners = new Set()

const LOG_DIR = path.resolve('./data/logs')
try {
  fs.mkdirSync(LOG_DIR, { recursive: true })
} catch (_) {}

function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19)
}

function file(name) {
  const d = new Date().toISOString().slice(0, 10)
  return path.join(LOG_DIR, `${d}_${name}.log`)
}

function write(name, msg) {
  try {
    fs.appendFileSync(file(name), `[${ts()}] ${msg}\n`)
  } catch (_) {}
}

const logger = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  error: (msg, err) => {
    const m = err ? `${msg} -> ${err && err.stack ? err.stack : err}` : msg
    console.error(`[ERROR] ${m}`)
    write('error', m)
    const event = { at: Date.now(), source: String(msg || 'unknown'), message: m }
    for (const listener of errorListeners) {
      try {
        listener(event)
      } catch (_) {}
    }
  },
  onError: (listener) => {
    if (typeof listener !== 'function') return () => {}
    errorListeners.add(listener)
    return () => errorListeners.delete(listener)
  },
  cmd: (msg) => write('command', msg),
  join: (msg) => write('joinleave', msg),
  promo: (msg) => write('promo', msg),
  warn: (msg) => console.warn(`[WARN] ${msg}`),
  monitor: (msg) => write('monitor', msg),
}

module.exports = logger
