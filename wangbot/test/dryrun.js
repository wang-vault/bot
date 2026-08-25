// Dry-run harness: jalankan SEMUA command lewat handler asli (src/handler.js)
// dengan sock/db palsu.
//
//   node test/dryrun.js
//   FAKE_PANEL=http://127.0.0.1:8791 FAKE_WEBSITE=http://127.0.0.1:8791 node test/dryrun.js
//
// (fake panel: node test/fake-panel.js)
const path = require('path')
const BOT = path.resolve(__dirname, '..')

process.env.OWNER_NUMBER = '6281234567890'
process.env.BROADCAST_DELAY = process.env.BROADCAST_DELAY || '0' // jangan menunggu 5 detik/grup saat test
process.env.PREFIX = '.'
process.env.BOT_NAME = 'WangBot'
process.env.DB_PATH = path.join(require('os').tmpdir(), 'wangbot-dryrun-db.json')
process.env.AUTH_PATH = path.join(require('os').tmpdir(), 'wangbot-dryrun-auth')
process.env.WANGSTORE_WEBSITE = process.env.FAKE_WEBSITE || 'https://wangstore.id'
process.env.WANGSTORE_PANEL = 'https://panel.wangstore.id'
process.env.COMMUNITY_GROUP = 'https://chat.whatsapp.com/AAAA'
process.env.ADMIN_CONTACT = '6281234567890'
process.env.WHATSAPP_ADMIN = '6281234567890'
process.env.PANEL_API_URL = process.env.FAKE_PANEL || ''
process.env.PANEL_API_TOKEN = process.env.FAKE_PANEL ? 'tok' : ''
process.env.MONITOR_INTERVAL = '60'

// bersih db
try { require('fs').unlinkSync(process.env.DB_PATH) } catch (_) {}

const { Database } = require(path.join(BOT, 'src/database'))
const { loadCommands } = require(path.join(BOT, 'src/commands'))
const { handle, buildM } = require(path.join(BOT, 'src/handler'))
const config = require(path.join(BOT, 'src/config'))

const OWNER = '6281234567890@s.whatsapp.net'
const USER = '628999000111@s.whatsapp.net'
const GROUP = '123456789-111@g.us'

function makeParticipants(sender) {
  const base = [
    { id: OWNER, jid: OWNER, admin: 'superadmin' },
    { id: USER, jid: USER, admin: null },
    { id: '628777@s.whatsapp.net', jid: '628777@s.whatsapp.net', admin: 'admin' },
    { id: '628555@s.whatsapp.net', jid: '628555@s.whatsapp.net', admin: null },
    { id: '628111@s.whatsapp.net', jid: '628111@s.whatsapp.net', admin: null },
  ]
  if (sender && !base.some((p) => p.id === sender)) base.push({ id: sender, jid: sender, admin: null })
  return base
}

function makeSock() {
  const sent = []
  const sock = {
    user: { id: OWNER.replace('@', ':9@'), name: 'WangBot' },
    sent,
    store: { groupMetadata: new Map(), messages: new Map() },
    sendMessage: async (jid, content, opts) => { sent.push({ jid, content, opts }); return { key: { id: 'SENT' + sent.length } } },
    groupMetadata: async (jid) => ({ id: jid, subject: 'Grup Uji Coba', participants: makeParticipants(sock.__sender) }),
    groupParticipantsUpdate: async (jid, jids, act) => { sent.push({ jid, action: 'participants', act, jids }); return {} },
    groupSettingUpdate: async () => ({}),
    groupInviteCode: async () => 'ABC123CODE',
    groupRevokeInvite: async () => 'NEWCODE999',
    groupAcceptInvite: async (code) => '999@g.us',
    groupLeave: async () => ({}),
    groupFetchAllParticipating: async () => ({ [GROUP]: { id: GROUP, subject: 'Grup Uji Coba' } }),
    updateBlockStatus: async () => ({}),
    updateProfilePicture: async () => ({}),
    profilePictureUrl: async () => 'https://i.ibb.co/x.jpg',
    onWhatsApp: async (nums) => nums.map((n) => ({ jid: n, exists: true })),
    fetchStatus: async () => ({ status: 'hai' }),
    sendPresenceUpdate: async () => ({}),
    presenceSubscribe: async () => ({}),
    relayMessage: async () => true,
    logout: async () => ({}),
  }
  return sock
}

