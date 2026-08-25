const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys')
const { Boom } = require('@hapi/boom')
const P = require('pino')
const qrcode = require('qrcode-terminal')
const fs = require('fs')
const path = require('path')

const config = require('./config')
const logger = require('./lib/logger')

let sockGlobal = null

// ---------------------------------------------------------------------------
// Cache pesan sederhana (pengganti makeInMemoryStore agar tetap kompatibel
// dengan semua versi Baileys). Dipakai untuk getMessage() (retry dekripsi).
// ---------------------------------------------------------------------------
const MSG_CACHE = new Map()
const MSG_CACHE_MAX = 500
function cacheMessage(key, message) {
  if (!key || !message) return
  const k = `${key.remoteJid}:${key.id}`
  MSG_CACHE.set(k, message)
  if (MSG_CACHE.size > MSG_CACHE_MAX) {
    MSG_CACHE.delete(MSG_CACHE.keys().next().value)
  }
}
function getCachedMessage(key) {
  if (!key) return undefined
  return MSG_CACHE.get(`${key.remoteJid}:${key.id}`)
}

/**
 * Mulai koneksi WhatsApp.
 * @param {function} onMessage(sock, M)
 * @param {function} onParticipants(sock, update)
 * @param {function} onReady(sock)
 */
async function startWhatsApp(onMessage, onParticipants, onReady) {
  const { state, saveCreds } = await useMultiFileAuthState(path.resolve(config.authPath))
  fs.mkdirSync(path.resolve(config.authPath), { recursive: true })

  let version
  if (config.waVersion) {
    version = config.waVersion.split('.').map(Number)
    logger.info(`Baileys version (manual): ${version.join('.')}`)
  } else {
    try {
      const v = await fetchLatestBaileysVersion()
      version = v.version
      logger.info(`Baileys version: ${version.join('.')}`)
    } catch (e) {
      version = [2, 3000, 1034074495]
      logger.warn('Gagal ambil versi Baileys, pakai fallback stabil.')
    }
  }

  const sock = makeWASocket({
    version,
    auth: state,
    logger: P({ level: config.logLevel }),
    printQRInTerminal: false,
    browser: ['WangBot', 'Chrome', '1.0.0'],
    markOnlineOnConnect: false,
    getMessage: async (key) => getCachedMessage(key),
    defaultQueryTimeoutMs: 60000,
  })

  sockGlobal = sock
  // Antarmuka minimal "store" (kompatibilitas command lama)
  sock.store = {
    groupMetadata: new Map(),
    messages: MSG_CACHE,
  }

  // Simpan kredensial
  sock.ev.on('creds.update', saveCreds)

  // QR & status koneksi
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update
    if (qr) {
      logger.info('Scan QR berikut untuk login:')
      qrcode.generate(qr, { small: true }, (code) => console.log('\n' + code))
    }
    if (connection === 'connecting') logger.info('Menghubungkan ke WhatsApp...')
    if (connection === 'open') {
      logger.info('✅ Bot terhubung ke WhatsApp!')
      // simpan info grup yang diikuti bot (untuk broadcast)
      try {
        const groups = await sock.groupFetchAllParticipating().catch(() => ({}))
        const map = new Map()
        for (const [jid, meta] of Object.entries(groups || {})) {
          map.set(jid, meta)
        }
        sock.store.groupMetadata = map
      } catch (e) {
        logger.error('groupFetchAllParticipating', e)
      }
      if (typeof onReady === 'function') {
        try {
          await onReady(sock)
        } catch (e) {
          logger.error('onReady', e)
        }
      }
    }
    if (connection === 'close') {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode
      const shouldReconnect = code !== DisconnectReason.loggedOut
      logger.warn(`Koneksi tertutup. Code: ${code}. Reconnect: ${shouldReconnect}`)
      if (shouldReconnect) {
        setTimeout(() => startWhatsApp(onMessage, onParticipants, onReady), 3000)
      } else {
        logger.error('Akun logout. Hapus folder auth untuk login ulang.')
      }
    }
  })

  // Pesan masuk
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return
    for (const M of messages) {
      if (!M.message) continue
      if (M.key && M.key.remoteJid === 'status@broadcast') continue
      cacheMessage(M.key, M.message)
      // catat metadata grup bila ada (perbarui registry broadcast)
      if (M.key.remoteJid && M.key.remoteJid.endsWith('@g.us') && !sock.store.groupMetadata.has(M.key.remoteJid)) {
        sock.store.groupMetadata.set(M.key.remoteJid, { id: M.key.remoteJid })
      }
      try {
        await onMessage(sock, M)
      } catch (e) {
        logger.error('onMessage', e)
      }
    }
  })

  // Group participant update (join/leave/promote)
  sock.ev.on('group-participants.update', async (update) => {
    try {
      await onParticipants(sock, update)
    } catch (e) {
      logger.error('onParticipants', e)
    }
  })

  return sock
}

function getSock() {
  return sockGlobal
}

module.exports = { startWhatsApp, getSock }
