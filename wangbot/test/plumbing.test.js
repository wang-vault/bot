// Test lapisan plumbing: database, handler, message parser.
//   node test/plumbing.test.js
const path = require('path')
const fs = require('fs')
const os = require('os')
const BOT = path.resolve(__dirname, '..')

process.env.OWNER_NUMBER = '6281234567890'
process.env.DB_PATH = path.join(os.tmpdir(), 'wangbot-plumbing-db.json')
process.env.BROADCAST_DELAY = process.env.BROADCAST_DELAY || '0'

const { Database } = require(path.join(BOT, 'src/database'))
const { getBody, getMediaType } = require(path.join(BOT, 'src/lib/message'))
const handler = require(path.join(BOT, 'src/handler'))
const { buildM } = handler

const OWNER = '6281234567890@s.whatsapp.net'
const GROUP = '120363000000000000@g.us'
const dbPath = process.env.DB_PATH
let pass = 0
let fail = 0
const ok = (n, c, x = '') => { c ? (pass++, console.log(`  ✅ ${n}`)) : (fail++, console.log(`  ❌ ${n} ${x}`)) }

function makeSock(participants = []) {
  return {
    user: { id: OWNER.replace('@', ':9@') },
    sendMessage: async (jid, content, opts) => ({ jid, content, opts }),
    groupMetadata: async (jid) => ({ id: jid, subject: 'G', participants }),
    store: { groupMetadata: new Map(), messages: new Map() },
  }
}

function cleanDb() {
  for (const f of fs.readdirSync(path.dirname(dbPath))) {
    if (f.startsWith(path.basename(dbPath))) fs.unlinkSync(path.join(path.dirname(dbPath), f))
  }
}

