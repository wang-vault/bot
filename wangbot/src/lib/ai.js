// Lapisan "Ask AI" WangBot: klien LLM yang bisa diarahkan ke penyedia mana pun.
//
// Prinsip: bot TIDAK dikunci ke satu vendor. Owner cukup mengisi 3 hal utama
// (URL endpoint, API key, nama model) lewat .env ATAU lewat command .aiset yang
// disimpan di database.json. Nilai database menang selama tidak kosong, jadi
// ganti provider / API key bisa dilakukan tanpa restart bot.
//
// Dua gaya API yang didukung:
//   openai  -> POST {base}/chat/completions   (OpenAI, Groq, OpenRouter, DeepSeek,
//                                              Mistral, Together, Ollama, LM Studio, ...)
//   gemini  -> POST {base}/models/{model}:generateContent?key=...  (Google AI Studio)
//
// Catatan keamanan: API key disimpan di data/database.json (teks biasa), sama
// seperti Client API token milik pelanggan di fitur Minecraft. Jaga file itu.

const logger = require('./logger')

const DEFAULTS = {
  provider: '', // '' = tebak otomatis dari baseUrl
  baseUrl: '', // contoh: https://api.openai.com/v1
  apiKey: '',
  model: '',
  system: 'Kamu adalah asisten AI di grup komunitas WangStore (hosting, VPS, dedicated server, dan server Minecraft). Jawab dalam Bahasa Indonesia, singkat, ramah, dan to the point. Jangan mengarang harga atau fitur; kalau tidak yakin, sarankan menghubungi admin.',
  temperature: 0.7,
  maxTokens: 700,
  timeout: 30000, // ms
  history: 6, // jumlah pesan riwayat (user+assistant) yang dibawa per chat
  maxChars: 1500, // panjang pertanyaan maksimum
  headers: {}, // header tambahan, mis. OpenRouter butuh HTTP-Referer
}

const DEFAULT_GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'

// Riwayat percakapan per chat (di memori saja, tidak dibuang ke database supaya
// file db tidak membengkak). TTL 30 menit setelah pesan terakhir.
const _hist = new Map()
const HIST_TTL = 30 * 60 * 1000

