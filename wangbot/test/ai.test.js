// Test fitur Ask AI (.ai / .aiset / .aiclear) + lapisan src/lib/ai.js.
// Semua permintaan AI diarahkan ke server tiruan (test/fake-ai.js), jadi tidak
// ada panggilan ke penyedia AI sungguhan.
//
//   node test/ai.test.js
//   FAKE_AI=http://127.0.0.1:8793 node test/ai.test.js   <- pakai fake eksternal
const path = require('path')
const fs = require('fs')
const os = require('os')
const BOT = path.resolve(__dirname, '..')
const fakeAi = require('./fake-ai')

process.env.OWNER_NUMBER = '6281234567890'
process.env.PREFIX = '.'
process.env.BROADCAST_DELAY = process.env.BROADCAST_DELAY || '0'
process.env.DB_PATH = path.join(os.tmpdir(), 'wangbot-ai-db.json')
process.env.AUTH_PATH = path.join(os.tmpdir(), 'wangbot-ai-auth')
try {
  fs.unlinkSync(process.env.DB_PATH)
} catch (_) {}

const OWNER = '6281234567890@s.whatsapp.net'
const USER = '628999000111@s.whatsapp.net'
const GROUP = '120363000000000000@g.us'
// Tiap blok test memakai pengirim berbeda supaya tidak kena cooldown 8 detik
// milik command .ai (cooldown di-cache per pengirim+command).
let n = 200
const other = () => `62899900${n++}@s.whatsapp.net`

let pass = 0
let fail = 0
const ok = (n, c, x = '') => (c ? (pass++, console.log(`  ✅ ${n}`)) : (fail++, console.log(`  ❌ ${n} ${x}`)))

let srv = null
let ownServer = false

function makeSock() {
  const sock = {
    sent: [],
    presence: [],
    user: { id: OWNER.replace('@', ':9@'), name: 'WangBot' },
    store: { groupMetadata: new Map(), messages: new Map() },
    sendMessage: async (jid, content, opts) => {
      sock.sent.push({ jid, content, opts })
      return { key: { id: 'S' + sock.sent.length } }
    },
    groupMetadata: async (jid) => ({ id: jid, subject: 'Grup Uji AI', participants: makeParts(sock.__sender) }),
    sendPresenceUpdate: async (p, jid) => {
      sock.presence.push({ p, jid })
      return {}
    },
    presenceSubscribe: async () => ({}),
  }
  return sock
}

function makeParts(sender) {
  const base = [
    { id: OWNER, jid: OWNER, admin: 'superadmin' },
    { id: USER, jid: USER, admin: null },
  ]
  if (sender && !base.some((p) => p.id === sender)) base.push({ id: sender, jid: sender, admin: null })
  return base
}

function rawMsg(text, opts = {}) {
  const inGroup = opts.group !== false
  return {
    key: {
      remoteJid: inGroup ? GROUP : opts.chat || opts.sender || USER,
      fromMe: !!opts.fromMe,
      participant: inGroup ? opts.sender || USER : undefined,
      id: 'AI' + Math.random().toString(36).slice(2, 8).toUpperCase(),
    },
    message: { conversation: text },
    pushName: opts.pushName || 'Tester',
    messageTimestamp: Math.floor(Date.now() / 1000),
  }
}

function textOf(content) {
  if (!content) return ''
  if (typeof content === 'string') return content
  if (content.text) return content.text
  return ''
}

function replies(sock, before) {
  return sock.sent
    .slice(before)
    .map((s) => textOf(s.content))
    .filter(Boolean)
}

// Ambil rekaman request provider. Saat fake dijalankan eksternal (FAKE_AI),
// rekaman diambil lewat endpoint /__requests milik fake itu.
async function reqs() {
  if (ownServer) return srv.requests
  const r = await fetch(srv.url + '/__requests')
  return r.json()
}

async function resetReqs() {
  if (ownServer) {
    srv.requests.length = 0 // kosongkan array di tempat (referensi sama dgn fake)
    return
  }
  await fetch(srv.url + '/__reset')
}

async function lastReq() {
  const all = await reqs()
  return all[all.length - 1]
}

