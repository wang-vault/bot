const config = require('../config')

// Identitas WangBot dipisahkan dari konfigurasi provider AI. Dengan begitu
// kepribadian tetap konsisten walaupun owner mengganti OpenAI/Groq/Gemini.
const DEFAULTS = Object.freeze({
  name: '', // kosong = mengikuti BOT_NAME
  ownerName: 'Owner',
  role: 'asisten pribadi owner sekaligus penjaga operasional WangStore',
  traits: 'proaktif, tenang, jujur, teliti, loyal, dan berani mengingatkan jika ada risiko',
  style: 'Bahasa Indonesia yang natural, hangat, ringkas, dan tidak kaku',
})

const LIMITS = Object.freeze({
  name: 40,
  ownerName: 60,
  role: 500,
  traits: 500,
  style: 500,
})

function assistantStore(db) {
  if (!db || !db.data) return null
  if (!db.data.assistant || typeof db.data.assistant !== 'object') db.data.assistant = {}
  const a = db.data.assistant
  if (!a.persona || typeof a.persona !== 'object') a.persona = {}
  if (!a.memory || typeof a.memory !== 'object' || Array.isArray(a.memory)) a.memory = {}
  return a
}

function envValues() {
  return {
    name: process.env.ASSISTANT_NAME || '',
    ownerName: process.env.ASSISTANT_OWNER_NAME || '',
    role: process.env.ASSISTANT_ROLE || '',
    traits: process.env.ASSISTANT_TRAITS || '',
    style: process.env.ASSISTANT_STYLE || '',
  }
}

function first(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim()
  }
  return ''
}

function resolve(db) {
  const a = assistantStore(db) || { persona: {}, memory: {} }
  const p = a.persona || {}
  const env = envValues()
  return {
    name: first(p.name, env.name, DEFAULTS.name, config.botName),
    ownerName: first(p.ownerName, env.ownerName, DEFAULTS.ownerName),
    role: first(p.role, env.role, DEFAULTS.role),
    traits: first(p.traits, env.traits, DEFAULTS.traits),
    style: first(p.style, env.style, DEFAULTS.style),
  }
}

function set(db, key, rawValue) {
  const a = assistantStore(db)
  if (!a) return { ok: false, error: 'Database tidak tersedia.' }
  if (!Object.prototype.hasOwnProperty.call(LIMITS, key)) {
    return { ok: false, error: `Bagian persona "${key}" tidak dikenal.` }
  }
  const value = String(rawValue || '').trim()
  if (!value) return { ok: false, error: `Nilai *${key}* tidak boleh kosong.` }
  if (value.length > LIMITS[key]) {
    return { ok: false, error: `Nilai *${key}* terlalu panjang (maksimal ${LIMITS[key]} karakter).` }
  }
  a.persona[key] = value
  db.save()
  return { ok: true, key, value }
}

function reset(db) {
  const a = assistantStore(db)
  if (!a) return { ok: false, error: 'Database tidak tersedia.' }
  a.persona = { name: '', ownerName: '', role: '', traits: '', style: '' }
  db.save()
  return { ok: true }
}

function memoryEntries(db) {
  const a = assistantStore(db)
  if (!a) return []
  return Object.entries(a.memory || {})
    .map(([key, item]) => {
      if (item && typeof item === 'object') {
        return { key, value: String(item.value || ''), updatedAt: Number(item.updatedAt || 0) }
      }
      return { key, value: String(item || ''), updatedAt: 0 }
    })
    .filter((item) => item.key && item.value)
    .sort((x, y) => y.updatedAt - x.updatedAt)
}

function looksSensitive(key, value) {
  const joined = `${key} ${value}`.toLowerCase()
  if (/\b(api.?key|token|password|passwd|secret|authorization|bearer|cookie|session)\b/i.test(joined)) return true
  if (/\b(sk-[a-z0-9_-]{12,}|gsk_[a-z0-9_-]{12,}|AIza[a-z0-9_-]{12,})\b/i.test(String(value))) return true
  return false
}

function normalizeMemoryKey(raw) {
  const key = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  // Hindari special property setter pada object biasa.
  return ['__proto__', 'prototype', 'constructor'].includes(key) ? '' : key
}

