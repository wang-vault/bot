'use strict'

const config = require('./src/config')
const { Database } = require('./src/database')
const { loadCommands } = require('./src/commands')
const { handle } = require('./src/handler')
const { startWhatsApp } = require('./src/connection')
const { handleParticipantsUpdate } = require('./src/events/groups')
const Monitor = require('./src/lib/monitor')
const Marketing = require('./src/lib/marketing')
const Guardian = require('./src/lib/guardian')
const logger = require('./src/lib/logger')

// ---------- Database ----------
const db = new Database(config.dbPath)
require('./src/database').Database.instance = db

// ---------- Load commands ----------
const loader = loadCommands()
logger.info(`Loaded ${loader.commands.length} command dari ${new Set(loader.commands.map((c) => c.category)).size} kategori`)

// ---------- Apply runtime overrides (prefix, dll) ----------
if (db.data.runtime && db.data.runtime.prefix) {
  config.prefix = db.data.runtime.prefix
  logger.info(`Prefix runtime: "${config.prefix}"`)
}

// ---------- Global error guard ----------
process.on('uncaughtException', (err) => {
  logger.error('UNCAUGHT EXCEPTION', err)
})
process.on('unhandledRejection', (err) => {
  logger.error('UNHANDLED REJECTION', err)
})

// ---------- Boot ----------
function onReady(sock) {
  // Jalankan scheduler monitoring & marketing dengan sock terbaru (reconnect-safe)
  try {
    Monitor.start(sock, db)
  } catch (e) {
    logger.error('Monitor.start', e)
  }
  try {
    Marketing.start(sock, db)
  } catch (e) {
    logger.error('Marketing.start', e)
  }
  try {
    Guardian.start(sock, db, loader)
  } catch (e) {
    logger.error('Guardian.start', e)
  }
}

async function main() {
  logger.info(`Memulai ${config.botName}...`)
  logger.info(`Prefix: "${config.prefix}" | Owner env: ${config.envOwners.length} nomor`)

  await startWhatsApp(
    async (sock, M) => handle(sock, db, loader, M),
    async (sock, update) => handleParticipantsUpdate(sock, db, update),
    onReady
  )
}

main()

// Graceful shutdown
const shutdown = (sig) => {
  logger.warn(`Menerima ${sig}, menyimpan database & keluar...`)
  try {
    Guardian.stop()
  } catch (_) {}
  try {
    db.save(true)
  } catch (_) {}
  process.exit(0)
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