// Setel konfigurasi lewat .env saja (bersih dari override database).
function envOnly(base = '/v1', model = 'echo') {
  process.env.AI_API_URL = srv.url + base
  process.env.AI_API_KEY = fakeAi.VALID_KEY
  process.env.AI_MODEL = model
  process.env.AI_PROVIDER = 'auto'
  delete process.env.AI_SYSTEM_PROMPT
  delete process.env.AI_TEMPERATURE
  delete process.env.AI_MAX_TOKENS
  delete process.env.AI_TIMEOUT
  delete process.env.AI_HISTORY
  delete process.env.AI_ENABLED
  delete process.env.AI_ALLOW_GROUP
  delete process.env.AI_EXTRA_HEADERS
}

async function main() {
  if (process.env.FAKE_AI) {
    srv = { url: process.env.FAKE_AI, requests: [], stop: async () => {} }
    console.log(`[ai] memakai fake eksternal ${srv.url}`)
  } else {
    srv = await fakeAi.start()
    ownServer = true
    console.log(`[ai] fake provider di ${srv.url}`)
  }

  envOnly()
  const { Database } = require(path.join(BOT, 'src/database'))
  const db = new Database(process.env.DB_PATH)
  require(path.join(BOT, 'src/database')).Database.instance = db
  const Ai = require(path.join(BOT, 'src/lib/ai'))
  const { loadCommands } = require(path.join(BOT, 'src/commands'))
  const { handle } = require(path.join(BOT, 'src/handler'))
  const logger = require(path.join(BOT, 'src/lib/logger'))
  const loader = loadCommands()

  // ---------------------------------------------------------------- [A]
  console.log('\n[A] KONFIGURASI: .env -> resolve()')
  let cfg = Ai.resolve(db)
  ok('baseUrl & apiKey & model terbaca dari .env', cfg.baseUrl === srv.url + '/v1' && cfg.apiKey === 'test-key' && cfg.model === 'echo',
    `-> ${cfg.baseUrl} / ${cfg.apiKey} / ${cfg.model}`)
  ok('provider auto menebak "openai" untuk URL non-Google', cfg.provider === 'openai', `-> ${cfg.provider}`)
  ok('provider auto menebak "gemini" untuk URL Google',
    Ai.detectProvider({ baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiKey: 'x' }) === 'gemini')
  ok('endpoint openai ditempel /chat/completions', Ai.openaiEndpoint(cfg) === srv.url + '/v1/chat/completions', `-> ${Ai.openaiEndpoint(cfg)}`)
  ok('endpoint gemini membawa key sebagai query',
    /:generateContent\?key=test-key$/.test(Ai.geminiEndpoint({ baseUrl: srv.url + '/v1beta', model: 'echo', apiKey: 'test-key' })),
    `-> ${Ai.geminiEndpoint({ baseUrl: srv.url + '/v1beta', model: 'echo', apiKey: 'test-key' })}`)
  ok('default bawaan dipakai bila .env kosong', (() => {
    const keep = process.env.AI_TEMPERATURE
    delete process.env.AI_TEMPERATURE
    const c = Ai.resolve(db)
    if (keep === undefined) delete process.env.AI_TEMPERATURE
    else process.env.AI_TEMPERATURE = keep
    return c.temperature === Ai.DEFAULTS.temperature && c.maxTokens === Ai.DEFAULTS.maxTokens
  })())
  ok('AI_TIMEOUT dalam detik dikonversi ke ms', (() => {
    process.env.AI_TIMEOUT = '45'
    const ms = Ai.resolve(db).timeout
    delete process.env.AI_TIMEOUT
    return ms === 45000
  })(), `-> ${Ai.resolve(db).timeout}`)

  console.log('\n[B] KONFIGURASI: override database menang + validasi')
  const st = Ai.store(db)
  ok('database punya blok ai bawaan', !!db.data.ai && db.data.ai.usage && typeof db.data.ai.usage.calls === 'number')
  Ai.set(db, 'model', 'echo-override')
  ok('Ai.set(model) menulis ke database', st.model === 'echo-override')
  ok('resolve() memakai nilai database di atas .env', Ai.resolve(db).model === 'echo-override', `-> ${Ai.resolve(db).model}`)
  ok('sources() menandai asal nilai', Ai.sources(db).model === 'db' && Ai.sources(db).apiKey === 'env',
    `-> ${JSON.stringify(Ai.sources(db))}`)
  ok('Ai.set menolak temperature di luar rentang', Ai.set(db, 'temperature', '5').ok === false)
  ok('Ai.set menolak provider tak dikenal', Ai.set(db, 'provider', 'skynet').ok === false)
  ok('Ai.set menolak URL tanpa http(s)', Ai.set(db, 'baseUrl', 'api.openai.com/v1').ok === false)
  ok('Ai.set menerima temperature sah', Ai.set(db, 'temperature', '0.2').ok && Ai.resolve(db).temperature === 0.2)
  ok('history 0 diterima (memori mati), bukan dianggap "belum diset"', Ai.set(db, 'history', '0').ok && Ai.resolve(db).history === 0,
    `-> ${Ai.resolve(db).history}`)
  const masked = Ai.set(db, 'apiKey', 'sk-rahasia-1234567890')
  ok('Ai.set(apiKey) hanya menampilkan key tersamar', masked.ok && !masked.shown.includes('rahasia-1234567890') && masked.shown.includes('***'),
    `-> ${masked.shown}`)
  ok('Ai.mask tidak membocorkan seluruh key', Ai.mask('sk-rahasia-1234567890').length < 'sk-rahasia-1234567890'.length)
  Ai.reset(db)
  ok('Ai.reset mengembalikan ke .env', Ai.resolve(db).model === 'echo' && Ai.resolve(db).apiKey === 'test-key')

  console.log('\n[C] PERMINTAAN OPENAI-COMPATIBLE')
  await resetReqs()
  Ai.clearHistory(GROUP)
  let res = await Ai.askChat(db, GROUP, 'apa itu vps?')
  const last = await lastReq()
  ok('jawaban provider diterima', res.ok && res.text === 'echo:echo:apa itu vps?', `-> ${JSON.stringify(res).slice(0, 200)}`)
  ok('header Authorization Bearer terkirim', last.headers.authorization === 'Bearer test-key', `-> ${last.headers.authorization}`)
  ok('nama model terkirim di body', last.body.model === 'echo', `-> ${last.body.model}`)
  ok('system prompt bawaan ikut terkirim', last.body.messages[0].role === 'system' && /WangStore/.test(last.body.messages[0].content))
  ok('temperature & max_tokens diteruskan', last.body.temperature === Ai.DEFAULTS.temperature && last.body.max_tokens === Ai.DEFAULTS.maxTokens,
    `-> ${last.body.temperature}/${last.body.max_tokens}`)
  ok('pemakaian tercatat di database', db.data.ai.usage.calls >= 1, `-> ${JSON.stringify(db.data.ai.usage)}`)

  console.log('\n[D] MEMORI PERCAKAPAN')
  await resetReqs()
  await Ai.askChat(db, GROUP, 'pertanyaan kedua')
  const msgs2 = (await lastReq()).body.messages
  ok('riwayat dibawa pada pertanyaan berikutnya', msgs2.some((x) => x.role === 'assistant' && x.content === 'echo:echo:apa itu vps?'),
    `-> ${JSON.stringify(msgs2.map((x) => x.role))}`)
  ok('batas riwayat dihormati (history=6)', msgs2.length <= 1 + Ai.resolve(db).history, `-> ${msgs2.length}`)
  Ai.set(db, 'history', '0')
  await resetReqs()
  await Ai.askChat(db, GROUP, 'tanpa memori')
  ok('history 0 = hanya system + pertanyaan', (await lastReq()).body.messages.length === 2,
    `-> ${(await lastReq()).body.messages.length}`)
  Ai.set(db, 'history', '6')
  Ai.clearHistory(GROUP)
  ok('clearHistory mengosongkan riwayat', Ai.historyOf(GROUP).length === 0)

  console.log('\n[E] GOOGLE GEMINI')
  process.env.AI_API_URL = srv.url + '/v1beta'
  process.env.AI_MODEL = 'gemini-echo'
  process.env.AI_PROVIDER = 'gemini' // proxy Gemini non-Google harus diset manual (lihat docs/AI.md)
  await resetReqs()
  res = await Ai.ask(db, [
    { role: 'system', content: 'Jadilah CS WangStore' },
    { role: 'user', content: 'halo' },
  ])
  const glast = await lastReq()
  ok('AI_PROVIDER=gemini dipakai apa adanya', Ai.resolve(db).provider === 'gemini', `-> ${Ai.resolve(db).provider}`)
  ok('jawaban gemini diterima', res.ok && res.text === 'gemini:gemini-echo:halo', `-> ${JSON.stringify(res).slice(0, 200)}`)
  ok('key dikirim sebagai query ?key=', /key=test-key$/.test(glast.url), `-> ${glast.url}`)
  ok('contents memakai role user/model (bukan assistant)', glast.body.contents.length === 1 && glast.body.contents[0].role === 'user',
    `-> ${JSON.stringify(glast.body.contents)}`)
  ok('system prompt jadi systemInstruction', glast.body.systemInstruction.parts[0].text === 'Jadilah CS WangStore')
  ok('generationConfig membawa temperature', glast.body.generationConfig.temperature === Ai.resolve(db).temperature)
  Ai.set(db, 'provider', 'gemini')
  process.env.AI_PROVIDER = 'auto'
  ok('.aiset provider tersimpan di database', db.data.ai.provider === 'gemini' && Ai.resolve(db).provider === 'gemini')
  Ai.reset(db)

  console.log('\n[F] ERROR PROVIDER TIDAK MEMATIKAN BOT')
  envOnly()
  process.env.AI_MODEL = 'err401'
  res = await Ai.ask(db, [{ role: 'user', content: 'x' }])
  ok('HTTP 401 -> pesan soal API key', res.ok === false && /API key ditolak/.test(res.error), `-> ${res.error}`)
  ok('HTTP 401 -> status ikut dilaporkan', res.status === 401, `-> ${res.status}`)
  process.env.AI_MODEL = 'err404'
  res = await Ai.ask(db, [{ role: 'user', content: 'x' }])
  ok('HTTP 404 -> pesan soal model/URL', /Endpoint\/model tidak ditemukan/.test(res.error), `-> ${res.error}`)
  process.env.AI_MODEL = 'err429'
  res = await Ai.ask(db, [{ role: 'user', content: 'x' }])
  ok('HTTP 429 -> pesan kuota', /Kuota|rate limit/i.test(res.error), `-> ${res.error}`)
  process.env.AI_MODEL = 'empty'
  res = await Ai.ask(db, [{ role: 'user', content: 'x' }])
  ok('jawaban kosong -> error jelas, bukan balasan kosong', res.ok === false && /kosong/.test(res.error), `-> ${res.error}`)
  process.env.AI_MODEL = 'strict'
  await resetReqs()
  res = await Ai.ask(db, [{ role: 'user', content: 'hai' }])
  const strictReqs = (await reqs()).filter((r) => /chat\/completions$/.test(r.url.split('?')[0]))
  ok('model ketat (tolak max_tokens & temperature) dicoba ulang otomatis', res.ok && res.text === 'strict:hai:700',
    `-> ${JSON.stringify(res).slice(0, 200)}`)
  ok('percobaan ulang memakai max_completion_tokens tanpa temperature',
    strictReqs.length === 3 &&
      strictReqs[2].body.max_completion_tokens === 700 &&
      strictReqs[2].body.max_tokens === undefined &&
      strictReqs[2].body.temperature === undefined,
    `-> ${strictReqs.length} percobaan, body terakhir: ${JSON.stringify(strictReqs[2] && strictReqs[2].body)}`)
  ok('isi percobaan pertama tetap apa adanya', strictReqs[0].body.max_tokens === 700 && strictReqs[0].body.temperature !== undefined)

  process.env.AI_MODEL = 'echo'
  process.env.AI_API_KEY = 'kunci-salah'
  res = await Ai.ask(db, [{ role: 'user', content: 'x' }])
  ok('key salah ditolak provider', res.ok === false && /API key ditolak/.test(res.error), `-> ${res.error}`)
  process.env.AI_API_KEY = fakeAi.VALID_KEY
  process.env.AI_API_URL = 'http://127.0.0.1:1/v1'
  res = await Ai.ask(db, [{ role: 'user', content: 'x' }])
  ok('provider tak terjangkau -> error jaringan, bukan crash', res.ok === false && /Gagal menghubungi/.test(res.error), `-> ${res.error}`)
  process.env.AI_API_URL = 'bukan-url'
  res = await Ai.ask(db, [{ role: 'user', content: 'x' }])
  ok('URL tidak valid -> ditolak sebelum fetch', res.ok === false && /harus URL lengkap/.test(res.error), `-> ${res.error}`)
  ok('kegagalan tercatat di usage', db.data.ai.usage.failed >= 3, `-> ${JSON.stringify(db.data.ai.usage)}`)

  console.log('\n[G] BELUM DIKONFIGURASI')
  envOnly()
  process.env.AI_API_URL = ''
  process.env.AI_API_KEY = ''
  process.env.AI_MODEL = ''
  res = await Ai.ask(db, [{ role: 'user', content: 'hai' }])
  ok('tanpa konfigurasi -> error not_configured tanpa memanggil provider', res.ok === false && res.code === 'not_configured',
    `-> ${JSON.stringify(res).slice(0, 120)}`)
  ok('pesan menyebut nama variabel yang kurang', /AI_API_URL/.test(res.error) && /AI_MODEL/.test(res.error), `-> ${res.error}`)
  const before = (await reqs()).length
  const sockG = makeSock()
  const senderG0 = other()
  await handle(sockG, db, loader, rawMsg('.ai halo', { group: false, sender: senderG0 }))
  ok('.ai membalas petunjuk konfigurasi', /belum dikonfigurasi/i.test(replies(sockG, 0).join(' ')), `-> ${replies(sockG, 0).join(' ')}`)
  ok('.ai tidak menembak provider saat belum dikonfigurasi', (await reqs()).length === before, `-> ${(await reqs()).length - before} panggilan`)

  console.log('\n[H] COMMAND LEWAT HANDLER ASLI')
  envOnly()
  Ai.reset(db)
  Ai.clearHistory(GROUP)
  const sock = makeSock()
  const senderA = other()
  sock.__sender = senderA
  await handle(sock, db, loader, rawMsg('.ai jelaskan hosting murah', { sender: senderA }))
  const r1 = replies(sock, 0).join(' ')
  ok('.ai menjawab di grup untuk member biasa', /echo:echo:jelaskan hosting murah/.test(r1), `-> ${r1.slice(0, 160)}`)
  ok('.ai menyertakan nama model di footer', /echo · /.test(r1), `-> ${r1.slice(-120)}`)
  ok('indikator "sedang mengetik" dikirim', sock.presence.some((p) => p.p === 'composing') && sock.presence.some((p) => p.p === 'paused'),
    `-> ${JSON.stringify(sock.presence.map((p) => p.p))}`)

  const sockQ = makeSock()
  const senderQ = other()
  sockQ.__sender = senderQ
  await handle(sockQ, db, loader, {
    key: { remoteJid: GROUP, fromMe: false, participant: senderQ, id: 'Q1' },
    message: {
      extendedTextMessage: {
        text: '.ai',
        contextInfo: {
          stanzaId: 'ORIG1',
          participant: senderQ,
          quotedMessage: { conversation: 'kenapa server minecraft lag?' },
        },
      },
    },
    pushName: 'Tester',
  })
  ok('.ai bisa menjawab pesan yang di-reply', /kenapa server minecraft lag\?/.test(replies(sockQ, 0).join(' ')), `-> ${replies(sockQ, 0).join(' ').slice(0, 160)}`)

  const sockH = makeSock()
  const senderH = other()
  sockH.__sender = senderH
  await handle(sockH, db, loader, rawMsg('.ai', { sender: senderH }))
  ok('.ai tanpa pertanyaan -> bantuan, bukan error', /ASK AI/.test(replies(sockH, 0).join(' ')), `-> ${replies(sockH, 0).join(' ').slice(0, 120)}`)

  const sockLong = makeSock()
  const senderL = other()
  sockLong.__sender = senderL
  await handle(sockLong, db, loader, rawMsg('.ai ' + 'a'.repeat(3000), { sender: senderL }))
  ok('pertanyaan terlalu panjang ditolak', /terlalu panjang/.test(replies(sockLong, 0).join(' ')), `-> ${replies(sockLong, 0).join(' ').slice(0, 120)}`)

  const sockOff = makeSock()
  sockOff.__sender = OWNER
  await handle(sockOff, db, loader, rawMsg('.aiset off', { group: false, sender: OWNER, chat: OWNER }))
  ok('.aiset off mematikan fitur', db.data.ai.enabled === false, `-> ${JSON.stringify(db.data.ai.enabled)}`)
  const beforeOff = sockOff.sent.length
  await handle(sockOff, db, loader, rawMsg('.ai halo', { group: false, sender: OWNER, chat: OWNER }))
  ok('.ai ditolak saat fitur off', /dinonaktifkan/.test(replies(sockOff, beforeOff).join(' ')), `-> ${replies(sockOff, beforeOff).join(' ')}`)
  await handle(sockOff, db, loader, rawMsg('.aiset on', { group: false, sender: OWNER, chat: OWNER }))
  ok('.aiset on menghidupkan lagi', db.data.ai.enabled === true)

  const sockGrp = makeSock()
  sockGrp.__sender = OWNER
  await handle(sockGrp, db, loader, rawMsg('.aiset group off', { group: false, sender: OWNER, chat: OWNER }))
  const sockGrp2 = makeSock()
  const senderG = other()
  sockGrp2.__sender = senderG
  await handle(sockGrp2, db, loader, rawMsg('.ai halo', { sender: senderG }))
  ok('.ai ditolak di grup bila allowGroup off', /chat pribadi/.test(replies(sockGrp2, 0).join(' ')), `-> ${replies(sockGrp2, 0).join(' ')}`)
  await handle(sockGrp, db, loader, rawMsg('.aiset group on', { group: false, sender: OWNER, chat: OWNER }))
  ok('.aiset group on mengembalikan akses grup', db.data.ai.allowGroup === true)

  const sockSet = makeSock()
  sockSet.__sender = OWNER
  await handle(sockSet, db, loader, rawMsg('.aiset key sk-owner-baru-9988', { group: false, sender: OWNER, chat: OWNER }))
  ok('.aiset key menyimpan key baru', db.data.ai.apiKey === 'sk-owner-baru-9988')
  ok('.aiset key tidak mengulang key apa adanya di chat', !replies(sockSet, 0).join(' ').includes('sk-owner-baru-9988'),
    `-> ${replies(sockSet, 0).join(' ')}`)
  await handle(sockSet, db, loader, rawMsg('.aiset api ' + srv.url + '/v1', { group: false, sender: OWNER, chat: OWNER }))
  await handle(sockSet, db, loader, rawMsg('.aiset model echo', { group: false, sender: OWNER, chat: OWNER }))
  ok('.aiset api & model tersimpan', db.data.ai.baseUrl === srv.url + '/v1' && db.data.ai.model === 'echo',
    `-> ${db.data.ai.baseUrl} / ${db.data.ai.model}`)

  const sockStat = makeSock()
  sockStat.__sender = OWNER
  await handle(sockStat, db, loader, rawMsg('.aiset status', { group: false, sender: OWNER, chat: OWNER }))
  const statText = replies(sockStat, 0).join(' ')
  ok('.aiset status menampilkan konfigurasi', /KONFIGURASI ASK AI/.test(statText) && /Provider/.test(statText), `-> ${statText.slice(0, 120)}`)
  ok('.aiset status menyamarkan API key', !statText.includes('sk-owner-baru-9988') && statText.includes('sk-o'), `-> ${statText.match(/API key.*/)[0]}`)

  // kembalikan key yang benar-benar diterima provider, lalu uji koneksi
  await handle(sockSet, db, loader, rawMsg('.aiset key ' + fakeAi.VALID_KEY, { group: false, sender: OWNER, chat: OWNER }))
  const sockTest = makeSock()
  sockTest.__sender = OWNER
  await handle(sockTest, db, loader, rawMsg('.aiset test', { group: false, sender: OWNER, chat: OWNER }))
  ok('.aiset test melaporkan koneksi berhasil', /Koneksi AI berhasil/.test(replies(sockTest, 0).join(' ')), `-> ${replies(sockTest, 0).join(' ').slice(0, 160)}`)

  const sockPerm = makeSock()
  const senderP = other()
  sockPerm.__sender = senderP
  await handle(sockPerm, db, loader, rawMsg('.aiset key sk-peretas', { sender: senderP }))
  ok('.aiset ditolak untuk non-owner', /khusus \*Owner\*/.test(replies(sockPerm, 0).join(' ')), `-> ${replies(sockPerm, 0).join(' ')}`)
  ok('key peretas tidak tersimpan', db.data.ai.apiKey !== 'sk-peretas')

  const sockClear = makeSock()
  const senderC = other()
  sockClear.__sender = senderC
  Ai.pushHistory(GROUP, 'user', 'x')
  await handle(sockClear, db, loader, rawMsg('.aiclear', { sender: senderC }))
  ok('.aiclear menghapus riwayat chat itu', /Riwayat AI .* dihapus/.test(replies(sockClear, 0).join(' ')) && Ai.historyOf(GROUP).length === 0,
    `-> ${replies(sockClear, 0).join(' ')}`)

  const sockMenu = makeSock()
  sockMenu.__sender = OWNER
  await handle(sockMenu, db, loader, rawMsg('.menu', { group: false, sender: OWNER, chat: OWNER }))
  const menuText = replies(sockMenu, 0).join('\n')
  ok('menu menampilkan kategori AI ASSISTANT', /AI ASSISTANT/.test(menuText), `-> ${menuText.slice(0, 80)}`)
  ok('menu menampilkan .ai', /\.ai .*—/.test(menuText) && /\.aiset/.test(menuText), `-> ${(menuText.match(/\.ai.*/) || [])[0]}`)

  console.log('\n[I] KEAMANAN LOG')
  const captured = []
  const origCmd = logger.cmd
  logger.cmd = (msg) => captured.push(msg)
  try {
    const sockLog = makeSock()
    sockLog.__sender = OWNER
    await handle(sockLog, db, loader, rawMsg('.aiset key sk-super-rahasia-445566', { group: false, sender: OWNER, chat: OWNER }))
    await handle(sockLog, db, loader, rawMsg('.mcrcon srv 25575 password-rahasia', { group: false, sender: OWNER, chat: OWNER }))
  } finally {
    logger.cmd = origCmd
  }
  const logged = captured.join(' | ')
  ok('API key AI tidak masuk log command', !logged.includes('sk-super-rahasia-445566'), `-> ${logged}`)
  ok('password RCON tidak masuk log command', !logged.includes('password-rahasia'), `-> ${logged}`)
  ok('nama sub-command tetap tercatat', /aiset key/.test(logged) && /mcrcon srv/.test(logged), `-> ${logged}`)

  console.log('\n[J] PERSISTENSI')
  db.data.ai.model = 'echo'
  db.data.ai.baseUrl = srv.url + '/v1'
  db.data.ai.apiKey = 'sk-tersimpan'
  db.save(true)
  const db2 = new Database(process.env.DB_PATH)
  ok('konfigurasi AI tersimpan di database.json', db2.data.ai.apiKey === 'sk-tersimpan' && db2.data.ai.model === 'echo',
    `-> ${JSON.stringify(db2.data.ai).slice(0, 160)}`)
  ok('database lama tanpa blok ai tetap jalan', (() => {
    const p = path.join(os.tmpdir(), 'wangbot-ai-legacy.json')
    fs.writeFileSync(p, JSON.stringify({ version: 1, owners: ['628777@s.whatsapp.net'] }))
    const legacy = new Database(p)
    const has = !!legacy.data.ai && !!legacy.data.ai.usage
    fs.unlinkSync(p)
    return has
  })())

  console.log(`\n===== HASIL: ${pass} lulus, ${fail} gagal =====`)
  if (ownServer) await srv.stop()
  process.exit(fail ? 1 : 0)
}

main().catch(async (e) => {
  console.error('\nFATAL:', e)
  if (ownServer && srv) await srv.stop()
  process.exit(1)
})