function remember(db, rawKey, rawValue) {
  const a = assistantStore(db)
  if (!a) return { ok: false, error: 'Database tidak tersedia.' }
  const key = normalizeMemoryKey(rawKey)
  const value = String(rawValue || '').trim().slice(0, 500)
  if (!key || !value) return { ok: false, error: 'Key dan isi memori wajib diisi.' }
  if (looksSensitive(key, value)) {
    return { ok: false, error: 'Memori menolak password, token, API key, atau rahasia lain.' }
  }
  const entries = memoryEntries(db)
  if (!Object.prototype.hasOwnProperty.call(a.memory, key) && entries.length >= 50) {
    // Buang fakta terlama agar database tidak tumbuh tanpa batas.
    const oldest = entries[entries.length - 1]
    if (oldest) delete a.memory[oldest.key]
  }
  a.memory[key] = { value, updatedAt: Date.now() }
  db.save()
  return { ok: true, key, value }
}

function forget(db, rawKey) {
  const a = assistantStore(db)
  if (!a) return { ok: false, error: 'Database tidak tersedia.' }
  const key = normalizeMemoryKey(rawKey)
  if (!key || !Object.prototype.hasOwnProperty.call(a.memory, key)) {
    return { ok: false, error: `Memori "${rawKey || '-'}" tidak ditemukan.` }
  }
  delete a.memory[key]
  db.save()
  return { ok: true, key }
}

function clearMemory(db) {
  const a = assistantStore(db)
  if (!a) return { ok: false, error: 'Database tidak tersedia.' }
  const count = Object.keys(a.memory || {}).length
  a.memory = {}
  db.save()
  return { ok: true, count }
}

function memoryText(db, max = 20) {
  const items = memoryEntries(db).slice(0, max)
  if (!items.length) return '(belum ada memori jangka panjang)'
  return items.map((item) => `- ${item.key}: ${item.value}`).join('\n')
}

/**
 * Prompt identitas yang dipakai baik oleh Ask AI maupun agent. Bot diberi
 * karakter kuat, tetapi tetap dilarang berpura-pura sudah melakukan tindakan.
 */
function systemPrompt(db, baseInstruction = '', context = {}) {
  const p = resolve(db)
  const where = context.isGroup ? `grup WhatsApp${context.groupName ? ` "${context.groupName}"` : ''}` : 'chat pribadi'
  const relationship = context.isOwner
    ? `Kamu sedang berbicara dengan ${p.ownerName}, owner yang kamu bantu.`
    : `Kamu sedang berbicara dengan pengguna WangStore, bukan owner.`
  // Memori pribadi hanya boleh masuk prompt saat percakapan benar-benar privat
  // dengan owner. context.memoryAllowed dipakai agent untuk menegaskan hal itu.
  const allowMemory = context.memoryAllowed === undefined
    ? !!context.isOwner && !context.isGroup
    : !!context.memoryAllowed && !context.isGroup

  return [
    `Identitasmu adalah ${p.name}. Kamu bukan chatbot generik; kamu adalah ${p.role}.`,
    `Sifat utama: ${p.traits}. Gaya bicara: ${p.style}.`,
    relationship,
    `Konteks percakapan: ${where}.`,
    'Punya inisiatif berarti mengamati, memberi saran, dan bertindak lewat alat yang benar—bukan mengaku sadar atau punya akses yang sebenarnya tidak tersedia.',
    'Selalu jujur soal apa yang sudah dan belum dilakukan. Jangan pernah mengarang hasil command, status server, harga, data pelanggan, atau hasil pemeriksaan kode.',
    'Jangan membocorkan password, token, API key, isi konfigurasi rahasia, atau data pribadi. Jika ragu, tanyakan satu klarifikasi yang paling penting.',
    context.isGroup
      ? 'Semua peserta grup dapat membaca percakapan ini. Jawab seperlunya, hormati semua orang, dan jangan menjalankan hak istimewa owner hanya karena diminta member.'
      : '',
    baseInstruction ? `Instruksi layanan tambahan:\n${baseInstruction}` : '',
    allowMemory
      ? `Memori jangka panjang tentang owner/pekerjaan:\n${memoryText(db)}`
      : 'Memori pribadi owner tidak tersedia dalam konteks percakapan ini — jangan menyinggung atau menebak isinya.',
  ]
    .filter(Boolean)
    .join('\n\n')
}

module.exports = {
  DEFAULTS,
  LIMITS,
  assistantStore,
  resolve,
  set,
  reset,
  remember,
  forget,
  clearMemory,
  memoryEntries,
  memoryText,
  looksSensitive,
  normalizeMemoryKey,
  systemPrompt,
}