function store(db) {
  if (!db || !db.data) return null
  if (!db.data.ai || typeof db.data.ai !== 'object') db.data.ai = {}
  const a = db.data.ai
  if (!a.headers || typeof a.headers !== 'object') a.headers = {}
  if (!a.usage || typeof a.usage !== 'object') a.usage = { calls: 0, failed: 0, lastAt: 0, lastError: '' }
  return a
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// Ambil nilai pertama yang "berisi": database -> .env -> default.
// Angka negatif (-1) dipakai sebagai tanda "belum diset" di database, sedangkan
// 0 tetap dianggap nilai sah (mis. AI_HISTORY=0 = tanpa memori percakapan).
function pick(...vals) {
  for (const v of vals) {
    if (v === null || v === undefined) continue
    if (typeof v === 'string' && v.trim() === '') continue
    if (typeof v === 'number' && v < 0) continue
    return v
  }
  return null
}

function parseHeaders(raw) {
  if (!raw) return {}
  if (typeof raw === 'object') return raw
  try {
    const o = JSON.parse(raw)
    return o && typeof o === 'object' ? o : {}
  } catch (_) {
    return {}
  }
}

function envCfg() {
  return {
    provider: (process.env.AI_PROVIDER || '').trim().toLowerCase(),
    baseUrl: (process.env.AI_API_URL || '').trim(),
    apiKey: (process.env.AI_API_KEY || '').trim(),
    model: (process.env.AI_MODEL || '').trim(),
    system: process.env.AI_SYSTEM_PROMPT || '',
    temperature: num(process.env.AI_TEMPERATURE),
    maxTokens: num(process.env.AI_MAX_TOKENS),
    timeout: toMs(num(process.env.AI_TIMEOUT)),
    history: num(process.env.AI_HISTORY),
    maxChars: num(process.env.AI_MAX_CHARS),
    headers: parseHeaders(process.env.AI_EXTRA_HEADERS),
    enabled: (process.env.AI_ENABLED || '1') !== '0',
    allowGroup: (process.env.AI_ALLOW_GROUP || '1') !== '0',
  }
}

// Nilai < 1000 dianggap detik (AI_TIMEOUT=30), selain itu milidetik (30000).
function toMs(v) {
  if (v === null) return null
  return v < 1000 ? v * 1000 : v
}

/** Tebak gaya API dari base URL / bentuk API key kalau owner tidak menyetelnya. */
function detectProvider(cfg) {
  const base = (cfg.baseUrl || '').toLowerCase()
  if (base.includes('generativelanguage.googleapis.com') || base.includes('googleapis.com/v1beta')) return 'gemini'
  if (base.includes('generativelanguage') || base.includes('/google')) return 'gemini'
  if (/^aiza[0-9a-z_-]{20,}$/i.test((cfg.apiKey || '').trim())) return 'gemini'
  return 'openai'
}

/**
 * Gabungkan konfigurasi .env + database (database menang).
 * Aman dipanggil tanpa db (mis. saat test unit).
 */
function resolve(db) {
  const s = store(db) || {}
  const env = envCfg()
  const cfg = {
    provider: String(pick(s.provider, env.provider, DEFAULTS.provider) || '').toLowerCase(),
    baseUrl: String(pick(s.baseUrl, env.baseUrl, '') || '').trim(),
    apiKey: String(pick(s.apiKey, env.apiKey, '') || '').trim(),
    model: String(pick(s.model, env.model, '') || '').trim(),
    system: String(pick(s.system, env.system, DEFAULTS.system) || ''),
    temperature: clamp(num(pick(s.temperature, env.temperature, DEFAULTS.temperature)), 0, 2, DEFAULTS.temperature),
    maxTokens: Math.round(clamp(num(pick(s.maxTokens, env.maxTokens, DEFAULTS.maxTokens)), 1, 32000, DEFAULTS.maxTokens)),
    timeout: Math.round(clamp(num(pick(s.timeout, env.timeout, DEFAULTS.timeout)), 1000, 300000, DEFAULTS.timeout)),
    history: Math.round(clamp(num(pick(s.history, env.history, DEFAULTS.history)), 0, 40, DEFAULTS.history)),
    maxChars: Math.round(clamp(num(pick(s.maxChars, env.maxChars, DEFAULTS.maxChars)), 50, 20000, DEFAULTS.maxChars)),
    headers: Object.assign({}, env.headers, s.headers || {}),
    enabled: s.enabled === undefined ? env.enabled : s.enabled !== false,
    allowGroup: s.allowGroup === undefined ? env.allowGroup : s.allowGroup !== false,
    usage: s.usage || { calls: 0, failed: 0, lastAt: 0, lastError: '' },
  }
  if (!cfg.provider || cfg.provider === 'auto') cfg.provider = detectProvider(cfg)
  return cfg
}

function clamp(v, min, max, dflt) {
  if (v === null || v === undefined || !Number.isFinite(v)) return dflt
  return Math.min(max, Math.max(min, v))
}

/** Lengkap belum? Mengembalikan { ok, error, missing } untuk pesan ramah ke user. */
function ready(cfg) {
  const missing = []
  if (!cfg.baseUrl) missing.push('AI_API_URL')
  if (!cfg.apiKey) missing.push('AI_API_KEY')
  if (!cfg.model) missing.push('AI_MODEL')
  if (missing.length) {
    return {
      ok: false,
      missing,
      error:
        '🧠 *Ask AI belum dikonfigurasi.*\n' +
        `Owner perlu mengisi: ${missing.join(', ')}.\n` +
        'Bisa lewat .env atau langsung dari WhatsApp: ' +
        '`.aiset api <url>` + `.aiset key <apikey>` + `.aiset model <model>`.\n' +
        'Contoh lengkap ada di docs/AI.md.',
    }
  }
  if (!/^https?:\/\//i.test(cfg.baseUrl)) {
    return { ok: false, missing: [], error: `❌ AI_API_URL harus URL lengkap (http/https), sekarang: ${cfg.baseUrl}` }
  }
  return { ok: true, missing: [] }
}

function configured(db) {
  return ready(resolve(db)).ok
}

/** Samarkan API key untuk ditampilkan ke chat/log: sk-abc…90f */
function mask(secret) {
  const s = String(secret || '')
  if (!s) return '(kosong)'
  if (s.length <= 8) return '*'.repeat(s.length)
  return `${s.slice(0, 4)}${'*'.repeat(Math.min(12, s.length - 6))}${s.slice(-4)}`
}

function trimSlash(u) {
  return String(u || '').replace(/\/+$/, '')
}

/** URL final untuk gaya openai-compatible (menerima base atau endpoint penuh). */
function openaiEndpoint(cfg) {
  const base = trimSlash(cfg.baseUrl)
  if (/\/chat\/completions$/.test(base)) return base
  return `${base}/chat/completions`
}

/** URL final untuk Google Gemini (key dikirim sebagai query ?key=). */
function geminiEndpoint(cfg) {
  let base = trimSlash(cfg.baseUrl) || trimSlash(DEFAULT_GEMINI_BASE)
  if (!/\/v1(beta)?$/.test(base) && !/\/models$/.test(base)) base = `${base}/v1beta`
  base = base.replace(/\/models$/, '')
  return `${base}/models/${encodeURIComponent(cfg.model)}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`
}

function buildRequest(cfg, messages) {
  if (cfg.provider === 'gemini') {
    const contents = messages
      .filter((x) => x.role !== 'system')
      .map((x) => ({
        role: x.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: String(x.content || '') }],
      }))
    const sys = messages.find((x) => x.role === 'system')
    const body = {
      contents,
      generationConfig: { temperature: cfg.temperature, maxOutputTokens: cfg.maxTokens },
    }
    if (sys && sys.content) body.systemInstruction = { parts: [{ text: String(sys.content) }] }
    return {
      url: geminiEndpoint(cfg),
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...cfg.headers },
      body,
    }
  }
  return {
    url: openaiEndpoint(cfg),
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...cfg.headers,
    },
    body: {
      model: cfg.model,
      messages,
      temperature: cfg.temperature,
      max_tokens: cfg.maxTokens,
    },
  }
}

