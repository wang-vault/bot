const Persona = require('../../lib/persona')

module.exports = {
  name: 'persona',
  aliases: ['kepribadian', 'identity', 'identitas'],
  category: 'assistant',
  isOwner: true,
  isPrivate: true,
  desc: 'Lihat dan bentuk nama, peran, sifat, serta gaya bicara asisten.',
  use: 'status | name <nama> | owner <panggilan> | role <peran> | traits <sifat> | style <gaya> | reset',
  run: async (m) => {
    const raw = String(m.args || '').trim()
    const split = raw.search(/\s/)
    const sub = (split < 0 ? raw : raw.slice(0, split)).toLowerCase()
    const value = split < 0 ? '' : raw.slice(split + 1).trim()
    const P = m.config.prefix

    if (!sub || sub === 'status' || sub === 'show') return m.reply(statusText(m))
    if (sub === 'reset') {
      Persona.reset(m.db)
      return m.reply('♻️ Kepribadian dikembalikan ke nilai .env/default. Memori jangka panjang tidak dihapus.')
    }

    const map = {
      name: 'name',
      nama: 'name',
      owner: 'ownerName',
      panggilan: 'ownerName',
      role: 'role',
      peran: 'role',
      traits: 'traits',
      sifat: 'traits',
      style: 'style',
      gaya: 'style',
    }
    const key = map[sub]
    if (!key) {
      return m.reply(
        `🪪 *ATUR KEPRIBADIAN*\n\n` +
          `${P}persona name Aruna\n` +
          `${P}persona owner Wang\n` +
          `${P}persona role asisten pribadi dan penjaga serverku\n` +
          `${P}persona traits proaktif, tegas, humoris, dan jujur\n` +
          `${P}persona style santai, singkat, pakai bahasa Indonesia\n` +
          `${P}persona reset`
      )
    }
    const result = Persona.set(m.db, key, value)
    if (!result.ok) return m.reply('❌ ' + result.error)
    return m.reply(`✅ *${key}* diperbarui menjadi:\n${result.value}`)
  },
}

function statusText(m) {
  const p = Persona.resolve(m.db)
  const memories = Persona.memoryEntries(m.db)
  return (
    `🪪 *IDENTITAS PERSONAL AGENT*\n\n` +
    `Nama     : *${p.name}*\n` +
    `Owner    : ${p.ownerName}\n` +
    `Peran    : ${p.role}\n` +
    `Sifat    : ${p.traits}\n` +
    `Gaya     : ${p.style}\n` +
    `Memori   : ${memories.length}/50 fakta\n\n` +
    `Ubah dengan \`${m.config.prefix}persona name|owner|role|traits|style <teks>\`.`
  )
}
