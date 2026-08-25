module.exports = {
  name: 'broadcast',
  aliases: ['bc', 'bcall'],
  category: 'broadcast',
  isOwner: true,
  desc: 'Broadcast pesan ke semua grup / grup tertentu.',
  use: '<teks> | here <teks> | <teks> (reply media)',
  run: async (m) => {
    const raw = m.args || ''
    let hereOnly = false
    let text = raw
    if (raw.toLowerCase().startsWith('here ')) {
      hereOnly = true
      text = raw.slice(5).trim()
    }
    if (!text && !m.quoted) return m.reply('Contoh: ' + m.config.prefix + 'broadcast Pengumuman...\nAtau: ' + m.config.prefix + 'broadcast here pesan untuk grup ini')

    const header = `📡 *BROADCAST ${m.config.botName}*\n\n`
    const message = header + (text || '')

    // Tentukan target grup
    let targets = []
    if (hereOnly) {
      if (!m.isGroup) return m.reply('Command "here" hanya di grup.')
      targets = [m.chat]
    } else {
      const storeGroups =
        m.sock.store && m.sock.store.groupMetadata ? [...m.sock.store.groupMetadata.keys()] : []
      const dbGroups = Object.keys(m.db.data.groups).filter((j) => j.endsWith('@g.us'))
      targets = [...new Set([...storeGroups, ...dbGroups])].filter(
        (j) => j.endsWith('@g.us') && !m.db.data.blacklist.groups.includes(j)
      )
    }

    if (!targets.length) return m.reply('ℹ️ Tidak ada grup target.')

    // Batasi per batch demi keamanan nomor (anti-flag WhatsApp)
    // pakai Number.isFinite + batas eksplisit: sebelumnya `|| 20` dan `|| 5`
    // membuat nilai 0 di .env (BROADCAST_DELAY=0) dianggap "tidak diisi"
    // dan jatuh ke default, jadi jeda tidak pernah bisa dinolkan.
    const batch = m.config.broadcastBatch > 0 ? m.config.broadcastBatch : 20
    const baseDelay = m.config.broadcastDelay >= 0 ? m.config.broadcastDelay * 1000 : 5000
    // Urutan target dibuat stabil lalu dilanjutkan dari kursor terakhir,
    // supaya command yang diulang mengirim ke grup SISANYA (sebelumnya
    // selalu 20 grup pertama yang sama, sisanya tidak pernah terkirim).
    targets.sort()
    const start = (m.db.data.broadcastCursor || 0) % targets.length
    const toSend = []
    for (let i = 0; i < Math.min(batch, targets.length); i++) {
      toSend.push(targets[(start + i) % targets.length])
    }
    if (targets.length > batch) {
      await m.reply(
        `⚠️ Ada ${targets.length} grup. Demi keamanan nomor (anti banned), ` +
          `bot kirim bertahap max ${batch} grup, jeda ~${Math.round(baseDelay / 1000)} detik/pesan. ` +
          `Ulangi command untuk lanjut ke grup berikutnya.`
      )
    }

    // Jika reply media, siapkan konten
    let mediaContent = null
    if (m.quoted && m.quoted.media) {
      const buf = await m.quoted.download()
      if (buf && buf.length) {
        if (m.quoted.media.type === 'image') mediaContent = { image: buf, caption: message }
        else if (m.quoted.media.type === 'video') mediaContent = { video: buf, caption: message }
      }
    }

    let sent = 0
    for (let i = 0; i < toSend.length; i++) {
      const jid = toSend[i]
      try {
        if (mediaContent) await m.sock.sendMessage(jid, mediaContent)
        else await m.sock.sendMessage(jid, { text: message })
        sent++
        // jeda ACAK anti-flag (80%-150% dari base), kecuali pesan terakhir
        if (i < toSend.length - 1) {
          const jitter = baseDelay * (0.8 + Math.random() * 0.7)
          await new Promise((r) => setTimeout(r, jitter))
        }
      } catch (e) {
        console.error('bc err', jid, e.message)
      }
    }
    // simpan kursor supaya broadcast berikutnya menyambung ke grup lain
    m.db.data.broadcastCursor = (start + toSend.length) % targets.length
    m.db.save()

    const sisa = targets.length - toSend.length
    await m.reply(
      `✅ Broadcast terkirim ke *${sent}/${toSend.length}* grup.` +
        (sisa > 0 ? `\n\n⏳ Sisa ${sisa} grup belum terkirim (batas batch ${batch}). Ulangi command untuk lanjut.` : '')
    )
  },
}