function rawMsg(text, opts = {}) {
  const inGroup = opts.group !== false
  return {
    key: {
      remoteJid: inGroup ? GROUP : USER,
      fromMe: !!opts.fromMe,
      participant: inGroup ? opts.sender || USER : undefined,
      id: 'MSG' + Math.random().toString(36).slice(2, 8).toUpperCase(),
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
  if (content.caption) return content.caption
  return JSON.stringify(content).slice(0, 200)
}

async function main() {
  const db = new Database(config.dbPath)
  require(path.join(BOT, 'src/database')).Database.instance = db
  const loader = loadCommands()

  console.log(`\n== COMMAND TERLOAD: ${loader.commands.length} ==`)
  const byCat = {}
  for (const c of loader.commands) byCat[c.category] = (byCat[c.category] || 0) + 1
  console.log(JSON.stringify(byCat, null, 0))

  // duplikat nama / alias
  const seenName = {}
  const dupes = []
  for (const c of loader.commands) {
    const k = c.name.toLowerCase()
    if (seenName[k]) dupes.push(`name duplikat: ${k} (${seenName[k]} & ${c.file || c.category})`)
    seenName[k] = c.category
    for (const a of c.aliases || []) {
      if (seenName[a]) dupes.push(`alias "${a}" bentrok dgn "${seenName[a]}" (dari ${c.name})`)
      else seenName[a] = c.name
    }
  }
  if (dupes.length) console.log('\n== KONFLIK NAMA/ALIAS ==\n' + dupes.join('\n'))
  else console.log('\nTidak ada konflik nama/alias.')

  const results = []
  const order = [...loader.commands].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))

  for (let idx = 0; idx < order.length; idx++) {
    const c = order[idx]
    // pilih konteks yang cocok
    const groupCtx = c.isPrivate ? false : true
    const sock = makeSock()
    // sender unik tiap command agar tidak kena rate limit harness
    const sender = c.isOwner ? OWNER : `62899${String(idx).padStart(6, '0')}@s.whatsapp.net`
    sock.__sender = sender
    config.prefix = '.' // reset (command .setprefix mengubah global)
    const text = `.${c.name} ${sampleArg(c)}`.trim()
    const before = sock.sent.length
    let err = null
    try {
      await handle(sock, db, loader, rawMsg(text, { group: groupCtx, sender }))
    } catch (e) {
      err = e
    }
    const newSent = sock.sent.slice(before)
    const reply = newSent.map((s) => textOf(s.content)).filter(Boolean).join(' || ')
    results.push({
      cmd: c.name,
      cat: c.category,
      flags: [c.isOwner && 'owner', c.isAdmin && 'admin', c.isBotAdmin && 'botadmin', c.isGroup && 'group', c.isPrivate && 'private', c.cooldown && 'cd'].filter(Boolean).join(','),
      err: err ? err.message : null,
      sent: newSent.length,
      reply: reply.replace(/\s+/g, ' ').slice(0, 220),
    })
    // tunggu cooldown cache tidak mengganggu: nama key beda tiap command
  }

  const failed = results.filter((r) => r.err)
  const silent = results.filter((r) => !r.err && r.sent === 0)

  console.log(`\n== RINGKASAN: ${results.length} command diuji ==`)
  console.log(`  error   : ${failed.length}`)
  console.log(`  tanpa balasan (0 pesan terkirim): ${silent.length}`)

  console.log('\n== ERROR ==')
  for (const r of failed) console.log(`  [${r.cat}] .${r.cmd} (${r.flags}) -> ${r.err}`)

  console.log('\n== TANPA BALASAN ==')
  for (const r of silent) console.log(`  [${r.cat}] .${r.cmd} (${r.flags})`)

  console.log('\n== DETAIL BALASAN ==')
  for (const r of results) console.log(`  [${r.cat}] .${r.cmd} (${r.flags}) => ${r.err ? 'ERR' : r.reply || '(kosong)'}`)

  require('fs').writeFileSync(path.join(require('os').tmpdir(), 'wangbot-dryrun-results.json'), JSON.stringify(results, null, 2))
}

function sampleArg(c) {
  const n = c.name.toLowerCase()
  if (/^(eval|exec|bc|broadcast|addowner|delowner|setprefix|join|leave|addfaq|delfaq|setrules|setwelcome|setgoodbye|promoset|promogroup|promotemplate|setinfo|tagall|hidetag|kick|add|warn|delwarn|blacklist|whitelist|backup|restore|feedback|laporan|suit|tebakangka|wm|smeme|tsticker|sticker|afk|cs|maintenance|gitpull|restart|paneltest)$/.test(n)) return sampleFor(n)
  return ''
}

function sampleFor(n) {
  const map = {
    eval: '1+1',
    exec: 'echo hi',
    bc: 'halo semua',
    broadcast: 'halo semua',
    addowner: '628111222333',
    delowner: '628111222333',
    setprefix: '!',
    join: 'https://chat.whatsapp.com/XYZ',
    leave: '',
    addfaq: 'cara bayar|transfer ke rekening',
    delfaq: 'cara bayar',
    setrules: '1. sopan 2. no spam',
    setwelcome: 'hai @user di @subject',
    setgoodbye: 'bye @user',
    promoset: 'interval 60',
    promogroup: 'add 123456789-111@g.us',
    promotemplate: 'add Promo {website} murah',
    setinfo: 'paket teks baru',
    tagall: 'halo',
    hidetag: 'halo',
    kick: '@628555',
    add: '628111222333',
    warn: '@628555 spam',
    delwarn: '@628555',
    blacklist: 'add 628111222333',
    whitelist: 'add 628111222333',
    backup: '',
    restore: '',
    feedback: 'botnya bagus',
    laporan: 'ada error',
    suit: 'batu',
    tebakangka: '50',
    wm: 'Pack|Author',
    smeme: 'atas|bawah',
    tsticker: 'halo dunia',
    sticker: '',
    afk: 'makan',
    cs: '',
    maintenance: 'on',
    gitpull: '',
    restart: '',
    paneltest: '',
  }
  return map[n] || ''
}

main().catch((e) => { console.error('HARNESS FATAL', e); process.exit(1) })
