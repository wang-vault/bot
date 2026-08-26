// Test terarah untuk logika inti WangBot (moderasi, monitoring, marketing,
// event grup, broadcast, keamanan owner, prefix, warn/kick).
//
//   node test/core.test.js
//   FAKE_PANEL=http://127.0.0.1:8791 node test/core.test.js   <- ikut menguji monitor
const path = require('path')
const BOT = path.resolve(__dirname, '..')
process.env.OWNER_NUMBER = '6281234567890'
process.env.BROADCAST_DELAY = process.env.BROADCAST_DELAY || '0' // jangan menunggu 5 detik/grup saat test
process.env.DB_PATH = path.join(require('os').tmpdir(), 'wangbot-test-db.json')
process.env.PANEL_API_URL = process.env.FAKE_PANEL || ''
process.env.PANEL_API_TOKEN = process.env.FAKE_PANEL ? 'tok' : ''
process.env.WANGSTORE_WEBSITE = process.env.FAKE_WEBSITE || ''
try { require('fs').unlinkSync(process.env.DB_PATH) } catch (_) {}

const { Database, defaultGroupSettings } = require(path.join(BOT, 'src/database'))
const moderation = require(path.join(BOT, 'src/lib/moderation'))
const Monitor = require(path.join(BOT, 'src/lib/monitor'))
const Marketing = require(path.join(BOT, 'src/lib/marketing'))
const config = require(path.join(BOT, 'src/config'))
const { handle } = require(path.join(BOT, 'src/handler'))
const { loadCommands } = require(path.join(BOT, 'src/commands'))
const { handleParticipantsUpdate } = require(path.join(BOT, 'src/events/groups'))

const OWNER = '6281234567890@s.whatsapp.net'
const MEMBER = '628999888777@s.whatsapp.net'
const GROUP = '111-222@g.us'
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { cond ? (pass++, console.log(`  ✅ ${name}`)) : (fail++, console.log(`  ❌ ${name} ${extra}`)) }

function makeSock(participants) {
  const sent = []
  return {
    sent,
    user: { id: OWNER.replace('@', ':9@') },
    sendMessage: async (jid, content, opts) => { sent.push({ jid, content, opts }); return {} },
    groupMetadata: async (jid) => ({ id: jid, subject: 'G', participants }),
    groupParticipantsUpdate: async (jid, jids, act) => { sent.push({ jid, act, jids }); return {} },
    store: { groupMetadata: new Map(), messages: new Map() },
  }
}
const parts = [
  { id: OWNER, jid: OWNER, admin: 'superadmin' },
  { id: MEMBER, jid: MEMBER, admin: null },
]
function msgM(sock, text, sender = MEMBER, chat = GROUP) {
  return {
    sock, conn: sock, db: null, config, func: require(path.join(BOT, 'src/lib/func')),
    message: { conversation: text }, body: text, text,
    key: { remoteJid: chat, fromMe: false, participant: sender, id: 'X' + Math.random() },
    chat, sender, isGroup: chat.endsWith('@g.us'), fromMe: false,
    mentionedJid: [], media: null, quoted: null, isOwner: sender === OWNER, isAdmin: false, isBotAdmin: true,
  }
}

async function testAntiFlood() {
  console.log('\n[1] ANTI FLOOD (antispam OFF, antiflood ON)')
  const db = new Database(process.env.DB_PATH)
  const g = db.getGroup(GROUP)
  g.antiflood = true; g.antispam = false; g.floodLimit = 5; g.floodWindow = 10
  const sock = makeSock(parts)
  let deleted = 0
  sock.sendMessage = async (jid, content) => { if (content && content.delete) deleted++; sock.sent.push({ jid, content }); return {} }
  for (let i = 0; i < 12; i++) {
    await moderation.run(sock, db, msgM(sock, 'pesan unik nomor ' + i))
  }
  ok('pesan dihapus saat flood (limit 5)', deleted > 0, `-> deleted=${deleted} (diharapkan > 0)`)
}

async function testAntiSpam() {
  console.log('\n[2] ANTI SPAM (pesan sama 6x)')
  const db = new Database(process.env.DB_PATH)
  const g = db.getGroup(GROUP)
  g.antispam = true; g.antiflood = false
  const sock = makeSock(parts)
  let deleted = 0
  sock.sendMessage = async (jid, content) => { if (content && content.delete) deleted++; sock.sent.push({ jid, content }); return {} }
  for (let i = 0; i < 6; i++) await moderation.run(sock, db, msgM(sock, 'spam sama persis'))
  ok('pesan spam dihapus', deleted > 0, `-> deleted=${deleted}`)
}

async function testAntiLinkWhitelist() {
  console.log('\n[3] ANTI LINK + WHITELIST')
  const db = new Database(process.env.DB_PATH)
  const g = db.getGroup(GROUP)
  g.antilink = true
  g.wlLinks = ['wangstore.id']
  const sock = makeSock(parts)
  const del = []
  sock.sendMessage = async (jid, content) => { if (content && content.delete) del.push(content); sock.sent.push({ jid, content }); return {} }
  await moderation.run(sock, db, msgM(sock, 'cek https://wangstore.id ya'))
  ok('link whitelist TIDAK dihapus', del.length === 0, `-> deleted=${del.length}`)
  await moderation.run(sock, db, msgM(sock, 'cek https://jahat.com ya'))
  ok('link non-whitelist dihapus', del.length === 1, `-> deleted=${del.length}`)
}

