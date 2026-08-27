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

  /**
   * Nomor polos dari sebuah JID — untuk DITAMPILKAN ke user.
   * 6281234@s.whatsapp.net -> 6281234 (user tidak perlu melihat JID).
   */
  num(jid) {
    return String(jid || '').split('@')[0] || '-'
  },

  /**
   * Ubah input user menjadi JID pribadi (@s.whatsapp.net) yang ternormalisasi.
   * Semua format ini diterima:
   *   0812xxxx | +62 812-xxxx | 62 812 xxxx | 62812xxxx | 62812xxxx@s.whatsapp.net
   *   wa.me/62812xxxx | @62812xxxx (tag di dalam teks)
   * Mengembalikan '' bila tidak ada nomor yang masuk akal (minimal 8 angka,
   * supaya kata biasa / angka pendek di dalam alasan tidak dianggap nomor).
   */
  jidFromInput(input) {
    const { toJid } = require('../config')
    // '@' di depan = bentuk mention di dalam teks, bukan bagian JID
    const s = String(input || '').trim().replace(/^@(?=\d)/, '')
    if (!s) return ''
    if (s.endsWith('@g.us')) return '' // JID grup, bukan orang
    if (s.includes('@')) {
      if (s.endsWith('@s.whatsapp.net')) return s // sudah JID -> tetap didukung
      if (s.endsWith('@lid')) return s // LID: biarkan, handler yang me-resolve ke nomor
      const head = s.split('@')[0].replace(/[^0-9]/g, '')
      return head.length >= 8 ? toJid(head) : ''
    }
    const digits = s.replace(/[^0-9]/g, '')
    if (digits.length < 8) return ''
    return toJid(digits)
  },

  /**
   * Pecah teks argumen jadi calon nomor. Nomor yang ditulis ber-spasi
   * ("+62 811-9999-8888", "0812 3456 7890") digabung dulu; kalau gabungan-nya
   * terlalu panjang untuk satu nomor (mis. dua nomor berurutan), dipecah lagi
   * per bagian supaya ".kick 0812xxx 0813xxx" tetap kena dua orang.
   */
  phoneSequences(text) {
    const NUMTOK = /^[@+()\-.\d]+$/
    const out = []
    let buf = []
    const flush = () => {
      if (!buf.length) return
      if (buf.length > 1) {
        const joined = buf.join('')
        const digits = joined.replace(/\D/g, '')
        if (digits.length >= 9 && digits.length <= 15) {
          out.push(joined)
          buf = []
          return
        }
      }
      out.push(...buf)
      buf = []
    }
    for (const tok of String(text || '').split(/[\s,]+/).filter(Boolean)) {
      if (tok.includes('@')) {
        // JID apa adanya (@s.whatsapp.net / @lid / @g.us) -> serahkan ke jidFromInput
        flush()
        out.push(tok)
      } else if (NUMTOK.test(tok)) buf.push(tok)
      else flush()
    }
    flush()
    return out
  },

  /**
   * Ambil target ORANG untuk command owner/admin dari: nomor di argumen,
   * orang yang di-tag, atau pesan yang di-reply. Hasil selalu JID pribadi
   * ternormalisasi, jadi owner/admin cukup mengetik nomor.
   *
   * @param {object} m           pesan (butuh .args, .mentionedJid, .quoted)
   * @param {string} [argText]   teks argumen (default m.args)
   * @param {object} [opts]      { firstOnly: true } = berhenti di target pertama
   * @returns {string[]} daftar JID (bisa kosong)
   */
  targets(m, argText, opts = {}) {
    const out = []
    const push = (j) => {
      if (j && !j.endsWith('@g.us') && !out.includes(j)) out.push(j)
    }
    const text = argText === undefined ? m.args || '' : String(argText || '')
    const candidates = [...func.phoneSequences(text).map((t) => t.replace(/^@/, '')), ...(m.mentionedJid || [])]
    for (const c of candidates) {
      push(func.jidFromInput(c))
      if (opts.firstOnly && out.length) break
    }
    if (!out.length && m.quoted && m.quoted.sender) push(func.jidFromInput(m.quoted.sender))
    return out
  },

  /** Target pertama saja (untuk command yang hanya butuh satu orang). */
  target(m, argText, opts = {}) {
    return func.targets(m, argText, opts)[0] || ''
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
