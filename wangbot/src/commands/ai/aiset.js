const Ai = require('../../lib/ai')
const GroupAccess = require('../../lib/group-access')

// Panel konfigurasi Ask AI untuk owner: API key + URL + model (dan kawan-kawannya)
// bisa diisi lewat WhatsApp dan disimpan di data/database.json, jadi tidak perlu
// edit .env / restart bot. Nilai di database menang atas .env.
module.exports = {
  name: 'aiset',
  aliases: ['aiconfig', 'aikonfig'],
  category: 'ai',
  isOwner: true,
  desc: 'Atur API key, URL, dan model AI (Owner).',
  use:
    'status | api <url> | key <apikey> | model <nama> | provider <openai|gemini|auto> | system <teks> | temp <0-2> | maxtokens <n> | timeout <detik> | history <0-40> | header set <Nama> <nilai> | header del <Nama> | on | off | group <on|off> | test | reset',
  run: async (m) => {
    const P = m.config.prefix
    const db = m.db
    const s = Ai.store(db)
    const [sub, ...rest] = (m.args || '').split(/\s+/)
    const value = rest.join(' ')
    const cfg = Ai.resolve(db)

    if (!sub || sub === 'status') return m.reply(statusText(m, cfg))

    // ---- saklar fitur ----
    if (sub === 'on' || sub === 'off' || sub === 'enable' || sub === 'disable') {
      s.enabled = sub === 'on' || sub === 'enable'
      db.save()
      return m.reply(`${s.enabled ? '✅' : '⏸️'} Ask AI *${s.enabled ? 'diaktifkan' : 'dinonaktifkan'}*.`)
    }
    if (sub === 'group') {
      const mode = String(rest[0] || '').toLowerCase()
      if (mode !== 'on' && mode !== 'off') return m.reply(`Contoh: \`${P}aiset group off\``)
      s.allowGroup = mode === 'on'
      db.save()
      const groups = GroupAccess.listGroups(db).filter((g) => g.ai).length
      return m.reply(
        `${s.allowGroup ? '✅' : '🚫'} Ask AI di grup: *${s.allowGroup ? 'diizinkan' : 'hanya chat pribadi'}*.\n` +
          (s.allowGroup
            ? `Hanya grup yang masuk allowlist owner yang benar-benar bisa memakai — saat ini ${groups} grup.\nDetail: \`${P}groupaccess\``
            : `Saklar global ini memotong semua grup, walau grup sudah diizinkan.`)
      )
    }

    // ---- header tambahan ----
    if (sub === 'header') {
      const act = String(rest[0] || '').toLowerCase()
      if (act === 'list') {
        const ks = Object.keys(s.headers)
        return m.reply(ks.length ? '🧾 Header tambahan:\n' + ks.map((k) => `• ${k}: ${Ai.mask(s.headers[k])}`).join('\n') : 'Tidak ada header tambahan.')
      }
      if (act === 'set') {
        const [name, ...v] = rest.slice(1)
        const r = Ai.setHeader(db, name, v.join(' '))
        return m.reply(r.ok ? `✅ Header ${r.shown}` : '❌ ' + r.error)
      }
      if (act === 'del' || act === 'rm') {
        const r = Ai.delHeader(db, rest[1])
        return m.reply(r.ok ? `✅ Header ${r.shown} dihapus.` : '❌ ' + r.error)
      }
      return m.reply(`Contoh:\n\`${P}aiset header set HTTP-Referer https://wangstore.id\`\n\`${P}aiset header del HTTP-Referer\``)
    }

    // ---- uji koneksi ----
    if (sub === 'test' || sub === 'cek') {
      const chk = Ai.ready(cfg)
      if (!chk.ok) return m.reply(chk.error)
      await m.react('⏳').catch(() => {})
      const res = await Ai.ask(db, [
        { role: 'system', content: cfg.system },
        { role: 'user', content: 'Balas tepat dengan kata: OK' },
      ])
      if (!res.ok) return m.reply(`❌ Tes gagal:\n${res.error}`)
      return m.reply(
        `✅ Koneksi AI berhasil (${res.ms} ms).\nProvider : ${res.provider}\nEndpoint : ${
          res.provider === 'gemini' ? Ai.geminiEndpoint(cfg).split('?')[0] : Ai.openaiEndpoint(cfg)
        }\nModel    : ${res.model}\nJawaban  : ${res.text.slice(0, 120)}`
      )
    }

    if (sub === 'reset') {
      Ai.reset(db)
      return m.reply('♻️ Konfigurasi AI di database dihapus. Sekarang bot memakai nilai dari .env (atau default).')
    }

    // ---- nilai konfigurasi ----
    const map = {
      api: 'baseUrl',
      url: 'baseUrl',
      base: 'baseUrl',
      baseurl: 'baseUrl',
      key: 'apiKey',
      apikey: 'apiKey',
      token: 'apiKey',
      model: 'model',
      provider: 'provider',
      system: 'system',
      prompt: 'system',
      temp: 'temperature',
      temperature: 'temperature',
      maxtokens: 'maxTokens',
      maxtoken: 'maxTokens',
      timeout: 'timeout',
      history: 'history',
      memori: 'history',
      maxchars: 'maxChars',
    }
    const key = map[sub.toLowerCase()]

    // Sisa teks setelah token pertama, apa adanya (system prompt boleh multi-baris).
    const restRaw = (m.args || '').replace(/^\S+[ \t]*/, '')
    const raw = key === 'system' ? restRaw : restRaw.trim() || value
    if (!key) {
      return m.reply(
        `🧠 *ATUR ASK AI*\n\n` +
          `Pengaturan utama (semua wajib):\n` +
          `  ${P}aiset api https://api.openai.com/v1\n` +
          `  ${P}aiset key sk-xxxxxxxx\n` +
          `  ${P}aiset model gpt-4o-mini\n\n` +
          `Opsional:\n` +
          `  ${P}aiset provider openai|gemini|auto\n` +
          `  ${P}aiset system <peran AI>\n` +
          `  ${P}aiset temp 0.4 | maxtokens 900 | timeout 45\n` +
          `  ${P}aiset history 8 (0 = tanpa memori)\n` +
          `  ${P}aiset maxchars 1500\n` +
          `  ${P}aiset header set <Nama> <nilai>\n` +
          `  ${P}aiset group on|off | on | off   # saklar global AI di grup\n` +
          `  grup mana yang boleh + batas role: ${P}groupaccess\n` +
          `  ${P}aiset test | status | reset\n\n` +
          `Contoh penyedia lain ada di docs/AI.md.`
      )
    }

    const r = Ai.set(db, key, raw)
    if (!r.ok) return m.reply('❌ ' + r.error)

    const extra = key === 'apiKey' || key === 'baseUrl' || key === 'model' ? suggestNext(m, Ai.resolve(db)) : ''
    return m.reply(`✅ *${key}* = \`${r.shown}\`${extra}`)
  },
}