async function testMonitorAlert() {
  console.log('\n[4] MONITOR: alert RAM/CPU/Disk di atas threshold')
  const db = new Database(process.env.DB_PATH)
  db.data.monitor.lastNodeState = {}
  const sock = makeSock(parts)
  const alerts = []
  sock.sendMessage = async (jid, content) => { alerts.push(content.text || ''); return {} }
  await Monitor.now(sock, db)   // tick 1
  const t1 = alerts.join('\n')
  alerts.length = 0
  await Monitor.now(sock, db)   // tick 2
  const t2 = alerts.join('\n')
  ok('tick-1 memberi alert resource tinggi (node2 RAM 95%)', /RAM Tinggi/.test(t1), `-> ${t1 ? JSON.stringify(t1.slice(0, 160)) : '(tidak ada alert)'}`)
  ok('tick-2 tidak mengulang alert yang sama', !/RAM Tinggi/.test(t2), `-> ${JSON.stringify(t2.slice(0, 120))}`)
  ok('node maintenance tidak dilapor sebagai Offline', !/Node Offline[\s\S]*NODE-SGP-02/.test(t1 + t2), '-> masih dilapor offline')
}

async function testMarketingSchedule() {
  console.log('\n[5] MARKETING: scheduler')
  const db = new Database(process.env.DB_PATH)
  const mk = db.data.marketing
  mk.enabled = true; mk.paused = false; mk.intervalMinutes = 0
  mk.schedule = '23:59' // jam yang belum tiba
  mk.templates = ['Promo {website}']
  mk.groups = [GROUP]
  mk.lastSent = Date.now() - 45 * 60000 // 45 menit lalu
  const sock = makeSock(parts)
  let promoSent = 0
  sock.sendMessage = async (jid, content) => { if (/Promo/.test(content.text || '')) promoSent++; return {} }

  const r1 = await Marketing.tick(sock, db)
  ok('mode schedule-only (interval 0) TIDAK kirim otomatis', r1.sent === false && promoSent === 0,
    `-> ${JSON.stringify(r1)} promoSent=${promoSent}`)

  mk.intervalMinutes = 60
  mk.lastSent = Date.now() - 45 * 60000
  const r2 = await Marketing.tick(sock, db)
  ok('interval 60 menit belum jatuh tempo (45 menit lalu) -> tidak kirim', r2.sent === false, JSON.stringify(r2))

  mk.lastSent = Date.now() - 61 * 60000
  const r3 = await Marketing.tick(sock, db)
  ok('interval 60 menit sudah lewat -> kirim 1 promo', r3.sent === true && promoSent === 1, `-> ${JSON.stringify(r3)} promoSent=${promoSent}`)

  mk.intervalMinutes = 10 // di bawah MIN_INTERVAL 30
  mk.lastSent = Date.now() - 20 * 60000
  const r4 = await Marketing.tick(sock, db)
  ok('interval 10 menit dibatasi minimum 30 menit (anti-flag)', r4.sent === false, JSON.stringify(r4))

  mk.enabled = false
  const res = await Marketing.send(sock, db, true)
  ok('kirim manual tetap jalan walau auto off', res.ok && res.sent === 1, JSON.stringify(res))
}

async function testWelcomeGoodbye() {
  console.log('\n[6] EVENT GRUP: welcome/goodbye')
  const db = new Database(process.env.DB_PATH)
  const g = db.getGroup(GROUP)
  g.welcome = true; g.welcomeText = 'Halo @user di @subject'
  g.goodbye = true; g.goodbyeText = 'Bye @user'
  const sock = makeSock(parts)
  await handleParticipantsUpdate(sock, db, { id: GROUP, participants: [MEMBER], action: 'add' })
  const welcome = sock.sent.find((s) => /Halo /.test(s.content && s.content.text || ''))
  ok('welcome terkirim', !!welcome)
  ok('welcome menyebut jid yang benar', welcome && welcome.content.mentions[0] === MEMBER, JSON.stringify(welcome && welcome.content.mentions))
  ok('placeholder @user terganti nomor', welcome && /Halo @628999888777 di G/.test(welcome.content.text), welcome && welcome.content.text)
  const sock2 = makeSock(parts)
  await handleParticipantsUpdate(sock2, db, { id: GROUP, participants: [MEMBER], action: 'remove' })
  ok('goodbye terkirim', sock2.sent.some((s) => /Bye @628999888777/.test(s.content && s.content.text || '')))
}

