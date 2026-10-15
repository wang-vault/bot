// Test lapisan identitas: owner & pengguna selalu memakai NOMOR WhatsApp
// (@s.whatsapp.net), LID (@lid) hanya dipakai sebagai kunci pencarian nomor.
//
//   node test/identity.test.js
const path = require('path')
const fs = require('fs')
const os = require('os')
const BOT = path.resolve(__dirname, '..')

process.env.OWNER_NUMBER = '6281234567890'
process.env.PREFIX = '.'
process.env.BROADCAST_DELAY = process.env.BROADCAST_DELAY || '0'
process.env.DB_PATH = path.join(os.tmpdir(), 'wangbot-identity-db.json')
delete process.env.OWNER_LID
delete process.env.OWNER_LID_MAP

// Semua database uji dihapus dulu supaya hasilnya sama di setiap run
// (pemetaan LID tersimpan di dalam file database).
const TMP = (name) => path.join(os.tmpdir(), `wangbot-identity-${name}.json`)
for (const name of ['db', 'fresh', 'c2', 'e', 'f', 'f2', 'g', 'h']) {
  for (const suffix of ['', '.bak']) {
    try {
      fs.unlinkSync(TMP(name) + suffix)
    } catch (_) {}
  }
}
process.env.DB_PATH = TMP('db')

const Identity = require(path.join(BOT, 'src/lib/identity'))
const { Database } = require(path.join(BOT, 'src/database'))
const dbmod = require(path.join(BOT, 'src/database'))
const func = require(path.join(BOT, 'src/lib/func'))
const config = require(path.join(BOT, 'src/config'))
const { loadCommands } = require(path.join(BOT, 'src/commands'))
const handler = require(path.join(BOT, 'src/handler'))
const { handle, buildM } = handler

const OWNER = '6281234567890@s.whatsapp.net'
const ADMIN = '628777000111@s.whatsapp.net'
const MEMBER = '628555000111@s.whatsapp.net'
const OTHER_PN = '628888000222@s.whatsapp.net'
const OWNER_LID = '999888777666555@lid'
const MEMBER_LID = '111222333444555@lid'
const ADMIN_LID = '222333444555666@lid'
const UNKNOWN_LID = '777888999000111@lid'
const GROUP = '120363111111111111@g.us'
const GROUP2 = '120363222222222222@g.us'
const GROUP3 = '120363333333333333@g.us'

const fresh = new Database(TMP('fresh'))

let pass = 0
let fail = 0
const ok = (n, c, x = '') => {
  c ? (pass++, console.log(`  ✅ ${n}`)) : (fail++, console.log(`  ❌ ${n} ${x}`))
}

function makeSock(participants = []) {
  const sock = {
    sent: [],
    user: { id: OWNER.replace('@', ':9@'), lid: OWNER_LID },
    store: { groupMetadata: new Map(), messages: new Map() },
    sendMessage: async (jid, content, opts) => {
      sock.sent.push({ jid, content, opts })
      return { key: { id: 'T' + sock.sent.length } }
    },
    groupMetadata: async (jid) => ({ id: jid, subject: 'Grup Uji', participants }),
  }
  return sock
}

function raw(text, opts = {}) {
  const inGroup = !!opts.group
  return {
    key: {
      remoteJid: inGroup ? opts.group : opts.chat || OWNER,
      fromMe: false,
      participant: inGroup ? opts.sender : undefined,
      id: 'T' + Math.random().toString(36).slice(2, 8).toUpperCase(),
      ...(opts.key || {}),
    },
    message: { conversation: text },
    pushName: opts.pushName || 'Tester',
    messageTimestamp: Math.floor(Date.now() / 1000),
  }
}

function textOf(content) {
  if (!content) return ''
  if (typeof content === 'string') return content
  return content.text || ''
}

