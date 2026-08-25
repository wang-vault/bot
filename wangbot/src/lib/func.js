const { proto } = require('@whiskeysockets/baileys')

const func = {
  /** JID owner dari .env + db */
  owners() {
    const config = require('../config')
    const { Database } = require('../database')
    const db = Database.instance
    return [...new Set([...config.envOwners, ...(db ? db.data.owners : [])])]
  },

  /** Cek apakah jid owner */
  isOwner(jid, db) {
    const config = require('../config')
    return config.envOwners.includes(jid) || (db.data.owners || []).includes(jid)
  },

  /** Ambil metadata grup (dengan cache singkat) */
  async groupMetadata(sock, jid) {
    try {
      return await sock.groupMetadata(jid)
    } catch {
      return null
    }
  },

  /** Cek apakah sender adalah admin grup */
  async isAdmin(sock, jid, sender) {
    const meta = await func.groupMetadata(sock, jid)
    if (!meta) return false
    return meta.participants.some((p) => p.id === sender && (p.admin === 'admin' || p.admin === 'superadmin'))
  },

  async isBotAdmin(sock, jid) {
    const meta = await func.groupMetadata(sock, jid)
    if (!meta || !sock.user) return false
    const me = sock.user.id.split(':')[0] + '@s.whatsapp.net'
    return meta.participants.some((p) => p.id === me && (p.admin === 'admin' || p.admin === 'superadmin'))
  },

  /** Mentions tag all members */
  async tagAll(sock, jid, text) {
    const meta = await func.groupMetadata(sock, jid)
    if (!meta) return
    const mentions = meta.participants.map((p) => p.id)
    await sock.sendMessage(jid, { text: text || '@all', mentions })
  },

  /**
   * Resolve WhatsApp LID (@lid) -> nomor asli (@s.whatsapp.net)
   * pakai daftar participants grup (Baileys menyediakan field jid=phone, lid=@lid).
   * Penting untuk grup dgn fitur "sembunyikan nomor".
   */
  resolveLid(jid, participants) {
    if (!jid || !jid.endsWith('@lid') || !Array.isArray(participants)) return jid
    const found = participants.find((p) => (p.lid && p.lid === jid) || p.id === jid)
    if (found && found.jid && found.jid.endsWith('@s.whatsapp.net')) return found.jid
    return jid
  },

  /** Format runtime */
  runtime(ms) {
    const s = Math.floor(ms / 1000)
    const d = Math.floor(s / 86400)
    const h = Math.floor((s % 86400) / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    return `${d}h ${h}j ${m}m ${sec}d`.replace(/^0h /, '').replace(/^0j /, '')
  },

  /** Runtime kategori uptime */
  uptime(ms) {
    const sec = Math.floor(ms / 1000)
    const d = Math.floor(sec / 86400)
    const h = Math.floor((sec % 86400) / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = sec % 60
    const parts = []
    if (d) parts.push(`${d} hari`)
    if (h) parts.push(`${h} jam`)
    if (m) parts.push(`${m} menit`)
    if (!d) parts.push(`${s} detik`)
    return parts.join(' ')
  },

  /** Deteksi link/url dalam teks */
  hasUrl(text) {
    if (!text) return false
    return /(https?:\/\/|www\.|wa\.me\/|chat\.whatsapp\.com|t\.me\/)/i.test(text)
  },

  extractUrls(text) {
    if (!text) return []
    const re = /(https?:\/\/[^\s]+|www\.[^\s]+|wa\.me\/[^\s]+|chat\.whatsapp\.com\/[^\s]+|t\.me\/[^\s]+)/gi
    return text.match(re) || []
  },

  /** Deteksi virtex / pesan mencurigakan */
  isVirtex(message, text) {
    if (text && text.length > 5000) return true
    // karakter tersembunyi (zero-width) dalam jumlah besar
    if (text && /[\u200b-\u200f\u202a-\u202e\ufeff]/.test(text) && text.length > 1500) return true
    // file kecil dengan ekstensi berbahaya
    if (message?.documentMessage?.fileLength) {
      const fl = Number(message.documentMessage.fileLength)
      const fn = message.documentMessage.fileName || ''
      if (fl > 0 && fl < 1000 && /\.(bat|cmd|exe|vbs|apk|jar|sh|scr|msi)$/i.test(fn)) return true
    }
    return false
  },

  /** Flag Indonesia */
  sleep(ms) {
    return new Promise((r) => setTimeout(r, ms))
  },

  pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)]
  },
}

module.exports = func