async function testBroadcastBatch() {
  console.log('\n[7] BROADCAST: batch 20 dari 25 grup, apakah sisa grup bisa terkirim saat diulang?')
  const db = new Database(process.env.DB_PATH)
  for (let i = 0; i < 25; i++) db.data.groups[`grp${String(i).padStart(2, '0')}@g.us`] = defaultGroupSettings()
  const sock = makeSock(parts)
  const loader = loadCommands()
  const sentGroups = []
  sock.sendMessage = async (jid, content) => { sentGroups.push(jid); return {} }
  const run = async () => {
    sentGroups.length = 0
    await handle(sock, db, loader, {
      key: { remoteJid: GROUP, fromMe: false, participant: OWNER, id: 'BC' + Math.random() },
      message: { conversation: '.broadcast pengumuman' }, pushName: 'O',
    })
    return [...new Set(sentGroups)]
  }
  const first = await run()
  const second = await run()
  const newOnes = second.filter((g) => !first.includes(g))
  ok('kiriman pertama dibatasi 20 grup (+1 balasan)', first.length <= 21, `-> ${first.length}`)
  ok('mengulang .broadcast menjangkau grup sisanya', newOnes.length > 0, `-> grup baru di percobaan ke-2: ${newOnes.length} (pesan bot bilang "Ulangi command untuk lanjut")`)
}

async function testAddOwnerSecurity() {
  console.log('\n[8] KEAMANAN: .addowner tanpa proteksi owner')
  const db = new Database(process.env.DB_PATH)
  const loader = loadCommands()
  const sock = makeSock(parts)
  await handle(sock, db, loader, {
    key: { remoteJid: GROUP, fromMe: false, participant: MEMBER, id: 'AO1' },
    message: { conversation: '.addowner' }, pushName: 'Orang Asing',
  })
  ok('user biasa TIDAK bisa menjadikan dirinya owner', !db.data.owners.includes(MEMBER),
    `-> owners sekarang: ${JSON.stringify(db.data.owners)}`)
  const isOwnerNow = require(path.join(BOT, 'src/lib/func')).isOwner(MEMBER, db)
  ok('user biasa tidak diakui owner setelahnya', isOwnerNow === false)
}

async function testPrefixPersist() {
  console.log('\n[9] PREFIX: persist setelah .setprefix')
  const db = new Database(process.env.DB_PATH)
  const loader = loadCommands()
  const sock = makeSock(parts)
  await handle(sock, db, loader, {
    key: { remoteJid: GROUP, fromMe: false, participant: OWNER, id: 'SP1' },
    message: { conversation: '.setprefix !' }, pushName: 'O',
  })
  ok('config.prefix berubah jadi !', config.prefix === '!', `-> "${config.prefix}"`)
  db.save(true)
  const db2 = new Database(process.env.DB_PATH)
  ok('prefix tersimpan di db.data.runtime.prefix', db2.data.runtime && db2.data.runtime.prefix === '!', JSON.stringify(db2.data.runtime))
  config.prefix = '.'
}

async function testWarnKick() {
  console.log('\n[10] WARN + AUTOKICK')
  const db = new Database(process.env.DB_PATH)
  const g = db.getGroup(GROUP)
  g.warnLimit = 2; g.autokick = true
  const loader = loadCommands()
  const sock = makeSock(parts)
  const kickMsg = {
    key: { remoteJid: GROUP, fromMe: false, participant: OWNER, id: 'W1' },
    message: { extendedTextMessage: { text: '.warn spam', contextInfo: { mentionedJid: [MEMBER] } } },
    pushName: 'O',
  }
  await handle(sock, db, loader, kickMsg)
  await handle(sock, db, loader, { ...kickMsg, key: { ...kickMsg.key, id: 'W2' } })
  const kicked = sock.sent.some((s) => s.act === 'remove' || s.content?.delete)
  ok('member di-kick setelah 2 warn', sock.sent.some((s) => (s.content && /Dikeluarkan/.test(s.content.text || ''))) , JSON.stringify(sock.sent.map(s=>s.content&&s.content.text||s.act).slice(0,6)))
  ok('warning direset setelah kick', Object.keys(db.data.warnings).length === 0, JSON.stringify(db.data.warnings))
}

;(async () => {
  const T = async (label, fn) => { const t0 = Date.now(); await fn(); console.log(`  ⏱️ ${label}: ${((Date.now() - t0) / 1000).toFixed(1)}s`) }
  await T('antiflood', testAntiFlood)
  await T('testAntiSpam', testAntiSpam)
  await T('testAntiLinkWhitelist', testAntiLinkWhitelist)
  if (process.env.FAKE_PANEL) await T('monitor', testMonitorAlert); else console.log('\n[4] dilewati (butuh FAKE_PANEL)')
  await T('testMarketingSchedule', testMarketingSchedule)
  await T('testWelcomeGoodbye', testWelcomeGoodbye)
  await T('testBroadcastBatch', testBroadcastBatch)
  await T('testAddOwnerSecurity', testAddOwnerSecurity)
  await T('testPrefixPersist', testPrefixPersist)
  await T('testWarnKick', testWarnKick)
  console.log(`\n===== HASIL: ${pass} lulus, ${fail} gagal =====`)
  process.exit(fail ? 1 : 0)
})()