function suggestNext(m, cfg) {
  const chk = Ai.ready(cfg)
  if (chk.ok) return `\n\nSiap dipakai — coba \`${m.config.prefix}aiset test\`.`
  return `\n\nMasih kurang: ${chk.missing.join(', ')}`
}

function statusText(m, cfg) {
  const P = m.config.prefix
  const src = Ai.sources(m.db)
  const tag = (k) => (src[k] === 'db' ? 'db' : src[k] === 'env' ? 'env' : 'default')
  const chk = Ai.ready(cfg)
  const usage = cfg.usage || {}

  let t = '🧠 *KONFIGURASI ASK AI*\n\n'
  t += `Status   : ${cfg.enabled ? '✅ AKTIF' : '⏸️ NONAKTIF'} ${tag('enabled')}\n`
  t += `Di grup  : ${cfg.allowGroup ? `✅ boleh — ${GroupAccess.listGroups(m.db).filter((g) => g.ai).length} grup diizinkan` : '🚫 chat pribadi saja'} ${tag('allowGroup')}\n`
  t += `Provider : ${cfg.provider} ${tag('provider')}\n`
  t += `API URL  : ${cfg.baseUrl || '-'} ${tag('baseUrl')}\n`
  t += `API key  : ${Ai.mask(cfg.apiKey)} ${tag('apiKey')}\n`
  t += `Model    : ${cfg.model || '-'} ${tag('model')}\n`
  t += `System   : ${cfg.system ? cfg.system.length + ' karakter' : '-'} ${tag('system')}\n`
  t += `Params   : temp ${cfg.temperature} | maxTokens ${cfg.maxTokens} | timeout ${Math.round(cfg.timeout / 1000)}s ${tag('temperature')}\n`
  t += `Memori   : ${cfg.history ? cfg.history + ' pesan' : 'nonaktif'} | maks tanya ${cfg.maxChars} karakter\n`
  const hk = Object.keys(Ai.store(m.db).headers || {})
  t += `Header   : ${hk.length ? hk.join(', ') : '-'}\n`
  t += `Pakai    : ${usage.calls || 0} panggilan (${usage.failed || 0} gagal)\n`
  if (usage.lastAt) t += `Terakhir : ${new Date(usage.lastAt).toLocaleString('id-ID')}\n`
  if (usage.lastError) t += `Error terakhir: ${String(usage.lastError).slice(0, 140)}\n`

  t += `\n${chk.ok ? '✅ Konfigurasi lengkap.' : '⚠️ Belum lengkap: ' + (chk.missing.join(', ') || chk.error)}`
  t += `\n\nUbah: \`${P}aiset api|key|model|system|temp|maxtokens|timeout|history|provider|header\`\nUji: \`${P}aiset test\``
  return t
}
