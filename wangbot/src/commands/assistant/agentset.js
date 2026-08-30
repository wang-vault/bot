const Assistant = require('../../lib/assistant')
const Persona = require('../../lib/persona')
const Guardian = require('../../lib/guardian')
const GroupAccess = require('../../lib/group-access')

module.exports = {
  name: 'agentset',
  aliases: ['asistenset', 'agentconfig'],
  category: 'assistant',
  isOwner: true,
  isPrivate: true,
  desc: 'Atur otonomi, auto-chat, memori, dan penjaga kode Personal Agent.',
  // Akses per grup (allowlist + role) sengaja TIDAK di sini: diatur lewat
  // .groupaccess karena berlaku juga untuk Ask AI, dan hanya owner yang boleh.
  groupAccess: true,
  use: 'status | on|off | mode <chat|supervised|safe|autonomous> | autochat <on|off> | guardian <on|off> | interval <menit> | errors <on|off> | healthy <on|off> | memory | remember <key> <isi> | forget <key> | clearhistory | pending',
  run: async (m) => {
    const raw = String(m.args || '').trim()
    const parts = raw.split(/\s+/).filter(Boolean)
    const sub = String(parts.shift() || '').toLowerCase()
    const P = m.config.prefix

    if (!sub || sub === 'status') return m.reply(statusText(m))
    if (sub === 'on' || sub === 'off') {
      Assistant.setOption(m.db, 'enabled', sub === 'on')
      return m.reply(`${sub === 'on' ? '✅' : '⏸️'} Personal Agent *${sub === 'on' ? 'aktif' : 'nonaktif'}*.`)
    }
    if (sub === 'mode') {
      const result = Assistant.setOption(m.db, 'mode', parts[0])
      if (!result.ok) return m.reply('❌ ' + result.error)
      return m.reply(`✅ Mode otonomi: *${result.value}*.\n${modeExplanation(result.value)}`)
    }
    if (sub === 'autochat') {
      const value = onOff(parts[0])
      if (value === null) return m.reply(`Contoh: \`${P}agentset autochat on\``)
      Assistant.setOption(m.db, 'autoChat', value)
      const groupAuto = GroupAccess.resolve(m.db).autoReply
      return m.reply(
        value
          ? `✅ Auto-chat aktif. Pesan biasa dari owner di chat pribadi langsung ditangani asisten tanpa prefix.\n` +
            `Di grup: ${groupAuto ? '✅ auto-reply aktif untuk grup yang mengizinkannya (\`' + P + 'groupaccess autochat on <jid>\`) — default harus tag bot.' : '🚫 masih mati. Nyalakan per grup lewat `' + P + 'groupaccess autochat on <jid>`.'}`
          : `⏸️ Auto-chat nonaktif (private & grup). Gunakan \`${P}asisten <instruksi>\`.`
      )
    }
    if (sub === 'guardian') {
      const value = onOff(parts[0])
      if (value === null) return m.reply(`Contoh: \`${P}agentset guardian on\``)
      Guardian.setOption(m.db, 'enabled', value)
      Guardian.refresh()
      return m.reply(`${value ? '✅' : '⏸️'} Penjaga kode otomatis *${value ? 'aktif' : 'nonaktif'}*.`)
    }
    if (sub === 'interval') {
      const result = Guardian.setOption(m.db, 'intervalMinutes', parts[0])
      if (!result.ok) return m.reply('❌ ' + result.error)
      Guardian.refresh()
      return m.reply(`✅ Self-check otomatis setiap *${result.value} menit*.`)
    }
    if (sub === 'errors' || sub === 'healthy') {
      const value = onOff(parts[0])
      if (value === null) return m.reply(`Contoh: \`${P}agentset ${sub} on\``)
      const key = sub === 'errors' ? 'runtimeErrors' : 'reportHealthy'
      Guardian.setOption(m.db, key, value)
      Guardian.refresh()
      return m.reply(
        sub === 'errors'
          ? `${value ? '✅' : '⏸️'} Laporan error runtime: *${value ? 'aktif' : 'nonaktif'}*.`
          : `${value ? '✅' : '⏸️'} Laporan berkala saat sehat: *${value ? 'aktif' : 'nonaktif'}*.`
      )
    }
    if (sub === 'pending') return m.reply(Assistant.formatPending(m.db, P))
    if (sub === 'group' || sub === 'grup') {
      if (!parts.length) return m.reply(GroupAccess.statusText(m))
      return m.reply(
        `🗂️ Pengaturan akses grup ada di command khusus owner:\n` +
          `• ${P}groupaccess add <jid>        # izinkan satu grup\n` +
          `• ${P}groupaccess role admin <jid> # batas role di grup itu\n` +
          `• ${P}groupaccess tools read <jid> # alat yang boleh dipakai di grup\n` +
          `• ${P}groupaccess listgrup         # lihat JID grup yang bot ikuti`
      )
    }
    if (sub === 'memory' || sub === 'memori') return m.reply(memoryText(m))
    if (sub === 'remember' || sub === 'ingat') {
      const key = parts.shift()
      const value = parts.join(' ')
      const result = Persona.remember(m.db, key, value)
      return m.reply(result.ok ? `🧠 Diingat: *${result.key}* = ${result.value}` : '❌ ' + result.error)
    }
    if (sub === 'forget' || sub === 'lupa') {
      if (String(parts[0] || '').toLowerCase() === 'all') {
        const result = Persona.clearMemory(m.db)
        return m.reply(`🧹 ${result.count} memori jangka panjang dihapus.`)
      }
      const result = Persona.forget(m.db, parts[0])
      return m.reply(result.ok ? `🧹 Memori *${result.key}* dihapus.` : '❌ ' + result.error)
    }
    if (sub === 'clearhistory' || sub === 'newchat') {
      const had = Assistant.clearAgentHistory(m.sender)
      return m.reply(had ? '🧹 Riwayat percakapan agent dihapus. Memori jangka panjang tetap ada.' : 'ℹ️ Riwayat agent sudah kosong.')
    }

    return m.reply(helpText(m))
  },
}

