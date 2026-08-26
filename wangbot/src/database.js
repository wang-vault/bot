const fs = require('fs')
const path = require('path')

// Template setting default per-grup
function defaultGroupSettings() {
  return {
    // Komunitas
    welcome: false,
    welcomeText: '👋 Selamat datang @user di grup @subject!\n\nSemoga betah ya 🙌',
    goodbye: false,
    goodbyeText: '👋 @user keluar dari grup @subject.\nSampai jumpa lagi!',
    autorules: false,
    autowebsite: false,
    autogrouplink: false,
    autofaq: false,
    rulesText:
      '📜 *PERATURAN GRUP*\n1. Sopan & tidak spam\n2. Dilarang promosi tanpa izin\n3. Dilarang membagikan link berbahaya\n4. Hormati admin & member lain\n\nSelamat bergabung!',
    // Moderasi
    antilink: false,
    antipromo: false,
    antispam: false,
    antiflood: false,
    antivirtex: false,
    antitagall: false,
    autokick: false,
    mute: false,
    warnLimit: 3,
    floodLimit: 15,
    floodWindow: 5, // detik
    // whitelist
    wlLinks: [], // daftar domain/link whitelist
    wlMembers: [], // jid member whitelist (kebal antilink/promo)
  }
}

const DEFAULT_DB = {
  version: 1,
  owners: [], // owner tambahan (selain env)
  groups: {}, // jid -> defaultGroupSettings()
  afk: {}, // jid -> { reason, time }
  warnings: {}, // `${group}:${user}` -> { count }
  blacklist: { users: [], groups: [] },
  faq: [
    { q: 'cara order hosting', a: 'Ketik .layanan atau hubungi admin di .admin' },
    { q: 'berapa harga hosting', a: 'Silakan ketik .paket untuk melihat daftar harga hosting.' },
  ],
  feedback: [],
  reports: [],
  users: {}, // jid -> { name, firstSeen, lastSeen, banned }
  cmdUsage: {}, // command -> jumlah
  stats: { commands: 0, commandsSession: 0, startTime: Date.now() },
  marketing: {
    enabled: false,
    paused: false,
    groups: [], // jid tujuan promosi
    templates: [],
    intervalMinutes: 0,
    lastSent: 0,
    schedule: '', // cron sederhana HH:MM
    lastScheduleRun: '',
    stats: { sent: 0, manual: 0, auto: 0 },
  },
  monitor: {
    lastNodeState: {},
    lastMcState: {}, // identifier server MC -> { online, ramPct, cpuPct, down, since }
    websiteDown: false,
    panelDown: false,
  },
  // Monitoring server Minecraft pelanggan (lihat src/lib/mc.js)
  minecraft: {
    entries: {}, // jid pelanggan -> { email, token (Client API), servers: [id] }
    servers: {}, // identifier -> { name, host, port, rcon, monitor, ownerJid, ... }
  },
}

class Database {
  constructor(filePath) {
    this.filePath = path.resolve(filePath)
    this.data = JSON.parse(JSON.stringify(DEFAULT_DB))
    this._saveTimer = null
    this.load()
  }

  load() {
    // Urutan: file utama -> cadangan .bak -> default.
    // Sebelumnya file yang korup langsung dibuang dan diganti default, jadi
    // satu kali gagal tulis (proses mati / disk penuh) menghapus seluruh data
    // bot (owner, warning, feedback, marketing, dll) tanpa jejak.
    const candidates = [this.filePath, this.filePath + '.bak']
    for (const file of candidates) {
      try {
        if (!fs.existsSync(file)) continue
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
        this.data = this._deepMerge(JSON.parse(JSON.stringify(DEFAULT_DB)), parsed)
        if (file !== this.filePath) {
          console.warn(`[DB] file utama rusak, data dipulihkan dari ${path.basename(file)}`)
        }
        return this.data
      } catch (e) {
        console.error(`[DB] gagal load ${path.basename(file)}:`, e.message)
        // simpan bukti supaya bisa dipulihkan manual, jangan ditimpa
        try {
          const stamp = new Date().toISOString().replace(/[:.]/g, '-')
          fs.copyFileSync(file, `${file}.corrupt-${stamp}`)
          console.error(`[DB] salinan file rusak disimpan: ${path.basename(file)}.corrupt-${stamp}`)
        } catch (_) {}
      }
    }
    console.error('[DB] tidak ada data yang bisa dipakai, memulai dengan database kosong.')
    this.data = JSON.parse(JSON.stringify(DEFAULT_DB))
    return this.data
  }

  save(immediate = false) {
    if (immediate) {
      if (this._saveTimer) {
        clearTimeout(this._saveTimer)
        this._saveTimer = null
      }
      this._write()
      return
    }
    if (this._saveTimer) return
    this._saveTimer = setTimeout(() => {
      this._write()
      this._saveTimer = null
    }, 400)
  }

  _write() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
      // 1) simpan isi lama yang masih valid sebagai cadangan
      try {
        if (fs.existsSync(this.filePath)) {
          JSON.parse(fs.readFileSync(this.filePath, 'utf8')) // validasi dulu
          fs.copyFileSync(this.filePath, this.filePath + '.bak')
        }
      } catch (_) {}
      // 2) tulis atomik: ke .tmp lalu rename, supaya file utama tidak pernah
      //    setengah jadi kalau proses mati di tengah penulisan
      const tmp = this.filePath + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2))
      fs.renameSync(tmp, this.filePath)
    } catch (e) {
      console.error('[DB] gagal save:', e.message)
    }
  }

  _deepMerge(target, source) {
    if (Array.isArray(target)) return Array.isArray(source) ? source : target
    if (typeof target === 'object' && target !== null) {
      const out = { ...target }
      for (const key of Object.keys(source || {})) {
        if (
          typeof source[key] === 'object' &&
          source[key] !== null &&
          !Array.isArray(source[key])
        ) {
          out[key] = this._deepMerge(target[key] || {}, source[key])
        } else {
          out[key] = source[key]
        }
      }
      return out
    }
    return source
  }

  // ---- helpers ----
  getGroup(jid) {
    if (!this.data.groups[jid]) this.data.groups[jid] = defaultGroupSettings()
    return this.data.groups[jid]
  }

  isOwner(jid) {
    const env = require('./config').envOwners
    return env.includes(jid) || (this.data.owners || []).includes(jid)
  }

  addOwner(jid) {
    if (!this.data.owners.includes(jid)) {
      this.data.owners.push(jid)
      this.save()
      return true
    }
    return false
  }

  delOwner(jid) {
    const i = this.data.owners.indexOf(jid)
    if (i >= 0) {
      this.data.owners.splice(i, 1)
      this.save()
      return true
    }
    return false
  }

  registerUser(jid, name) {
    if (!this.data.users[jid]) {
      this.data.users[jid] = { name: name || '', firstSeen: Date.now(), lastSeen: Date.now(), banned: false }
    } else {
      this.data.users[jid].lastSeen = Date.now()
      if (name) this.data.users[jid].name = name
    }
    this.save()
  }
}

// Singleton accessor (di-set oleh index.js saat startup)
Database.instance = null

module.exports = { Database, defaultGroupSettings }
