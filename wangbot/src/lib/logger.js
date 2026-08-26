const fs = require('fs')
const path = require('path')

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
  },
  cmd: (msg) => write('command', msg),
  join: (msg) => write('joinleave', msg),
  promo: (msg) => write('promo', msg),
  warn: (msg) => console.warn(`[WARN] ${msg}`),
  monitor: (msg) => write('monitor', msg),
}

module.exports = logger
