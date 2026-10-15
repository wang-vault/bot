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

/**
 * Daftar owner dari .env. Owner SELALU nomor WhatsApp (@s.whatsapp.net).
 *
 * Entri bisa berupa:
 *   - nomor       : `6281234567890`, `0812xxxx`, `+62 812-xxxx`
 *   - JID nomor   : `6281234567890@s.whatsapp.net`
 *   - JID LID     : `123456789012345@lid`  -> tidak dipakai sebagai nomor,
 *     melainkan disimpan sebagai identitas LID eksplisit (lihat
 *     `envOwnerLids`) supaya owner yang chat-nya dialamatkan WhatsApp sebagai
 *     LID tetap dikenali. Ini bentuk darurat: bot akan meminta nomornya.
 */
function parseOwnerEntries() {
  const pn = []
  const lids = []
  const raw = (process.env.OWNER_NUMBER || '').trim()
  for (const entry of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (/@lid$/i.test(entry)) {
      const n = entry.split('@')[0].replace(/[^0-9]/g, '')
      if (n) lids.push(`${n}@lid`)
      continue
    }
    const n = normalizeNumber(entry)
    if (n) pn.push(`${n}@s.whatsapp.net`)
  }
  return { pn, lids }
}

/** `OWNER_LID` — daftar LID milik owner (opsional, dipisah koma). */
function parseOwnerLids() {
  const raw = (process.env.OWNER_LID || '').trim()
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const n = s.split('@')[0].replace(/[^0-9]/g, '')
      return n ? `${n}@lid` : ''
    })
    .filter(Boolean)
}

/**
 * `OWNER_LID_MAP` — pasangan LID:nomor yang dinyatakan admin, mis.
 * `OWNER_LID_MAP=123456789012345@lid:6281234567890`.
 * Dipakai kalau WhatsApp mengirim pesan owner sebagai `@lid` dan nomornya
 * tidak muncul di metadata mana pun (jarang, tapi bikin owner tidak dikenali).
 */
function parseLidMap() {
  const raw = (process.env.OWNER_LID_MAP || '').trim()
  const out = {}
  if (!raw) return out
  for (const pair of raw.split(/[,\n;]+/).map((s) => s.trim()).filter(Boolean)) {
    const [left, right] = pair.split(/[:=]/).map((s) => (s || '').trim())
    const lid = String(left || '').split('@')[0].replace(/[^0-9]/g, '')
    const pn = normalizeNumber(right)
    if (lid && pn) out[`${lid}@lid`] = `${pn}@s.whatsapp.net`
  }
  return out
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
  // Client API key (Account -> API Credentials). Dipakai monitoring PER SERVER
  // (Minecraft pelanggan). Kosongkan bila hanya mau monitoring node.
  panelClientToken: process.env.PANEL_CLIENT_TOKEN || '',
  monitorNotify: process.env.MONITOR_NOTIFY || '',
  monitorInterval: parseInt(process.env.MONITOR_INTERVAL || '5', 10),
  alertRam: parseInt(process.env.ALERT_RAM_THRESHOLD || '90', 10),
  alertCpu: parseInt(process.env.ALERT_CPU_THRESHOLD || '90', 10),
  alertDisk: parseInt(process.env.ALERT_DISK_THRESHOLD || '90', 10),

  // ===== Monitoring server Minecraft =====
  mcEnabled: (process.env.MC_MONITOR || '1') !== '0',
  mcInterval: parseInt(process.env.MC_MONITOR_INTERVAL || '2', 10), // menit
  mcAlertRam: parseInt(process.env.MC_ALERT_RAM_THRESHOLD || '90', 10),
  mcAlertCpu: parseInt(process.env.MC_ALERT_CPU_THRESHOLD || '90', 10),
  // Server yang "baru pertama kali dipantau" tidak langsung diteriaki down,
  // supaya bot yang baru dinyalakan tidak membanjiri pelanggan dengan alert.
  mcGraceTicks: parseInt(process.env.MC_GRACE_TICKS || '1', 10),
  mcMaxPerUser: parseInt(process.env.MC_MAX_SERVERS_PER_USER || '5', 10),
  // Selang pengingat selama server masih down (menit)
  mcDownRemind: parseInt(process.env.MC_DOWN_REMIND_MINUTES || '30', 10),
  mcPingTimeout: parseInt(process.env.MC_PING_TIMEOUT || '5000', 10), // ms
  // Kirim alert down pelanggan juga ke admin? (1 = ya)
  mcNotifyAdmin: (process.env.MC_NOTIFY_ADMIN || '1') !== '0',
  // Izinkan console/power command dipakai di grup? (default tidak)
  mcConsoleInGroup: (process.env.MC_CONSOLE_IN_GROUP || '0') === '1',

  // Keamanan broadcast (anti banned/flag WhatsApp). Jeda antar pesan & batas per batch.
  broadcastDelay: parseFloat(process.env.BROADCAST_DELAY || '5'), // detik antar pengiriman
  broadcastBatch: parseInt(process.env.BROADCAST_BATCH || '20', 10), // maks per 1 kali bc

  // Paths
  dbPath: process.env.DB_PATH || './data/database.json',
  authPath: process.env.AUTH_PATH || './data/auth',

  // Kode negara untuk normalisasi nomor (default Indonesia = 62)
  countryCode: COUNTRY_CODE,

  // Helper: owner dari .env (selalu re-read agar up-to-date).
  // `envOwners` = nomor WhatsApp (bentuk utama), `envOwnerLids` = LID yang
  // dinyatakan eksplisit untuk owner (bentuk darurat, lihat src/lib/identity.js).
  get envOwners() {
    return parseOwnerEntries().pn
  },
  get envOwnerLids() {
    return [...new Set([...parseOwnerEntries().lids, ...parseOwnerLids()])]
  },
  // Pasangan LID -> nomor yang dinyatakan admin (OWNER_LID_MAP)
  get lidMap() {
    return parseLidMap()
  },
}

module.exports = config
module.exports.normalizeNumber = normalizeNumber
module.exports.toJid = toJid