async function main() {
  const db = new Database(process.env.DB_PATH)
  dbmod.Database.instance = db
  const loader = loadCommands()

  // ---------------------------------------------------------------- [A]
  console.log('\n[A] HELPER: bentuk JID & nomor')
  ok('bare() membuang sufiks device', Identity.bare('6281234567890:9@s.whatsapp.net') === OWNER)
  ok('bare() menerima JID LID', Identity.bare('999@lid') === '999@lid')
  ok('bare() menolak yang bukan JID', Identity.bare('halo') === '' && Identity.bare('') === '')
  ok('num() menampilkan angka, bukan JID', Identity.num(OWNER) === '6281234567890')
  ok('isPn / isLid membedakan jenis JID', Identity.isPn(OWNER) && !Identity.isLid(OWNER) && Identity.isLid(OWNER_LID) && !Identity.isPn(OWNER_LID))
  ok('label() menandai LID sebagai LID', Identity.label(OWNER_LID) === 'LID:999888777666555' && Identity.label(OWNER) === '6281234567890')
  ok('asPn()/asLid() menormalkan angka', Identity.asPn('0812 3456 7890') === '081234567890@s.whatsapp.net' && Identity.asLid('999') === '999@lid')

  // ---------------------------------------------------------------- [B]
  console.log('\n[B] RESOLUSI: atribut stanza pesan (participant_pn / sender_pn)')
  const keyLid = '444555666777888@lid'
  const KEY = '628666000333@s.whatsapp.net'
  ok('participant_pn dipakai lebih dulu', Identity.resolve(keyLid, { db: fresh, key: { participantLid: keyLid, participantPn: KEY } }) === KEY)
  const senderLid = '555666777888999@lid'
  const KEY2 = '628666000444@s.whatsapp.net'
  ok('sender_pn dipakai untuk chat pribadi', Identity.resolve(senderLid, { db: fresh, key: { senderLid, senderPn: KEY2 } }) === KEY2)
  const lainLid = '901234567890123@lid' // belum pernah dipelajari bot
  ok('Pn milik LID LAIN tidak dipakai (tidak ketuker)', Identity.resolve(lainLid, { db: fresh, key: { senderLid: '123@lid', senderPn: KEY } }) === lainLid)
  ok('setelah dipelajari, pemetaan tetap dipakai walau stanza tak memuat pn', Identity.resolve(keyLid, { db: fresh }) === KEY)
  ok('JID nomor dikembalikan apa adanya', Identity.resolve(OWNER, { db: fresh }) === OWNER)

  // ---------------------------------------------------------------- [C]
  console.log('\n[C] RESOLUSI: metadata grup (participant.jid)')
  const participants = [
    { id: OWNER, jid: OWNER, lid: OWNER_LID, admin: 'superadmin' },
    { id: MEMBER_LID, jid: MEMBER, lid: MEMBER_LID, admin: null },
  ]
  ok('@lid -> nomor dari metadata grup', Identity.resolve(MEMBER_LID, { db: fresh, participants }) === MEMBER)
  ok('pnOfParticipant() mengembalikan NOMOR admin', Identity.pnOfParticipant(participants[1], { db: fresh, participants }) === MEMBER)
  const dbC2 = new Database(TMP('c2'))
  ok('LID yang nomornya tak ada di metadata dibiarkan (tanpa karangan)', Identity.resolve(MEMBER_LID, { db: dbC2, participants: [{ id: MEMBER_LID, lid: MEMBER_LID }] }) === MEMBER_LID)

  // ---------------------------------------------------------------- [D]
  console.log('\n[D] RESOLUSI: OWNER_LID_MAP dari .env')
  process.env.OWNER_LID_MAP = `${ADMIN_LID}:${ADMIN.split('@')[0]}`
  ok('config.lidMap membaca pasangan LID:nomor', config.lidMap[ADMIN_LID] === ADMIN, `-> ${JSON.stringify(config.lidMap)}`)
  ok('resolve() memakai OWNER_LID_MAP', Identity.resolve(ADMIN_LID, { db: fresh }) === ADMIN)
  ok('pasangan yang salah format diabaikan', (() => {
    process.env.OWNER_LID_MAP = 'bukan-pasangan'
    const empty = Object.keys(config.lidMap).length === 0
    process.env.OWNER_LID_MAP = `${ADMIN_LID}:${ADMIN.split('@')[0]}`
    return empty
  })())
  delete process.env.OWNER_LID_MAP

  // ---------------------------------------------------------------- [E]
  console.log('\n[E] PEMETAAN TERSIMPAN + MIGRASI DATA LAMA')
  const dbE = new Database(TMP('e'))
  dbE.data.owners.push(MEMBER_LID) // data lama: owner tersimpan sebagai LID
  dbE.data.users[MEMBER_LID] = { name: 'Budi', firstSeen: 1, lastSeen: 2, banned: false }
  dbE.data.blacklist.users.push(MEMBER_LID)
  dbE.data.pingl.staff.push(MEMBER_LID)
  dbE.data.minecraft.entries[MEMBER_LID] = { email: 'a@b.c', token: 't', servers: [] }
  dbE.data.minecraft.servers['s1'] = { name: 'Survival', ownerJid: MEMBER_LID, addedBy: MEMBER_LID, host: 'x', port: 25565 }
  dbE.data.assistant.pending['p1'] = { requestedBy: MEMBER_LID, action: 'x' }
  dbE.save(true)

  ok('LID yang belum dipetakan -> belum jadi nomor', Identity.resolve(MEMBER_LID, { db: dbE }) === MEMBER_LID)
  Identity.learn(dbE, MEMBER_LID, MEMBER)
  ok('pemetaan tersimpan di database', Identity.pnFor(dbE, MEMBER_LID) === MEMBER)
  ok('kebalikannya bisa: lidFor(nomor)', Identity.lidFor(dbE, MEMBER) === MEMBER_LID)
  ok('entri owner LID dipindah ke nomor', dbE.data.owners.includes(MEMBER) && !dbE.data.owners.includes(MEMBER_LID))
  ok('data pengguna ikut dipindah', !!dbE.data.users[MEMBER] && !dbE.data.users[MEMBER_LID])
  ok('blacklist ikut dipindah', dbE.data.blacklist.users.includes(MEMBER) && !dbE.data.blacklist.users.includes(MEMBER_LID))
  ok('staf ping ikut dipindah', dbE.data.pingl.staff.includes(MEMBER) && !dbE.data.pingl.staff.includes(MEMBER_LID))
  ok('entri pelanggan MC ikut dipindah', !!dbE.data.minecraft.entries[MEMBER] && !dbE.data.minecraft.entries[MEMBER_LID])
  ok('server MC milik LID ikut dipindah', dbE.data.minecraft.servers['s1'].ownerJid === MEMBER && dbE.data.minecraft.servers['s1'].addedBy === MEMBER)
  ok('tindakan agent yang menunggu approval ikut dipindah', dbE.data.assistant.pending['p1'].requestedBy === MEMBER)
  ok('pemetaan bertahan setelah restart', (() => {
    dbE.save(true) // save() normal di-debounce 400 ms; di sini ditulis paksa
    const reload = new Database(TMP('e'))
    return Identity.pnFor(reload, MEMBER_LID) === MEMBER
  })())
  ok('LID yang sudah dipetakan tidak lagi dihitung "pending"', !Identity.pendingFor(dbE, MEMBER_LID))
  ok('sinkron berikutnya tidak menulis ulang (belum berubah)', Identity.learn(dbE, MEMBER_LID, MEMBER) === MEMBER)

  // canonicalizeOwners: dipakai index.js saat bot menyala
  const OTHER_LID = '333444555666777@lid'
  Identity.learn(dbE, OTHER_LID, OTHER_PN)
  dbE.data.owners.push(OTHER_LID)
  dbE.data.owners.push(OTHER_LID) // duplikat sengaja: harus dibuang
  const fix = Identity.canonicalizeOwners(dbE)
  ok('canonicalizeOwners memindahkan entri LID -> nomor', fix.moved >= 1 && dbE.data.owners.includes(OTHER_PN) && !dbE.data.owners.includes(OTHER_LID), `-> moved=${fix.moved}`)
  ok('duplikat dibuang', dbE.data.owners.filter((o) => o === OTHER_PN).length === 1)
  const UNRESOLVED_LID = '444555666777888@lid'
  dbE.data.owners.push(UNRESOLVED_LID)
  const entriesE = Identity.ownerEntries(dbE)
  ok('entri LID tanpa nomor dilaporkan (bukan dianggap nomor)', entriesE.unresolved.includes(UNRESOLVED_LID) && !entriesE.pn.includes(UNRESOLVED_LID))
  ok('canonicalizeOwners mengembalikan daftar yang belum ketemu nomornya', Identity.canonicalizeOwners(dbE).unresolved.includes(UNRESOLVED_LID))

  // ---------------------------------------------------------------- [F]
  console.log('\n[F] OWNER: nomor WhatsApp, bukan LID')
  const dbF = new Database(TMP('f'))
  dbmod.Database.instance = dbF
  ok('nomor di OWNER_NUMBER dikenali', func.isOwner(OWNER, dbF) === true)
  ok('nomor lain bukan owner', func.isOwner('628000111222@s.whatsapp.net', dbF) === false)
  ok('daftar owner berisi NOMOR', JSON.stringify(func.ownerJids(dbF)) === JSON.stringify([OWNER]))
  Identity.learn(dbF, OWNER_LID, OWNER)
  ok('LID yang sudah dipetakan ke nomor owner dikenali', func.isOwner(OWNER_LID, dbF) === true)
  // Regresi celah lama: dulu ANGKA LID dibandingkan dengan ANGKA nomor owner,
  // jadi siapa pun yang LID-nya kebetulan sama bisa lolos jadi owner.
  ok('LID dengan angka mirip NOMOR LAIN tidak jadi owner', func.isOwner('628000111222@lid', dbF) === false)
  ok('LID dengan angka mirip NOMOR OWNER tidak jadi owner', func.isOwner('6281234567890@lid', dbF) === false)
  ok('nomor mentah (tanpa @...) juga dikenali sebagai owner', func.isOwner('6281234567890', dbF) === true)
  // Entri database lama yang belum berbentuk JID (nomor mentah) tetap dikenali
  ok('entri owner berupa nomor mentah dikenali', (() => {
    dbF.data.owners.push('081211112222')
    return func.isOwner('6281211112222@s.whatsapp.net', dbF) === true
  })())
  ok('canonicalizeOwners menormalkan nomor mentah jadi JID', (() => {
    const r = Identity.canonicalizeOwners(dbF)
    return r.changed && dbF.data.owners.includes('6281211112222@s.whatsapp.net') && !dbF.data.owners.includes('081211112222')
  })())
  // Entri LID yang MEMANG ditulis di daftar owner (data lama) tetap dihormati
  // sebagai jalan darurat; begitu nomornya diketahui, entri otomatis dipindah.
  dbF.data.owners.push('628000111222@lid')
  ok('entri LID yang eksplisit di daftar owner tetap dihormati', func.isOwner('628000111222@lid', dbF) === true)
  process.env.OWNER_LID = OWNER_LID
  ok('OWNER_LID yang dinyatakan eksplisit dihormati', func.isOwner(OWNER_LID, new Database(TMP('f2'))) === true)
  ok('OWNER_NUMBER berbentuk LID juga dihormati', (() => {
    process.env.OWNER_NUMBER = '6281234567890,555666777888999@lid'
    const respected = config.envOwners.includes(OWNER) && config.envOwnerLids.includes('555666777888999@lid')
    process.env.OWNER_NUMBER = '6281234567890'
    return respected
  })())
  delete process.env.OWNER_LID
  ok('db.addOwner() menormalkan input jadi JID nomor', (() => {
    const added = dbF.addOwner('08555000111')
    return added && dbF.data.owners.includes('628555000111@s.whatsapp.net')
  })())

  // ---------------------------------------------------------------- [G]
  console.log('\n[G] HANDLER: pesan ber-LID jadi NOMOR')
  const dbG = new Database(TMP('g'))
  dbmod.Database.instance = dbG

  // (a) chat pribadi ber-LID, WhatsApp menyertakan sender_pn
  const sockPriv = makeSock()
  const mPriv = await buildM(
    sockPriv,
    raw('.ping', { chat: OWNER_LID, key: { senderLid: OWNER_LID, senderPn: OWNER } }),
    dbG,
    loader
  )
  ok('chat pribadi: m.sender jadi NOMOR', mPriv.sender === OWNER, `-> ${mPriv.sender}`)
  ok('chat pribadi: LID mentah tetap dicatat untuk debug', mPriv.lid === OWNER_LID)
  ok('chat pribadi: owner dikenali', mPriv.isOwner === true)

  // (b) grup ber-LID ("sembunyikan nomor") — metadata memuat pasangan LID/nomor
  const sockGrp = makeSock([
    { id: OWNER_LID, jid: OWNER, lid: OWNER_LID, admin: 'superadmin' },
    { id: ADMIN_LID, jid: ADMIN, lid: ADMIN_LID, admin: 'admin' },
    { id: MEMBER_LID, jid: MEMBER, lid: MEMBER_LID, admin: null },
  ])
  const mGrp = await buildM(sockGrp, raw('.ping', { group: GROUP, sender: MEMBER_LID }), dbG, loader)
  ok('grup: peserta ber-LID jadi NOMOR', mGrp.sender === MEMBER)
  ok('grup: bukan admin', mGrp.isAdmin === false)
  const mGrpOwner = await buildM(sockGrp, raw('.ping', { group: GROUP2, sender: OWNER_LID }), dbG, loader)
  ok('grup: owner ber-LID dikenali sebagai owner', mGrpOwner.isOwner === true && mGrpOwner.isAdmin === true)
  ok('grup: daftar admin untuk DM berisi NOMOR', mGrpOwner.__admins.includes(ADMIN) && mGrpOwner.__admins.includes(OWNER), `-> ${JSON.stringify(mGrpOwner.__admins)}`)
  ok('grup: bot admin (via LID bot) terdeteksi', mGrpOwner.isBotAdmin === true)

  // (c) LID yang nomornya belum diketahui bot
  const sockUnknown = makeSock()
  const mUnknown = await buildM(sockUnknown, raw('.ping', { chat: UNKNOWN_LID, key: { senderLid: UNKNOWN_LID } }), dbG, loader)
  ok('LID tanpa pemetaan dibiarkan apa adanya', mUnknown.sender === UNKNOWN_LID)
  ok('LID tanpa pemetaan bukan owner', mUnknown.isOwner === false)
  ok('LID tanpa pemetaan dicatat untuk owner', !!Identity.pendingFor(dbG, UNKNOWN_LID))

  // (d) tanda tangan bot sendiri (sock.user.lid) dipakai
  const KEY_SELF = '666000555444333@lid'
  const selfSock = { ...makeSock(), user: { id: '628999000111:3@s.whatsapp.net', lid: KEY_SELF } }
  ok('LID bot sendiri -> nomor bot (auth creds)', Identity.resolve(KEY_SELF, { db: dbG, sock: selfSock }) === '628999000111@s.whatsapp.net')

  // ---------------------------------------------------------------- [H]
  console.log('\n[H] COMMAND: .addowner / .delowner / .id berbasis NOMOR')
  const dbH = new Database(TMP('h'))
  dbmod.Database.instance = dbH

  // bootstrap: belum ada owner sama sekali, pengirim hanya dikenal sebagai LID
  process.env.OWNER_NUMBER = ''
  const sockBoot = makeSock()
  await handle(sockBoot, dbH, loader, raw('.addowner', { chat: UNKNOWN_LID, key: { senderLid: UNKNOWN_LID } }))
  const bootReply = textOf(sockBoot.sent[0] && sockBoot.sent[0].content)
  ok('bootstrap: LID diminta menuliskan NOMOR', /LID/i.test(bootReply) && /addowner 081234567890/.test(bootReply), `-> ${bootReply.slice(0, 140)}`)
  ok('bootstrap: LID tidak disimpan sebagai owner', !dbH.data.owners.includes(UNKNOWN_LID))
  process.env.OWNER_NUMBER = '6281234567890'

  // owner menambah owner baru pakai nomor
  const sockAdd = makeSock()
  await handle(sockAdd, dbH, loader, raw('.addowner 0813-7777-8888', { chat: OWNER }))
  const addReply = textOf(sockAdd.sent[0] && sockAdd.sent[0].content)
  ok('owner ditambahkan sebagai NOMOR', dbH.data.owners.includes('6281377778888@s.whatsapp.net'), `-> ${JSON.stringify(dbH.data.owners)}`)
  ok('balasan menyebut nomor, bukan JID', /6281377778888/.test(addReply) && /bukan LID/.test(addReply))

  // menambahkan LID yang nomornya belum diketahui -> ditolak
  const sockAddLid = makeSock()
  await handle(sockAddLid, dbH, loader, raw('.addowner 123456789012345@lid', { chat: OWNER }))
  const addLidReply = textOf(sockAddLid.sent[0] && sockAddLid.sent[0].content)
  ok('LID tanpa nomor tidak bisa didaftarkan sebagai owner', !dbH.data.owners.includes('123456789012345@lid') && /LID/i.test(addLidReply))

  // non-owner tidak bisa menambah owner
  const sockBad = makeSock()
  await handle(sockBad, dbH, loader, raw('.addowner 0813-9999-0000', { chat: MEMBER }))
  const badReply = textOf(sockBad.sent[0] && sockBad.sent[0].content)
  ok('non-owner tetap ditolak', /Owner/.test(badReply) && !dbH.data.owners.includes('6281399990000@s.whatsapp.net'))

  // .delowner pakai nomor
  const sockDel = makeSock()
  await handle(sockDel, dbH, loader, raw('.delowner 081377778888', { chat: OWNER }))
  ok('.delowner menghapus berdasarkan NOMOR', !dbH.data.owners.includes('6281377778888@s.whatsapp.net'))

  // .id: identitas ditampilkan sebagai nomor + status LID
  const sockId = makeSock()
  await handle(sockId, dbH, loader, raw('.id', { chat: UNKNOWN_LID, key: { senderLid: UNKNOWN_LID } }))
  const idText = textOf(sockId.sent[0] && sockId.sent[0].content)
  ok('.id menampilkan LID pengirim & statusnya', /LID kamu/.test(idText) && /belum diketahui/.test(idText), `-> ${idText.slice(0, 160)}`)
  const sockIdOwner = makeSock()
  await handle(sockIdOwner, dbH, loader, raw('.id', { chat: OWNER }))
  const idOwnerText = textOf(sockIdOwner.sent[0] && sockIdOwner.sent[0].content)
  ok('.id owner menampilkan daftar nomor & status owner', /Nomor kamu     : 6281234567890/.test(idOwnerText) && /Owner          : ✅ YA/.test(idOwnerText), `-> ${idOwnerText.slice(0, 160)}`)

  console.log(`\n===== IDENTITAS: ${pass} lulus, ${fail} gagal =====`)
  return fail
}

main()
  .then((f) => process.exit(f ? 1 : 0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
