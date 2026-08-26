const func = require('./func')
const logger = require('./logger')

// Counter in-memory untuk flood/spam (tidak perlu persist)
const floodCount = new Map() // key=`${group}:${user}` -> { count, first }

function addWarning(db, group, user) {
  const key = `${group}:${user}`
  if (!db.data.warnings[key]) db.data.warnings[key] = { count: 0 }
  db.data.warnings[key].count += 1
  db.data.warnings[key].last = Date.now()
  db.save()
  return db.data.warnings[key].count
}

function resetWarning(db, group, user) {
  const key = `${group}:${user}`
  if (db.data.warnings[key]) {
    delete db.data.warnings[key]
    db.save()
    return true
  }
  return false
}

async function warnAndAct(sock, db, m, g, reason) {
  const count = addWarning(db, m.chat, m.sender)
  const limit = g.warnLimit || 3
  const meAdmin = await func.isBotAdmin(sock, m.chat)
  let msg = `⚠️ *Peringatan ${count}/${limit}*\n@${m.sender.split('@')[0]}\nAlasan: ${reason}`
  if (count >= limit) {
    if (g.autokick && meAdmin) {
      msg += `\n\n🚪 Kamu dikeluarkan karena mencapai batas peringatan.`
      await sock.sendMessage(m.chat, { text: msg, mentions: [m.sender] }).catch(() => {})
      try {
        await sock.groupParticipantsUpdate(m.chat, [m.sender], 'remove')
      } catch (e) {
        logger.error('warnAndAct kick', e)
      }
      resetWarning(db, m.chat, m.sender)
    } else {
      msg += `\n\n🚧 Peringatan penuh! Hati-hati bisa dikeluarkan.`
      await sock.sendMessage(m.chat, { text: msg, mentions: [m.sender] }).catch(() => {})
    }
  } else {
    await sock.sendMessage(m.chat, { text: msg, mentions: [m.sender] }).catch(() => {})
  }
}

async function run(sock, db, m) {
  if (!m.isGroup || m.fromMe) return
  const g = db.getGroup(m.chat)
  const senderIsAdmin = await func.isAdmin(sock, m.chat, m.sender)
  const isOwner = func.isOwner(m.sender, db)
  const whitelisted = g.wlMembers.includes(m.sender)
  const exempt = senderIsAdmin || isOwner || whitelisted

  const meAdmin = await func.isBotAdmin(sock, m.chat)
  let shouldDelete = false
  let reason = ''

  // 1. Anti Virtex
  if (g.antivirtex && func.isVirtex(m.message, m.body)) {
    shouldDelete = true
    reason = 'Mengirim virtex / file berbahaya'
  }

  // 2. Anti Link
  if (!shouldDelete && g.antilink && func.hasUrl(m.body)) {
    const urls = func.extractUrls(m.body)
    const allAllowed = urls.every((u) => g.wlLinks.some((w) => w && u.includes(w)))
    if (!allAllowed) {
      shouldDelete = true
      reason = 'Mengirim link tanpa izin'
    }
  }

  // 3. Anti Promo (kata kunci promosi)
  if (!shouldDelete && g.antipromo) {
    const lower = (m.body || '').toLowerCase()
    const promoWords = [
      'jual', 'sewa', 'murah', 'diskon', 'promo', 'order', 'paket', 'bonus',
      'gabung grub', 'serbu', 'gratis ongkir', 'harga hem', 'pinjol', 'mabar',
      'cuan', 'viral', 'reseller',
    ]
    const hit = promoWords.filter((w) => lower.includes(w))
    if (hit.length >= 2 || (hit.length >= 1 && func.hasUrl(m.body))) {
      shouldDelete = true
      reason = 'Terindikasi promosi/spam iklan'
    }
  }

  // 4. Anti Tag All (mention banyak member)
  if (!shouldDelete && g.antitagall && Array.isArray(m.mentionedJid) && m.mentionedJid.length >= 7) {
    shouldDelete = true
    reason = 'Mention terlalu banyak member (tag all)'
  }

  // Catat pesan untuk Anti Spam & Anti Flood.
  // Dulu pencatatan hanya dilakukan di blok Anti Spam, sehingga kalau
  // antispam OFF dan antiflood ON daftar pesan selalu kosong -> antiflood
  // tidak pernah jalan. Sekarang dicatat sekali di sini untuk keduanya.
  let entry = null
  if (g.antispam || g.antiflood) {
    const fk = `${m.chat}:${m.sender}`
    const now = Date.now()
    entry = floodCount.get(fk)
    if (!entry) {
      entry = { msgs: [], first: now }
    }
    // simpan hanya 30 detik terakhir
    entry.msgs = entry.msgs.filter((x) => now - x.t < 30000)
    entry.msgs.push({ t: now, body: m.body })
    floodCount.set(fk, entry)
  }

  // 5. Anti Spam (kata identik berulang)
  if (!shouldDelete && g.antispam && entry) {
    const same = entry.msgs.filter((x) => x.body && x.body === m.body).length
    if (same >= 5) {
      shouldDelete = true
      reason = 'Spam pesan berulang'
    }
  }

  // 6. Anti Flood (terlalu banyak pesan dalam waktu singkat)
  if (!shouldDelete && g.antiflood && entry) {
    const now = Date.now()
    const window = (g.floodWindow || 5) * 1000
    const limit = g.floodLimit || 15
    const recent = entry.msgs.filter((x) => now - x.t <= window).length
    if (recent >= limit) {
      shouldDelete = true
      reason = `Flooding (${recent} pesan dalam ${g.floodWindow || 5} detik)`
    }
  }

  if (!shouldDelete) return

  // Owner selalu kebal, tapi admin grup punya perlindungan
  if (isOwner) return

  if (!exempt && meAdmin) {
    try {
      await sock.sendMessage(m.chat, { delete: m.key })
    } catch (e) {
      logger.error('mod delete', e)
    }
    if (!senderIsAdmin) {
      await warnAndAct(sock, db, m, g, reason)
    }
  } else if (!meAdmin) {
    // bot bukan admin -> hanya bisa peringatkan
    if (!senderIsAdmin) {
      await sock
        .sendMessage(m.chat, { text: `⚠️ ${reason} terdeteksi (bot butuh admin untuk menghapus/mengeluarkan).` })
        .catch(() => {})
    }
  }
}

// cleanup berkala (setiap 2 menit)
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of floodCount.entries()) {
    v.msgs = (v.msgs || []).filter((x) => now - x.t < 30000)
    if (!v.msgs.length) floodCount.delete(k)
  }
}, 120000).unref()

module.exports = { run, addWarning, resetWarning }