function pickError(data, fallback) {
  const e = data && data.error
  if (!e) return fallback
  if (typeof e === 'string') return e
  return e.message || e.msg || JSON.stringify(e).slice(0, 300) || fallback
}

/** Terjemahkan kode HTTP jadi pesan yang bisa ditindaklanjuti owner. */
function friendlyError(cfg, status, data) {
  const detail = pickError(data, '')
  const where = `${cfg.provider} (${trimSlash(cfg.baseUrl)})`
  if (status === 401 || status === 403)
    return `API key ditolak provider (HTTP ${status}). Cek lagi key-nya di ${where}. ${detail}`.trim()
  if (status === 404)
    return `Endpoint/model tidak ditemukan (HTTP 404) di ${where}. Cek nama model "${cfg.model}" dan AI_API_URL (biasanya diakhiri /v1). ${detail}`.trim()
  if (status === 429) return `Kuota / rate limit provider habis (HTTP 429). ${detail}`.trim()
  if (status === 400 || status === 422)
    return `Permintaan ditolak provider (HTTP ${status}): ${detail || 'cek nama model & parameter'}`
  if (status >= 500) return `Provider sedang bermasalah (HTTP ${status}). Coba lagi sebentar lagi.`
  return `HTTP ${status}${detail ? ': ' + detail : ''}`
}

function readOpenAI(data) {
  const msg = data && data.choices && data.choices[0] && data.choices[0].message
  if (msg && typeof msg.content === 'string') return msg.content
  if (msg && Array.isArray(msg.content)) {
    return msg.content
      .map((p) => (typeof p === 'string' ? p : (p && p.text) || ''))
      .join('')
  }
  if (data && data.choices && data.choices[0] && typeof data.choices[0].text === 'string') {
    return data.choices[0].text
  }
  return ''
}

function readGemini(data) {
  const cand = data && data.candidates && data.candidates[0]
  if (!cand) {
    if (data && data.promptFeedback && data.promptFeedback.blockReason) {
      return `[ditolak provider: ${data.promptFeedback.blockReason}]`
    }
    return ''
  }
  const parts = (cand.content && cand.content.parts) || []
  return parts.map((p) => (typeof p === 'string' ? p : (p && p.text) || '')).join('')
}

