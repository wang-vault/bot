const Ai = require('../../lib/ai')
const Persona = require('../../lib/persona')
const GroupAccess = require('../../lib/group-access')
const Routing = require('../../lib/routing')

// Tanya AI. Penyedia & API key-nya diatur owner lewat .env / .aiset, jadi
// command ini tidak peduli vendor apa yang dipakai di belakangnya.
//
// Di grup, AI hanya menjawab bila:
//   1. saklar global AI di grup aktif (.aiset group on), dan
//   2. grup itu masuk allowlist owner (.groupaccess add), dan
//   3. peran penanya memenuhi batas role grup tersebut.
module.exports = {
  name: 'ai',
  aliases: ['ask', 'askai', 'aiask', 'tanya', 'gpt', 'chatgpt'],
  category: 'ai',
  desc: 'Tanya AI (butuh API key yang diisi owner).',
  use: '<pertanyaan>  |  reply pesan lalu ketik .ai',
  cooldown: 8,
  run: async (m) => {
    const cfg = Ai.resolve(m.db)

    if (!cfg.enabled) {
      return m.reply('🧠 Fitur *Ask AI* sedang dinonaktifkan owner.')
    }
    let group = null
    if (m.isGroup) {
      if (!cfg.allowGroup) {
        return m.reply('🧠 *Ask AI* hanya bisa dipakai di chat pribadi bot.\nKirim pertanyaanmu langsung ke nomor bot ini.')
      }
      const gate = GroupAccess.check(m, 'ai')
      if (!gate.ok) {
        if (gate.code === 'not-allowed') {
          try {
            GroupAccess.recordAttempt(m, 'ai', { prefix: m.config.prefix })
          } catch (_) {}
        }
        return m.reply(gate.message)
      }
      group = gate.group
    }

    // Sumber pertanyaan: argumen, atau pesan yang di-reply.
    const question = (m.args || (m.quoted && m.quoted.body) || '').trim()
    if (!question) return m.reply(helpText(m, cfg, group))
    if (question.length > cfg.maxChars) {
      return m.reply(`⚠️ Pertanyaan terlalu panjang (${question.length}/${cfg.maxChars} karakter). Ringkas dulu ya.`)
    }

    const chk = Ai.ready(cfg)
    if (!chk.ok) return m.reply(chk.error)

    await m.react('🧠').catch(() => {})
    await setTyping(m, true)

    const system = Persona.systemPrompt(m.db, cfg.system, {
      isOwner: m.isOwner,
      isGroup: m.isGroup,
      groupName: m.groupName,
      memoryAllowed: !m.isGroup && !!m.isOwner,
    })
    const res = await Ai.askChat(m.db, m.chat, question, { system })
    await setTyping(m, false)

    if (!res.ok) return m.reply(`❌ ${res.error}`)

    const meta = `\n\n_🧠 ${res.model} · ${(res.ms / 1000).toFixed(1)}s · ${m.config.prefix}aiclear untuk mulai topik baru_`
    if (m.isGroup) {
      // Obrolan umum tetap tampil di grup; jawaban soal server/hosting/data
      // internal dikirim ke chat privat owner (+ penanya) lewat Routing.
      await Routing.deliver(m, res.text + meta, { group, label: Persona.resolve(m.db).name })
      return null
    }
    return m.reply(res.text + meta)
  },
}

function helpText(m, cfg, group) {
  const p = m.config.prefix
  const status = Ai.ready(cfg).ok
    ? `✅ Aktif — model *${cfg.model}* (${cfg.provider})`
    : `⚠️ Belum lengkap: ${Ai.ready(cfg).missing.join(', ') || 'cek konfigurasi'}`
  const groupLine = group
    ? `\n👥 Grup ini: batas role *${group.role}* | rute jawaban *${group.route}*\n   (diatur owner: ${p}groupaccess)\n`
    : ''
  return (
    '🧠 *ASK AI*\n\n' +
    `Tanya apa saja:\n` +
    `  ${p}ai cara restart server minecraft\n` +
    `  ${p}ai bedanya vps dan dedicated server\n` +
    `  ${p}ai (reply sebuah pesan) → AI menjawab pesan itu\n\n` +
    `${p}aiclear — lupakan obrolan sebelumnya\n` +
    groupLine +
    `\nStatus: ${status}\n` +
    `Memori: ${cfg.history ? cfg.history + ' pesan terakhir' : 'nonaktif'}` +
    (m.isOwner ? `\n\n👑 Atur API key & model: ${p}aiset | akses grup: ${p}groupaccess` : '')
  )
}

// Indikator "sedang mengetik" — opsional, gagal pun tidak boleh mematikan jawaban.
async function setTyping(m, on) {
  try {
    if (m.sock && typeof m.sock.sendPresenceUpdate === 'function') {
      if (on && typeof m.sock.presenceSubscribe === 'function') await m.sock.presenceSubscribe(m.chat)
      await m.sock.sendPresenceUpdate(on ? 'composing' : 'paused', m.chat)
    }
  } catch (_) {}
}