function onOff(raw) {
  const value = String(raw || '').toLowerCase()
  if (['on', '1', 'true', 'yes'].includes(value)) return true
  if (['off', '0', 'false', 'no'].includes(value)) return false
  return null
}

function modeExplanation(mode) {
  if (mode === 'chat') return 'Asisten hanya berbicara dan tidak menjalankan command.'
  if (mode === 'supervised') return 'Semua command harus disetujui lewat .approve.'
  if (mode === 'safe') return 'Pemeriksaan baca-saja berjalan otomatis; perubahan harus disetujui.'
  return 'Pemeriksaan dan operasi ringan berjalan otomatis; tindakan sensitif tetap harus disetujui.'
}

function statusText(m) {
  const a = Assistant.resolve(m.db)
  const g = Guardian.status(m.db)
  const p = Persona.resolve(m.db)
  const stats = Assistant.store(m.db).stats || {}
  return (
    `🧭 *PERSONAL AGENT — ${p.name}*\n\n` +
    `Status      : ${a.enabled ? '✅ aktif' : '⏸️ nonaktif'}\n` +
    `Mode        : *${a.mode}*\n` +
    `Auto-chat   : ${a.autoChat ? '✅ on' : '❌ off'}\n` +
    `Guardian    : ${g.enabled ? '✅ on' : '❌ off'} (tiap ${g.intervalMinutes} menit)\n` +
    `Error live  : ${g.runtimeErrors ? '✅ dilaporkan' : '❌ tidak'}\n` +
    `Lapor sehat : ${g.reportHealthy ? '✅ ya' : '❌ tidak'}\n` +
    `Self-check  : ${g.lastRun ? new Date(g.lastRun).toLocaleString('id-ID') : 'belum pernah'}\n` +
    `Hasil akhir : ${g.lastFingerprint || '-'} (${g.lastErrors} error, ${g.lastWarnings} warning)\n` +
    `Memori      : ${Persona.memoryEntries(m.db).length}/50 fakta\n` +
    `Aktivitas   : ${stats.chats || 0} chat | ${stats.actions || 0} tindakan | ${stats.approvals || 0} approval\n` +
    `Pending     : ${Assistant.pendingList(m.db).length}\n` +
    groupLine(m) +
    `\n` +
    modeExplanation(a.mode) +
    `\n\nDetail pengaturan: \`${m.config.prefix}agentset help\``
  )
}

function groupLine(m) {
  const g = GroupAccess.resolve(m.db)
  const rows = GroupAccess.listGroups(m.db)
  if (!g.enabled) return `Akses grup   : ⏸️ dimatikan (hanya chat pribadi)\n`
  return (
    `Akses grup   : ✅ aktif — ${rows.length} grup diizinkan (batas role default: *${g.role}*)\n` +
    `Alat di grup  : ${g.tools} | rute jawaban: ${g.route} | auto-reply: ${g.autoReply ? 'on' : 'off'}\n` +
    `Atur          : \`${m.config.prefix}groupaccess\`\n`
  )
}

function memoryText(m) {
  const items = Persona.memoryEntries(m.db)
  if (!items.length) return `🧠 Belum ada memori. Tambah: \`${m.config.prefix}agentset remember <key> <isi>\``
  let text = `🧠 *MEMORI JANGKA PANJANG* (${items.length}/50)\n\n`
  for (const item of items.slice(0, 30)) text += `• *${item.key}*: ${item.value}\n`
  text += `\nHapus: \`${m.config.prefix}agentset forget <key>\``
  return text.slice(0, 3900)
}

function helpText(m) {
  const P = m.config.prefix
  return (
    `🧭 *ATUR PERSONAL AGENT*\n\n` +
    `${P}agentset status\n` +
    `${P}agentset on|off\n` +
    `${P}agentset mode chat|supervised|safe|autonomous\n` +
    `${P}agentset autochat on|off\n` +
    `${P}agentset guardian on|off\n` +
    `${P}agentset interval 360\n` +
    `${P}agentset errors on|off\n` +
    `${P}agentset healthy on|off\n` +
    `${P}agentset memory\n` +
    `${P}agentset remember <key> <isi>\n` +
    `${P}agentset forget <key>|all\n` +
    `${P}agentset clearhistory\n` +
    `${P}agentset pending
` +
    `${P}agentset group            # ringkasan akses grup (atur: ${P}groupaccess)`
  )
}
