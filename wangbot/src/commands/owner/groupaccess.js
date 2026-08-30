const GroupAccess = require('../../lib/group-access')
const Ai = require('../../lib/ai')
const Assistant = require('../../lib/assistant')

// OWNER ONLY — daftar grup yang boleh menghubungi Personal Agent & Ask AI,
// lengkap dengan batas role per grup. Sengaja TIDAK memakai isPrivate: owner
// juga harus bisa mendaftarkan grup dari dalam grup itu sendiri (`.add` tanpa
// argumen = grup saat ini), dan bisa membalas pesan grup lalu `.add`.
//
// Admin grup tidak punya akses ke command ini: `.groupsetting` untuk mereka,
// allowlist ini khusus owner.
const FEATURE_KEYS = {
  agent: 'agent',
  ai: 'ai',
  mention: 'mention',
  autochat: 'autoReply',
  autoreply: 'autoReply',
}
const ENUM_KEYS = { role: GroupAccess.ROLES, tools: GroupAccess.TOOL_LEVELS, route: GroupAccess.ROUTES }

module.exports = {
  name: 'groupaccess',
  aliases: ['grupaccess', 'aksesgrup', 'gaccess'],
  category: 'owner',
  isOwner: true,
  desc: 'Daftar grup yang boleh menghubungi agent/AI + batas role tiap grup (Owner).',
  use:
    'status | list | listgrup [nama] | add [nama] | del <jid|all> | on|off | enforce <on|off> | agent|ai|mention|autochat <on|off> [jid|all] | role <owner|admin|member|all> [jid|all] | tools <none|read|full> [jid|all] | route <smart|group|private|admin> [jid|all] | note <teks> <jid> | detail <jid> | requests | clearrequests | test [agent|ai] [jid] | clearchat <jid|all> | help',
  run: async (m) => {
    const P = m.config.prefix
    const db = m.db
    const raw = String(m.args || '').trim()
    const parts = raw.split(/\s+/).filter(Boolean)
    const sub = String(parts.shift() || '').toLowerCase()

    if (!sub || sub === 'status' || sub === 'show') return m.reply(GroupAccess.statusText(m))
    if (sub === 'help' || sub === 'bantuan') return m.reply(GroupAccess.helpText(P))

    if (sub === 'list') return m.reply(listText(m))
    if (sub === 'listgrup' || sub === 'grupsaya' || sub === 'mygroups') {
      const rows = await GroupAccess.listJoinedGroups(m.sock, parts.join(' '))
      if (!rows.length) return m.reply('ℹ️ Tidak ada grup yang cocok. Bot harus berada di grup itu untuk melihat JID-nya.')
      const cfg = GroupAccess.resolve(db)
      let t = `👥 *GRUP YANG BOT IKUTI* (${rows.length})\n\n`
      for (const g of rows.slice(0, 25)) {
        t += `${cfg.groups[g.jid] ? '✅' : '⬜'} ${g.subject || '-'} (${g.members} member)\n   \`${g.jid}\`\n`
      }
      if (rows.length > 25) t += `\n… ${rows.length - 25} grup lainnya gunakan filter: \`${P}groupaccess listgrup nama\``
      t += `\n✅ = sudah boleh pakai agent/AI. Daftarkan: \`${P}groupaccess add <jid>\``
      return m.reply(t.slice(0, 3900))
    }

    // ---- saklar global ----
    if (sub === 'on' || sub === 'off' || sub === 'enable' || sub === 'disable') {
      const on = sub === 'on' || sub === 'enable'
      GroupAccess.setGlobal(db, 'enabled', on)
      return m.reply(
        on
          ? `✅ Akses grup aktif. Agent/AI hanya menjawab di grup yang ada di allowlist:\n\`${P}groupaccess list\``
          : `⏸️ Akses grup dimatikan. Agent & Ask AI hanya bisa dipakai di chat pribadi bot.`
      )
    }
    if (sub === 'enforce' || sub === 'allowlist') {
      const value = GroupAccess.onOff(parts[0])
      if (value === null) return m.reply(`Contoh:\n\`${P}groupaccess enforce on\` (hanya grup terdaftar)\n\`${P}groupaccess enforce off\` (semua grup boleh, role tetap dibatasi)`)
      GroupAccess.setGlobal(db, 'enforce', value)
      return m.reply(
        value
          ? `✅ Allowlist wajib. Hanya grup yang didaftarkan owner yang bisa menghubungi agent/AI.`
          : `⚠️ Allowlist dilonggarkan: semua grup boleh, tetapi batas role & saklar fitur tetap berlaku.`
      )
    }

    // ---- tambah / hapus grup ----
    if (sub === 'add' || sub === 'izinkan' || sub === 'pakai') {
      const rest = parts.join(' ').trim()
      const jid = GroupAccess.parseGroupJid(m, findJidToken(rest) || '')
      if (jid && jid.invite) {
        return m.reply(
          '🔗 Link undangan tidak bisa diubah jadi JID tanpa bergabung ke grupnya.\n' +
            `Caranya: buka grup itu, balas salah satu pesannya ke bot, lalu kirim \`${P}groupaccess add\`.\n` +
            `Atau lihat \`${P}groupaccess listgrup\`.`
        )
      }
      if (!jid) {
        return m.reply(
          `❌ Grup target tidak dikenali.\n` +
            `Pakai salah satu ini:\n` +
            `• \`${P}groupaccess add 120363012345678901@g.us\`\n` +
            `• balas/forward pesan dari grup itu lalu \`${P}groupaccess add\`\n` +
            `• ketik command ini dari dalam grup target (tanpa argumen)`
        )
      }
      const givenName = rest.replace(/\b\d{6,}(@g\.us)?\b/, '').trim()
      const name = givenName || (await groupNameOf(m, jid))
      const res = GroupAccess.addGroup(db, jid, { name })
      if (!res.ok) return m.reply('❌ ' + res.error)
      const cfg = res.group
      return m.reply(
        `${res.created ? '✅' : '♻️'} Grup *${cfg.name || jid}* ${res.created ? 'masuk allowlist' : 'sudah terdaftar (diperbarui)'}.\n\n` +
          `Batas role : ${GroupAccess.ROLE_LABEL[cfg.role] || cfg.role}\n` +
          `Agent      : ${cfg.agent ? '✅ boleh' : '🚫 tidak'} | Ask AI: ${cfg.ai ? '✅ boleh' : '🚫 tidak'}\n` +
          `Alat       : ${cfg.tools} | Rute: ${cfg.route}\n` +
          `Auto-reply : ${cfg.autoReply ? '✅ on (harus tag bot)' : '🚫 off'}\n\n` +
          `Ubah: \`${P}groupaccess role admin ${jid}\` · \`${P}groupaccess tools read ${jid}\` · \`${P}groupaccess detail ${jid}\``
      )
    }
    if (sub === 'del' || sub === 'hapus' || sub === 'remove' || sub === 'blokir') {
      const target = String(parts[0] || '').toLowerCase()
      if (target === 'all') {
        const rows = GroupAccess.listGroups(db)
        for (const g of rows) GroupAccess.removeGroup(db, g.jid)
        return m.reply(`🧹 ${rows.length} grup dihapus dari allowlist. Agent/AI bungkam di semua grup.`)
      }
      const jid = GroupAccess.parseGroupJid(m, findJidToken(parts.join(' ')) || '')
      if (!jid || jid.invite) return m.reply(`Contoh: \`${P}groupaccess del 120363012345678901@g.us\``)
      const res = GroupAccess.removeGroup(db, jid)
      return m.reply(res.ok ? `🧹 \`${jid}\` dihapus dari allowlist.` : '❌ ' + res.error)
    }

    // ---- pengaturan (global atau per grup) ----
    const isBoolKey = FEATURE_KEYS[sub]
    const isEnumKey = ENUM_KEYS[sub]
    if (isBoolKey || isEnumKey) {
      const key = isBoolKey ? FEATURE_KEYS[sub] : sub
      const value = parts.shift()
      // Sisa argumen menentukan sasaran: JID = satu grup, `all` = tulis ke semua
      // grup, kosong = ubah default untuk semua grup (tanpa mengunci override).
      const rest = parts.join(' ')
      const scope = findJidToken(rest) || (/(^|\s)all(\s|$)/i.test(rest) ? 'all' : '')
      const result = GroupAccess.setOption(db, scope, key, value)
      if (!result.ok) return m.reply('❌ ' + result.error)
      const where = !scope ? 'default semua grup' : scope === 'all' ? `semua grup (${result.changed.length})` : scope
      // Nilai yang benar-benar berlaku sekarang, untuk balasan yang jujur.
      const effective = !scope
        ? GroupAccess.globals(db)[key]
        : (GroupAccess.resolve(db).groups[result.changed[0]] || {})[key]
      const label = typeof effective === 'boolean' ? (effective ? 'on ✅' : 'off 🚫') : effective
      const hint =
        key === 'role' && GroupAccess.ROLE_LABEL[effective]
          ? `\nArtinya: ${GroupAccess.ROLE_LABEL[effective]}`
          : key === 'tools' && GroupAccess.TOOL_LABEL[effective]
            ? `\nArtinya: ${GroupAccess.TOOL_LABEL[effective]}`
            : key === 'route' && GroupAccess.ROUTE_LABEL[effective]
              ? `\nArtinya: ${GroupAccess.ROUTE_LABEL[effective]}`
              : ''
      return m.reply(
        `✅ \`${key}\` = *${label === undefined ? value : label}* untuk *${where}*.` +
          hint +
          (scope && scope !== 'all' ? `\n${GroupAccess.groupDetail(db, scope)}` : '')
      )
    }
    if (sub === 'jeda' || sub === 'pause' || sub === 'resume' || sub === 'enabled') {
      // Aktif/nonaktifkan sementara satu grup tanpa menghapusnya dari allowlist.
      const rest = parts.join(' ')
      const value = sub === 'resume' ? 'on' : sub === 'pause' ? 'off' : parts.shift()
      const jid = findJidToken(rest)
      const result = GroupAccess.setOption(db, jid || (m.isGroup ? m.chat : ''), 'enabled', value)
      if (!result.ok) return m.reply('❌ ' + result.error + `\nContoh: \`${P}groupaccess jeda on|off [jid]\``)
      const on = (GroupAccess.resolve(db).groups[result.changed[0]] || {}).enabled
      return m.reply(`✅ Grup *${result.changed[0]}* sekarang ${on ? 'aktif' : 'dijeda'} untuk agent & Ask AI.`)
    }
    if (sub === 'note' || sub === 'catatan') {
      const jid = findJidToken(parts.join(' '))
      const text = parts.join(' ').replace(/\b\d{6,}(@g\.us)?\b/, '').trim()
      if (!text) return m.reply(`Contoh: \`${P}groupaccess note grup support <jid>\``)
      const result = GroupAccess.setOption(db, jid || (m.isGroup ? m.chat : ''), 'note', text)
      return m.reply(result.ok ? `📝 Catatan disimpan untuk ${result.changed[0]}.` : '❌ ' + result.error)
    }
    if (sub === 'detail' || sub === 'lihat') {
      const jid = GroupAccess.parseGroupJid(m, findJidToken(parts.join(' ')) || '')
      if (!jid || jid.invite) return m.reply(`Contoh: \`${P}groupaccess detail <jid>\` atau ketik dari dalam grupnya.`)
      return m.reply(GroupAccess.groupDetail(db, jid))
    }
    if (sub === 'requests' || sub === 'permintaan') {
      const rows = GroupAccess.listRequests(db)
      if (!rows.length) return m.reply('✅ Tidak ada permintaan akses yang menunggu.')
      let t = `🔔 *PERMINTAAN AKSES DI GRUP* (${rows.length})\n\n`
      for (const r of rows.slice(0, 20)) {
        t += `• ${r.name || '-'}\n   \`${r.jid}\`\n   ${r.count || 1}x mencoba *${r.feature || 'agent'}* · ${new Date(r.lastAt || 0).toLocaleString('id-ID')}\n   \`${P}groupaccess add ${r.jid}\`\n`
      }
      t += `\nBersihkan: \`${P}groupaccess clearrequests\``
      return m.reply(t.slice(0, 3900))
    }
    if (sub === 'clearrequests' || sub === 'luparequest') {
      const jid = GroupAccess.parseGroupJid(m, findJidToken(parts.join(' ')) || '')
      const n = GroupAccess.clearRequests(db, GroupAccess.isGroupJid(jid) ? jid : undefined)
      return m.reply(`🧹 ${n} permintaan akses dibersihkan.`)
    }
    if (sub === 'test' || sub === 'cek') {
      const feature = ['agent', 'ai'].includes(String(parts[0] || '').toLowerCase()) ? parts.shift().toLowerCase() : 'agent'
      const jid = GroupAccess.parseGroupJid(m, findJidToken(parts.join(' ')) || '')
      if (!GroupAccess.isGroupJid(jid)) return m.reply(`Contoh: \`${P}groupaccess test agent 120363...@g.us\` atau ketik dari dalam grupnya.`)
      const probe = { ...m, chat: jid, isGroup: true, groupName: await groupNameOf(m, jid) }
      const gate = GroupAccess.check(probe, feature)
      const cfg = GroupAccess.resolve(db)
      const group = cfg.groups[jid]
      let t = `🧪 *UJI AKSES GRUP*\n\nGrup : ${probe.groupName || '-'}\n\`${jid}\`\nFitur: ${feature}\n`
      t += `Hasil: ${gate.ok ? '✅ BOLEH' : '⛔ DITOLAK'}${gate.code ? ` (${gate.code})` : ''}\n`
      t += `Peran kamu: ${GroupAccess.roleLabel(gate.role)} | batas grup: ${group ? group.role : cfg.role}\n`
      if (group) t += `\n${GroupAccess.groupDetail(db, jid)}`
      else t += `\n⚠️ Grup ini belum masuk allowlist. Tambah: \`${P}groupaccess add ${jid}\``
      if (!gate.ok && gate.message) t += `\n\nPesan yang dilihat user:\n${gate.message}`
      return m.reply(t.slice(0, 3900))
    }
    if (sub === 'clearchat' || sub === 'resetriwayat') {
      const scope = String(parts[0] || '').toLowerCase()
      const rows = scope === 'all' ? GroupAccess.listGroups(db).map((g) => g.jid) : [GroupAccess.parseGroupJid(m, findJidToken(parts.join(' ')) || '')]
      const targets = rows.filter((x) => GroupAccess.isGroupJid(x))
      if (!targets.length) return m.reply(`Contoh: \`${P}groupaccess clearchat <jid>\` (atau \`all\`)`)
      for (const jid of targets) {
        Ai.clearHistory(jid)
        Assistant.clearAgentHistory(`agent:${jid}`)
      }
      return m.reply(`🧹 Riwayat AI & agent di ${targets.length} grup dihapus.`)
    }

    return m.reply(GroupAccess.helpText(P))
  },
}