async function main() {
  // ---------------------------------------------------------------- [A]
  console.log('\n[A] DATABASE: file utama korup')
  cleanDb()
  const db = new Database(dbPath)
  db.addOwner('628777@s.whatsapp.net')
  db.getGroup(GROUP).antilink = true
  db.data.feedback.push({ from: OWNER, text: 'penting', time: 1 })
  db.save(true)
  db.save(true) // save kedua supaya .bak terbentuk
  ok('db + cadangan .bak tertulis', fs.existsSync(dbPath) && fs.existsSync(dbPath + '.bak'))

  fs.writeFileSync(dbPath, '{"owners":["628777@s.whatsapp.net"], "groups": {') // korup
  const db2 = new Database(dbPath)
  ok('data dipulihkan dari .bak, bukan hilang', db2.data.owners.includes('628777@s.whatsapp.net'),
    `-> owners jadi: ${JSON.stringify(db2.data.owners)}`)
  ok('setting grup ikut pulih', db2.data.groups[GROUP] && db2.data.groups[GROUP].antilink === true)
  ok('bukti file korup disimpan', fs.readdirSync(path.dirname(dbPath)).some((f) => f.includes('.corrupt-')))

  // korup dua-duanya
  fs.writeFileSync(dbPath, 'not json')
  fs.writeFileSync(dbPath + '.bak', 'not json either')
  const db3 = new Database(dbPath)
  ok('kalau keduanya korup -> mulai kosong tapi tidak crash', Array.isArray(db3.data.owners) && db3.data.owners.length === 0)

  // ---------------------------------------------------------------- [B]
  console.log('\n[B] DATABASE: penulisan atomik')
  cleanDb()
  const dbB = new Database(dbPath)
  dbB.data.owners = ['628777@s.whatsapp.net']
  dbB.save(true)
  const sisa = fs.readdirSync(path.dirname(dbPath)).filter((f) => f.endsWith('.tmp'))
  ok('tidak ada file .tmp tertinggal', sisa.length === 0, `-> ${sisa.join(', ')}`)
  ok('isi file valid & benar', JSON.parse(fs.readFileSync(dbPath, 'utf8')).owners[0] === '628777@s.whatsapp.net')

  // ---------------------------------------------------------------- [C]
  console.log('\n[C] HANDLER: bucket rate-limit tidak bocor')
  cleanDb()
  const dbC = new Database(dbPath)
  const sockC = makeSock([{ id: OWNER, jid: OWNER, admin: 'superadmin' }])
  const emptyLoader = { commands: [], byName: {}, byAlias: {}, resolve: () => null }
  for (let i = 0; i < 5000; i++) {
    const sender = `62899${String(i).padStart(7, '0')}@s.whatsapp.net`
    await handler.handle(sockC, dbC, emptyLoader, {
      key: { remoteJid: GROUP, fromMe: false, participant: sender, id: 'R' + i },
      message: { conversation: '.ping' },
      pushName: 'x',
    })
  }
  const tumbuh = handler._rateBucket.size
  ok('bucket bertambah per pengirim (memang perlu dibersihkan)', tumbuh === 5000, `-> ${tumbuh}`)
  const setelah = handler._pruneRateBuckets(Date.now() + 300000) // seolah 5 menit berlalu
  ok('bucket lama dibersihkan', setelah === 0, `-> sisa ${setelah}`)

  // ---------------------------------------------------------------- [D]
  console.log('\n[D] MESSAGE: parser caption & tipe media')
  ok('conversation', getBody({ conversation: '.ping' }) === '.ping')
  ok('extendedTextMessage', getBody({ extendedTextMessage: { text: '.ping' } }) === '.ping')
  ok('imageMessage caption', getBody({ imageMessage: { caption: '.sticker' } }) === '.sticker')
  const dwc = { documentWithCaptionMessage: { message: { imageMessage: { caption: '.sticker' } } } }
  ok('documentWithCaptionMessage: caption terbaca', getBody(dwc) === '.sticker', `-> "${getBody(dwc)}"`)
  ok('documentWithCaptionMessage: tipe media image', (getMediaType(dwc) || {}).type === 'image',
    `-> ${JSON.stringify(getMediaType(dwc))}`)
  const doc = { documentWithCaptionMessage: { message: { documentMessage: { caption: '.restore', fileName: 'db.json' } } } }
  ok('documentWithCaptionMessage: dokumen + caption', getBody(doc) === '.restore' && getMediaType(doc).type === 'document')

  // ---------------------------------------------------------------- [E]
  console.log('\n[E] HANDLER: LID + admin di grup "sembunyikan nomor"')
  cleanDb()
  const dbE = new Database(dbPath)
  const LID = '123456789@lid'
  const GROUP_LID = '999000111-222@g.us' // jid unik: handler meng-cache metadata per grup (TTL 60 detik)
  const sockE = makeSock([
    { id: OWNER, jid: OWNER, admin: 'superadmin' },
    { id: '628111222333@s.whatsapp.net', jid: '628111222333@s.whatsapp.net', lid: LID, admin: 'admin' },
  ])
  const m = await buildM(sockE, {
    key: { remoteJid: GROUP_LID, fromMe: false, participant: LID, id: 'L1' },
    message: { conversation: '.ping' },
    pushName: 'Member LID',
  }, dbE, emptyLoader)
  ok('@lid di-resolve ke nomor asli', m.sender === '628111222333@s.whatsapp.net', `-> ${m.sender}`)
  ok('admin tetap dikenali setelah resolve', m.isAdmin === true, `-> isAdmin=${m.isAdmin}`)
  ok('bot admin terdeteksi', m.isBotAdmin === true)

  // owner lewat @lid
  const GROUP_LID2 = '999000333-444@g.us'
  const sockO = makeSock([{ id: OWNER, jid: OWNER, lid: '999@lid', admin: 'superadmin' }])
  const mo = await buildM(sockO, {
    key: { remoteJid: GROUP_LID2, fromMe: false, participant: '999@lid', id: 'L2' },
    message: { conversation: '.ping' },
  }, dbE, emptyLoader)
  ok('owner dikenali meski mengirim sebagai @lid', mo.isOwner === true, `-> sender=${mo.sender} isOwner=${mo.isOwner}`)

  // ---------------------------------------------------------------- [F]
  console.log('\n[F] HANDLER: cache metadata dibatalkan saat anggota berubah')
  cleanDb()
  const dbF = new Database(dbPath)
  const GF = '555000111-222@g.us'
  const MEMBER = '628555000111@s.whatsapp.net'
  let isAdminNow = false
  const sockF = makeSock([{ id: OWNER, jid: OWNER, admin: 'superadmin' }, { id: MEMBER, jid: MEMBER, admin: isAdminNow ? 'admin' : null }])
  sockF.groupMetadata = async (jid) => ({ id: jid, subject: 'G', participants: [{ id: OWNER, jid: OWNER, admin: 'superadmin' }, { id: MEMBER, jid: MEMBER, admin: isAdminNow ? 'admin' : null }] })
  const mkMsg = (id) => ({ key: { remoteJid: GF, fromMe: false, participant: MEMBER, id }, message: { conversation: '.ping' } })
  const before = await buildM(sockF, mkMsg('F1'), dbF, emptyLoader)
  ok('mula-mula bukan admin', before.isAdmin === false)
  isAdminNow = true // member dipromosikan jadi admin
  await require(path.join(BOT, 'src/events/groups')).handleParticipantsUpdate(sockF, dbF, { id: GF, participants: [MEMBER], action: 'promote' })
  const after = await buildM(sockF, mkMsg('F2'), dbF, emptyLoader)
  ok('setelah promote, status admin langsung terbaca (cache dibatalkan)', after.isAdmin === true,
    `-> isAdmin=${after.isAdmin} (cache metadata 60 detik masih menahan data lama)`)

  console.log(`\n===== HASIL: ${pass} lulus, ${fail} gagal =====`)
  cleanDb()
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