function bumpUsage(db, ok, error) {
  const s = store(db)
  if (!s) return
  s.usage.calls = (s.usage.calls || 0) + 1
  s.usage.lastAt = Date.now()
  if (!ok) {
    s.usage.failed = (s.usage.failed || 0) + 1
    s.usage.lastError = String(error || '').slice(0, 300)
  }
  db.save()
}

/**
 * Kirim satu pertanyaan ke provider.
 * @returns {Promise<{ok:boolean, text?:string, error?:string, status?:number, ms:number, model?:string, provider?:string}>}
 */
async function ask(db, messages) {
  const cfg = resolve(db)
  const chk = ready(cfg)
  if (!chk.ok) return { ok: false, ms: 0, error: chk.error, code: 'not_configured' }

  const { url, headers, body } = buildRequest(cfg, messages)
  const started = Date.now()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), cfg.timeout)

  // Model generasi baru (mis. o-series / gpt-5 di OpenAI) menolak `max_tokens`
  // dan/atau `temperature`. Kalau provider protes dengan HTTP 400 soal itu,
  // kirim ulang dengan bentuk parameter yang mereka minta (maks. 2 percobaan
  // tambahan) — owner tidak perlu tahu perbedaan antar-model ini.
  const attempts = [body]
  try {
    for (let i = 0; i < attempts.length; i++) {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(attempts[i]),
        signal: ctrl.signal,
      })
      const raw = await res.text()
      let data = null
      try {
        data = JSON.parse(raw)
      } catch (_) {}

      if (!res.ok) {
        const detail = pickError(data, '')
        const fix = cfg.provider === 'openai' && res.status === 400 ? paramFix(attempts[i], detail) : null
        if (fix && attempts.length < 3) {
          attempts.push(fix)
          continue
        }
        const error = friendlyError(cfg, res.status, data)
        bumpUsage(db, false, error)
        logger.error(`[AI] ${cfg.provider} HTTP ${res.status}`, error)
        return { ok: false, ms: Date.now() - started, status: res.status, error, code: 'http_error' }
      }

      const text = (cfg.provider === 'gemini' ? readGemini(data) : readOpenAI(data) || '').trim()
      if (!text) {
        const error = `Provider membalas kosong${raw ? ': ' + raw.slice(0, 200) : ''}. Cek nama model & format API.`
        bumpUsage(db, false, error)
        return { ok: false, ms: Date.now() - started, status: res.status, error, code: 'empty_response' }
      }

      bumpUsage(db, true)
      return { ok: true, ms: Date.now() - started, text, model: cfg.model, provider: cfg.provider }
    }
    // Tidak seharusnya tercapai: setiap iterasi return, kecuali menambah attempt.
    return { ok: false, ms: Date.now() - started, error: 'Permintaan gagal setelah percobaan ulang.', code: 'http_error' }
  } catch (e) {
    const ms = Date.now() - started
    const error =
      e && e.name === 'AbortError'
        ? `Provider tidak menjawab dalam ${Math.round(cfg.timeout / 1000)} detik (timeout). Coba lagi atau naikkan AI_TIMEOUT.`
        : `Gagal menghubungi ${trimSlash(cfg.baseUrl)}: ${(e && e.message) || e}. Cek AI_API_URL / koneksi server.`
    bumpUsage(db, false, error)
    return { ok: false, ms, error, code: 'network' }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Susun ulang body sesuai protes provider. Model baru OpenAI menolak
 * `max_tokens` (minta `max_completion_tokens`) dan menolak `temperature`
 * selain 1. Mengembalikan body baru, atau null bila protesnya bukan soal itu.
 */
function paramFix(body, detail) {
  const msg = String(detail || '')
  const wantTokens = /max_tokens/i.test(msg) && body.max_tokens !== undefined
  const wantTemp = /temperature/i.test(msg) && body.temperature !== undefined
  if (!wantTokens && !wantTemp) return null
  const next = { ...body }
  if (wantTokens) {
    next.max_completion_tokens = next.max_tokens
    delete next.max_tokens
  }
  if (wantTemp) delete next.temperature
  return next
}

// ---------------- riwayat percakapan (memori jangka pendek) ----------------

function _pruneHist(now = Date.now()) {
  for (const [k, v] of _hist.entries()) {
    if (now - v.at > HIST_TTL) _hist.delete(k)
  }
  return _hist.size
}
setInterval(_pruneHist, 5 * 60 * 1000).unref()

function historyOf(chatJid) {
  const h = _hist.get(chatJid)
  if (!h) return []
  if (Date.now() - h.at > HIST_TTL) {
    _hist.delete(chatJid)
    return []
  }
  return h.msgs
}

function pushHistory(chatJid, role, content) {
  if (!chatJid || !content) return
  let h = _hist.get(chatJid)
  if (!h) {
    h = { msgs: [], at: 0 }
    _hist.set(chatJid, h)
  }
  h.msgs.push({ role, content: String(content).slice(0, 4000) })
  if (h.msgs.length > 40) h.msgs = h.msgs.slice(-40)
  h.at = Date.now()
}

function clearHistory(chatJid) {
  return _hist.delete(chatJid)
}

/**
 * Susun pesan (system + riwayat + pertanyaan baru) sesuai batas riwayat.
 */
function buildMessages(db, chatJid, question, options = {}) {
  const cfg = resolve(db)
  const msgs = []
  // Personal Agent dapat menyuntikkan identitas dinamis tanpa menimpa setting
  // provider AI. Pemanggil lama tetap memakai cfg.system seperti sebelumnya.
  const system = options.system === undefined ? cfg.system : String(options.system || '')
  if (system) msgs.push({ role: 'system', content: system })
  if (cfg.history > 0) msgs.push(...historyOf(chatJid).slice(-cfg.history))
  msgs.push({ role: 'user', content: String(question) })
  return msgs
}

/**
 * Pintu masuk untuk command: tanya + simpan riwayat.
 */
async function askChat(db, chatJid, question, options = {}) {
  const messages = buildMessages(db, chatJid, question, options)
  const res = await ask(db, messages)
  if (res.ok) {
    pushHistory(chatJid, 'user', question)
    pushHistory(chatJid, 'assistant', res.text)
  }
  return res
}

// ---------------- tulis konfigurasi dari command owner ----------------

const NUMERIC_KEYS = {
  temperature: { min: 0, max: 2, label: 'temperature (0–2)', contoh: '.aiset temp 0.4' },
  maxTokens: { min: 1, max: 32000, label: 'max tokens (1–32000)', contoh: '.aiset maxtokens 900' },
  timeout: { min: 1, max: 300, label: 'timeout detik (1–300)', contoh: '.aiset timeout 45', mul: 1000 },
  history: { min: 0, max: 40, label: 'jumlah pesan riwayat (0–40)', contoh: '.aiset history 8' },
  maxChars: { min: 50, max: 20000, label: 'panjang pertanyaan maks (50–20000)', contoh: '.aiset maxchars 2000' },
}

const STRING_KEYS = {
  provider: ['openai', 'gemini', 'auto'],
  baseUrl: null,
  apiKey: null,
  model: null,
  system: null,
}

/**
 * Tulis satu nilai konfigurasi ke database (override .env).
 * @returns {{ok:boolean, error?:string, key?:string, shown?:string}}
 */
function set(db, key, rawValue) {
  const s = store(db)
  if (!s) return { ok: false, error: 'database tidak tersedia' }
  const value = String(rawValue === undefined || rawValue === null ? '' : rawValue).trim()

  if (NUMERIC_KEYS[key]) {
    const rule = NUMERIC_KEYS[key]
    const n = Number(value)
    if (!value || !Number.isFinite(n)) return { ok: false, error: `Format salah untuk ${rule.label}. Contoh: ${rule.contoh}` }
    if (n < rule.min || n > rule.max) return { ok: false, error: `${rule.label} harus ${rule.min}–${rule.max}. Contoh: ${rule.contoh}` }
    s[key] = rule.mul ? Math.round(n * rule.mul) : n
    db.save()
    return { ok: true, key, shown: String(s[key]) }
  }

  if (!Object.prototype.hasOwnProperty.call(STRING_KEYS, key)) {
    return { ok: false, error: `Pengaturan "${key}" tidak dikenal.` }
  }
  if (!value) return { ok: false, error: `Nilai untuk *${key}* tidak boleh kosong. Pakai \`.aiset reset\` untuk menghapus.` }
  if (key === 'provider') {
    const p = value.toLowerCase()
    if (!STRING_KEYS.provider.includes(p)) {
      return { ok: false, error: `Provider harus salah satu dari: ${STRING_KEYS.provider.join(', ')}.` }
    }
    s.provider = p === 'auto' ? '' : p
    db.save()
    return { ok: true, key, shown: s.provider || 'auto' }
  }
  if (key === 'baseUrl') {
    if (!/^https?:\/\//i.test(value)) {
      return { ok: false, error: `URL harus diawali http:// atau https://. Contoh: https://api.openai.com/v1` }
    }
    s.baseUrl = value.replace(/\/+$/, '')
    db.save()
    return { ok: true, key, shown: s.baseUrl }
  }
  if (key === 'system') {
    // system prompt boleh multi-baris & panjang; hanya tepi yang dirapikan
    s.system = String(rawValue).trim().slice(0, 2000)
    db.save()
    return { ok: true, key, shown: `${s.system.length} karakter` }
  }
  s[key] = value
  db.save()
  return { ok: true, key, shown: key === 'apiKey' ? mask(value) : value }
}

/** Setel header tambahan (mis. OpenRouter butuh HTTP-Referer). */
function setHeader(db, name, value) {
  const s = store(db)
  if (!s) return { ok: false, error: 'database tidak tersedia' }
  if (!name || !/^[\w-]+$/.test(name)) return { ok: false, error: 'Nama header tidak valid (huruf/angka/tanda -).' }
  s.headers[name] = String(value || '')
  db.save()
  return { ok: true, shown: `${name}: ${value ? mask(value) : '(kosong)'}` }
}

function delHeader(db, name) {
  const s = store(db)
  if (!s) return { ok: false, error: 'database tidak tersedia' }
  const hit = Object.keys(s.headers).find((k) => k.toLowerCase() === String(name || '').toLowerCase())
  if (!hit) return { ok: false, error: `Header "${name}" tidak ada.` }
  delete s.headers[hit]
  db.save()
  return { ok: true, shown: hit }
}

/** Kembalikan override database ke "belum diset" supaya .env dipakai lagi. */
function reset(db) {
  if (!db || !db.data) return { ok: false, error: 'database tidak tersedia' }
  const usage = db.data.ai && db.data.ai.usage
  db.data.ai = Object.assign(defaultDbValues(), { usage })
  db.save()
  return { ok: true }
}

/** Bentuk "belum diset" yang disimpan di database.json. */
function defaultDbValues() {
  return {
    enabled: true,
    allowGroup: true,
    provider: '',
    baseUrl: '',
    apiKey: '',
    model: '',
    system: '',
    temperature: -1,
    maxTokens: -1,
    timeout: -1,
    history: -1,
    maxChars: -1,
    headers: {},
  }
}

function has(v) {
  if (v === undefined || v === null) return false
  if (typeof v === 'string') return v.trim() !== ''
  if (typeof v === 'number') return v >= 0
  return true
}

/** Asal tiap nilai: 'db' (di-set owner) | 'env' (.env) | 'default'. */
function sources(db) {
  const s = store(db) || {}
  const env = envCfg()
  const out = {}
  for (const k of ['provider', 'baseUrl', 'apiKey', 'model', 'system', 'temperature', 'maxTokens', 'timeout', 'history', 'maxChars']) {
    out[k] = has(s[k]) ? 'db' : has(env[k]) ? 'env' : 'default'
  }
  out.enabled = s.enabled === undefined ? 'env' : 'db'
  out.allowGroup = s.allowGroup === undefined ? 'env' : 'db'
  return out
}

module.exports = {
  DEFAULTS,
  DEFAULT_GEMINI_BASE,
  store,
  resolve,
  ready,
  configured,
  detectProvider,
  mask,
  toMs,
  openaiEndpoint,
  geminiEndpoint,
  buildRequest,
  friendlyError,
  paramFix,
  readOpenAI,
  readGemini,
  ask,
  askChat,
  buildMessages,
  historyOf,
  pushHistory,
  clearHistory,
  set,
  setHeader,
  delHeader,
  reset,
  defaultDbValues,
  sources,
  NUMERIC_KEYS,
  _pruneHist,
  _hist,
}
