require('dotenv').config()

// Kode negara default untuk normalisasi nomor lokal (0 di depan -> kode negara)
const COUNTRY_CODE = process.env.COUNTRY_CODE || '62'

/**
 * Normalisasi nomor: buang karakter non-angka, ubah awalan 0 -> kode negara.
 * Mendukung: 0831xxxx, +62 831-xxxx, 62831xxxx  =>  62831xxxx
 */
function normalizeNumber(num) {
  let n = (num || '').replace(/[^0-9]/g, '')
  if (!n) return ''
  if (n.startsWith('0')) n = COUNTRY_CODE + n.slice(1) // 0831.. -> 62831..
  return n
}

function toJid(num) {
  const n = normalizeNumber(num)
  return n ? `${n}@s.whatsapp.net` : ''
}

function parseOwners() {
  const raw = (process.env.OWNER_NUMBER || '').trim()
  return raw
    .split(',')
    .map((n) => normalizeNumber(n))
    .filter(Boolean)
    .map((n) => `${n}@s.whatsapp.net`)
}

const config = {
  botName: process.env.BOT_NAME || 'WangBot',
  prefix: process.env.PREFIX || '.',
  password: process.env.BOT_PASSWORD || '',
  // Level log internal Baileys (pino). 'silent' = bersih, tanpa JSON menakutkan.
  // Untuk debugging, ubah ke 'warn' atau 'debug'.
  logLevel: process.env.LOG_LEVEL || 'silent',

  // Versi WhatsApp Web protocol (opsional). Kosong = ambil otomatis.
  // Contoh: 2.3000.1043857760
  waVersion: process.env.WA_VERSION || '',

  // Kontak & layanan
  website: process.env.WANGSTORE_WEBSITE || '',
  panelUrl: process.env.WANGSTORE_PANEL || '',
  communityGroup: process.env.COMMUNITY_GROUP || '',
  adminContact: process.env.ADMIN_CONTACT || '',
  waAdmin: process.env.WHATSAPP_ADMIN || process.env.ADMIN_CONTACT || '',
  telegramAdmin: process.env.TELEGRAM_ADMIN || '',
  instagramAdmin: process.env.INSTAGRAM_ADMIN || '',
  operationalHours: process.env.OPERATIONAL_HOURS || '08:00-22:00',

  // Pterodactyl panel
  panelApiUrl: (process.env.PANEL_API_URL || '').replace(/\/+$/, ''),
  panelApiToken: process.env.PANEL_API_TOKEN || '',
  monitorNotify: process.env.MONITOR_NOTIFY || '',
  monitorInterval: parseInt(process.env.MONITOR_INTERVAL || '5', 10),
  alertRam: parseInt(process.env.ALERT_RAM_THRESHOLD || '90', 10),
  alertCpu: parseInt(process.env.ALERT_CPU_THRESHOLD || '90', 10),
  alertDisk: parseInt(process.env.ALERT_DISK_THRESHOLD || '90', 10),

  // Keamanan broadcast (anti banned/flag WhatsApp). Jeda antar pesan & batas per batch.
  broadcastDelay: parseFloat(process.env.BROADCAST_DELAY || '5'), // detik antar pengiriman
  broadcastBatch: parseInt(process.env.BROADCAST_BATCH || '20', 10), // maks per 1 kali bc

  // Paths
  dbPath: process.env.DB_PATH || './data/database.json',
  authPath: process.env.AUTH_PATH || './data/auth',

  // Kode negara untuk normalisasi nomor (default Indonesia = 62)
  countryCode: COUNTRY_CODE,

  // Helper: owner dari .env (selalu re-read agar up-to-date)
  get envOwners() {
    return parseOwners()
  },
}

module.exports = config
module.exports.normalizeNumber = normalizeNumber
module.exports.toJid = toJid