// Jid grup di dalam argumen: bentuk `1203...@g.us` atau angka panjang.
function findJidToken(text) {
  const tokens = String(text || '').split(/\s+/).filter(Boolean)
  for (const token of tokens) {
    if (/@g\.us$/i.test(token)) return token
    const digits = token.replace(/[^0-9]/g, '')
    if (digits.length >= 8 && !/[a-z]/i.test(token)) return `${digits}@g.us`
  }
  return ''
}

async function groupNameOf(m, jid) {
  if (m.isGroup && m.chat === jid && m.groupName) return m.groupName
  try {
    const meta = m.sock && typeof m.sock.groupMetadata === 'function' ? await m.sock.groupMetadata(jid) : null
    return (meta && meta.subject) || ''
  } catch (_) {
    return ''
  }
}

function listText(m) {
  const rows = GroupAccess.listGroups(m.db)
  const P = m.config.prefix
  if (!rows.length) return `Belum ada grup di allowlist.\nTambah: \`${P}groupaccess add <jid>\` atau \`${P}groupaccess listgrup\``
  let t = `🗂️ *GRUP YANG DIIZINKAN* (${rows.length}/${GroupAccess.LIMITS.groups})\n\n`
  for (const g of rows) {
    t += `• ${g.name || g.jid}\n`
    t += `  \`${g.jid}\`\n`
    t += `  ${g.enabled ? '✅ aktif' : '⏸️ jeda'} | agent ${g.agent ? '✅' : '🚫'} | ai ${g.ai ? '✅' : '🚫'}\n`
    t += `  role ${g.role} | alat ${g.tools} | rute ${g.route}${g.autoReply ? ' | auto-reply ✅' : ''}\n`
    if (g.note) t += `  📝 ${g.note}\n`
  }
  t += `\nUbah per grup: \`${P}groupaccess role admin <jid>\``
  return t.slice(0, 3900)
}
