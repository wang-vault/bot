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
  console.log('\n[E] HANDLER: LID + admin di grup "sembunyikan nomor" (identitas = NOMOR)')
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

  // Angka LID yang kebetulan sama dengan nomor owner TIDAK boleh lolos.
  // (Versi lama membandingkan angka LID dengan angka nomor owner.)
  const GROUP_LID3 = '999000555-666@g.us'
  const LID_SAMA = '6281234567890@lid'
  const sockL = makeSock([{ id: LID_SAMA, jid: LID_SAMA, lid: LID_SAMA, admin: null }])
  const ml = await buildM(sockL, {
    key: { remoteJid: GROUP_LID3, fromMe: false, participant: LID_SAMA, id: 'L3' },
    message: { conversation: '.ping' },
    pushName: 'Bukan Owner',
  }, dbE, emptyLoader)
  ok('LID ber-angka sama dengan nomor owner TIDAK dianggap owner',
    ml.isOwner === false && ml.sender === LID_SAMA, `-> sender=${ml.sender} isOwner=${ml.isOwner}`)
  ok('LID yang nomornya belum diketahui dicatat untuk owner',
    !!require(path.join(BOT, 'src/lib/identity')).pendingFor(dbE, LID_SAMA))

  // Chat pribadi yang dialamatkan LID: nomor diambil dari atribut sender_pn
  const mPriv = await buildM(makeSock(), {
    key: { remoteJid: '888000111222333@lid', fromMe: false, id: 'L4', senderLid: '888000111222333@lid', senderPn: OWNER },
    message: { conversation: '.ping' },
    pushName: 'Owner',
  }, dbE, emptyLoader)
  ok('chat pribadi ber-LID: sender jadi NOMOR (sender_pn)', mPriv.sender === OWNER && mPriv.isOwner === true,
    `-> ${mPriv.sender} isOwner=${mPriv.isOwner}`)

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

  // ---------------------------------------------------------------- [G]
  console.log('\n[G] SIGNAL SESSION: Over 2000 messages into the future & self-healing')
  const SignalSession = require(path.join(BOT, 'src/lib/signal-session'))
  const libsignal = require('libsignal')
  const keyhelper = libsignal.keyhelper

  const patchRes = SignalSession.patchLibsignal(libsignal, {
    maxMessageGap: 5000,
    maxRetainedKeys: 100,
    maxClosedSessions: 3,
  })
  ok('patchLibsignal aktif', patchRes.patched === true)

  function makeSignalPeerStore() {
    const identity = keyhelper.generateIdentityKeyPair()
    const regId = keyhelper.generateRegistrationId()
    const preKey = keyhelper.generatePreKey(1)
    const signedPreKey = keyhelper.generateSignedPreKey(identity, 1)
    const sessions = new Map()
    const preKeys = new Map([[1, preKey.keyPair]])
    return {
      identity,
      regId,
      preKey,
      signedPreKey,
      sessions,
      preKeys,
      getOurIdentity: async () => identity,
      getOurRegistrationId: async () => regId,
      isTrustedIdentity: async () => true,
      loadSession: async (id) => {
        const raw = sessions.get(id)
        return raw ? libsignal.SessionRecord.deserialize(raw) : undefined
      },
      storeSession: async (id, rec) => {
        sessions.set(id, rec.serialize())
      },
      loadPreKey: async (id) => preKeys.get(Number(id)),
      removePreKey: async (id) => preKeys.delete(Number(id)),
      loadSignedPreKey: async () => signedPreKey.keyPair,
    }
  }

  const aliceStore = makeSignalPeerStore()
  const bobStore = makeSignalPeerStore()
  const bobAddr = new libsignal.ProtocolAddress('628000000000', 0)
  const aliceAddr = new libsignal.ProtocolAddress('158184383758357', 0)

  const aliceBuilder = new libsignal.SessionBuilder(aliceStore, bobAddr)
  await aliceBuilder.initOutgoing({
    registrationId: bobStore.regId,
    identityKey: bobStore.identity.pubKey,
    signedPreKey: {
      keyId: bobStore.signedPreKey.keyId,
      publicKey: bobStore.signedPreKey.keyPair.pubKey,
      signature: bobStore.signedPreKey.signature,
    },
    preKey: {
      keyId: bobStore.preKey.keyId,
      publicKey: bobStore.preKey.keyPair.pubKey,
    },
  })

  const aliceCipher = new libsignal.SessionCipher(aliceStore, bobAddr)
  const bobCipher = new libsignal.SessionCipher(bobStore, aliceAddr)

  // 1. Inisialisasi sesi 1:1 awal dan ubah ke WhisperMessage (type 1)
  const firstEnc = await aliceCipher.encrypt(Buffer.from('halo-awal'))
  const firstDec = await bobCipher.decryptPreKeyWhisperMessage(firstEnc.body)
  ok('pkmsg awal terdekripsi', firstDec.toString() === 'halo-awal')

  const bobReply = await bobCipher.encrypt(Buffer.from('balas-awal'))
  await aliceCipher.decryptWhisperMessage(bobReply.body)

  // 2. Pengirim (158184383758357.0) melompat >2000 pesan ke depan (2200 pesan)
  let msg2190 = null
  let msg2200 = null
  for (let i = 1; i <= 2200; i++) {
    const enc = await aliceCipher.encrypt(Buffer.from('pesan-' + i))
    if (i === 2190) msg2190 = enc
    if (i === 2200) msg2200 = enc
  }
  const dec2200 = await bobCipher.decryptWhisperMessage(msg2200.body)
  ok('pesan >2000 langkah ke depan (counter 2200) berhasil didekripsi tanpa SessionError',
    dec2200.toString() === 'pesan-2200', `-> ${dec2200}`)

  const dec2190 = await bobCipher.decryptWhisperMessage(msg2190.body)
  ok('pesan out-of-order terbaru (counter 2190) masih bisa didekripsi',
    dec2190.toString() === 'pesan-2190')

  const savedRec = bobStore.sessions.get('158184383758357.0')
  const openEntry = Object.values(savedRec._sessions)[0]
  const chainKeyCounts = Object.values(openEntry._chains).map((c) => Object.keys(c.messageKeys || {}).length)
  ok('messageKeys dipangkas sesuai batas memori (<= 100, bukan 2200)',
    chainKeyCounts.every((n) => n <= 100), `-> counts=${JSON.stringify(chainKeyCounts)}`)

  // 3. Duplikat pesan yang sudah didekripsi tetap melempar MessageCounterError (bukan dianggap sesi rusak)
  let dupErr = null
  try {
    await bobCipher.decryptWhisperMessage(msg2200.body)
  } catch (e) {
    dupErr = e
  }
  ok('pesan duplikat melempar Key used already or never filled',
    dupErr && /Key used already or never filled/.test(dupErr.message))
  ok('error duplikat TIDAK diklasifikasikan sebagai desync sesi',
    SignalSession.isSessionDesyncError(dupErr) === false)

  // 4. Proteksi mutasi in-place pada decryptWithSessions:
  // Buat pesan dengan sesi lama (closed), pastikan sesi baru (open) tidak ikut rusak
  const oldMsgFromAlice = await aliceCipher.encrypt(Buffer.from('dari-sesi-lama'))
  const preKey2 = keyhelper.generatePreKey(2)
  bobStore.preKeys.set(2, preKey2.keyPair)
  await aliceBuilder.initOutgoing({
    registrationId: bobStore.regId,
    identityKey: bobStore.identity.pubKey,
    signedPreKey: {
      keyId: bobStore.signedPreKey.keyId,
      publicKey: bobStore.signedPreKey.keyPair.pubKey,
      signature: bobStore.signedPreKey.signature,
    },
    preKey: {
      keyId: preKey2.keyId,
      publicKey: preKey2.keyPair.pubKey,
    },
  })
  const newSessionSetup = await aliceCipher.encrypt(Buffer.from('buka-sesi-baru'))
  await bobCipher.decryptPreKeyWhisperMessage(newSessionSetup.body)
  const bobReply2 = await bobCipher.encrypt(Buffer.from('konfirmasi-sesi-baru'))
  await aliceCipher.decryptWhisperMessage(bobReply2.body)

  // Sekarang kirim pesan dari sesi lama (saat sesi baru berstatus open & dicoba lebih dulu)
  const decOld = await bobCipher.decryptWhisperMessage(oldMsgFromAlice.body)
  ok('pesan tertunda dari sesi tertutup berhasil didekripsi', decOld.toString() === 'dari-sesi-lama')

  // Pastikan sesi terbuka (open) TIDAK rusak akibat percobaan dekripsi sesi tertutup tadi
  const afterNewMsg = await aliceCipher.encrypt(Buffer.from('sesi-baru-tetap-sehat'))
  const decNewAfter = await bobCipher.decryptWhisperMessage(afterNewMsg.body)
  ok('sesi terbuka tetap sehat (tidak terkorupsi mutasi in-place)',
    decNewAfter.toString() === 'sesi-baru-tetap-sehat')

  // 5. Tidak membanjiri console.error saat semua sesi gagal + self-healing repository
  const freshForCorrupt = await aliceCipher.encrypt(Buffer.from('pesan-mac-rusak'))
  const errLogs = []
  const origConsoleError = console.error
  console.error = (...args) => errLogs.push(args.join(' '))
  let failedAllErr = null
  try {
    // Ciphertext belum pernah dipakai tapi MAC 8-byte terakhir dirusak (Bad MAC)
    const bogusWhisper = Buffer.concat([freshForCorrupt.body.slice(0, -8), Buffer.alloc(8, 0xff)])
    await bobCipher.decryptWhisperMessage(bogusWhisper)
  } catch (e) {
    failedAllErr = e
  } finally {
    console.error = origConsoleError
  }
  ok('decryptWithSessions melempar SessionError saat semua sesi gagal',
    failedAllErr && failedAllErr.name === 'SessionError')
  ok('console.error TIDAK dibanjiri stack trace libsignal', errLogs.length === 0,
    `-> console.error dipanggil ${errLogs.length}x`)
  ok('error terdeteksi sebagai desync sesi', SignalSession.isSessionDesyncError(failedAllErr) === true,
    `-> ${failedAllErr && failedAllErr.message}`)

  // 5b. pkmsg dengan baseKey yang sudah ada di record tapi rantainya rusak -> dibangun ulang otomatis
  const preKey3 = keyhelper.generatePreKey(3)
  bobStore.preKeys.set(3, preKey3.keyPair)
  await aliceBuilder.initOutgoing({
    registrationId: bobStore.regId,
    identityKey: bobStore.identity.pubKey,
    signedPreKey: {
      keyId: bobStore.signedPreKey.keyId,
      publicKey: bobStore.signedPreKey.keyPair.pubKey,
      signature: bobStore.signedPreKey.signature,
    },
    preKey: {
      keyId: preKey3.keyId,
      publicKey: preKey3.keyPair.pubKey,
    },
  })
  const pkMsg1 = await aliceCipher.encrypt(Buffer.from('pkmsg-pertama'))
  await bobCipher.decryptPreKeyWhisperMessage(pkMsg1.body)
  // Kembalikan preKey 3 & rusak rootKey/chains sesi di Bob agar seolah macet dengan baseKey sama
  bobStore.preKeys.set(3, preKey3.keyPair)
  const bobRecCorrupt = bobStore.sessions.get('158184383758357.0')
  for (const s of Object.values(bobRecCorrupt._sessions)) {
    s._chains = {}
    s.currentRatchet.rootKey = Buffer.alloc(32, 0xaa).toString('base64')
  }
  bobStore.sessions.set('158184383758357.0', bobRecCorrupt)
  const pkMsg2 = await aliceCipher.encrypt(Buffer.from('pkmsg-pulih-otomatis'))
  const decPk2 = await bobCipher.decryptPreKeyWhisperMessage(pkMsg2.body)
  ok('pkmsg dengan baseKey lama yang rusak otomatis dibangun ulang & terdekripsi',
    decPk2.toString() === 'pkmsg-pulih-otomatis')

  // 6. Self-healing repository otomatis menghapus session-<addr>.json & sender-key rusak
  const deletedKeys = []
  const warnLogs = []
  const fakeAuth = {
    creds: {},
    keys: {
      set: async (data) => { deletedKeys.push(data) },
    },
  }
  const healingRepo = SignalSession.createSelfHealingSignalRepository(fakeAuth, {
    libsignal,
    logCooldownMs: 60000,
    logger: { warn: (m) => warnLogs.push(m) },
    baseMakeRepository: () => ({
      jidToSignalProtocolAddress: (jid) => `${String(jid).split('@')[0]}.0`,
      decryptMessage: async () => {
        const e = new Error('Over 2000 messages into the future!')
        e.name = 'SessionError'
        throw e
      },
      decryptGroupMessage: async () => {
        throw new Error('Over 2000 messages into the future!')
      },
      encryptMessage: async () => ({ type: 'msg', ciphertext: Buffer.alloc(0) }),
    }),
  })

  let repoErr = null
  try {
    await healingRepo.decryptMessage({
      jid: '158184383758357@lid',
      type: 'msg',
      ciphertext: Buffer.from('x'),
    })
  } catch (e) {
    repoErr = e
  }
  ok('decryptMessage tetap meneruskan error ke Baileys agar mengirim retry receipt', !!repoErr)
  ok('sesi 158184383758357.0 otomatis dihapus dari auth.keys saat desync',
    deletedKeys.length === 1 &&
      deletedKeys[0].session &&
      deletedKeys[0].session['158184383758357.0'] === null,
    `-> ${JSON.stringify(deletedKeys)}`)

  // Panggilan kedua untuk alamat yang sama tetap mereset sesi tapi log di-rate-limit
  try {
    await healingRepo.decryptMessage({
      jid: '158184383758357@lid',
      type: 'msg',
      ciphertext: Buffer.from('x'),
    })
  } catch (_) {}
  ok('log peringatan di-rate-limit (1x per alamat dalam masa cooldown)', warnLogs.length === 1,
    `-> warnLogs=${warnLogs.length}`)

  // Group sender-key desync
  try {
    await healingRepo.decryptGroupMessage({
      group: '120363000000000000@g.us',
      authorJid: '158184383758357@lid',
      msg: Buffer.from('x'),
    })
  } catch (_) {}
  ok('sender-key grup otomatis dihapus saat desync',
    deletedKeys.some((d) => d['sender-key'] && d['sender-key']['120363000000000000@g.us::158184383758357::0'] === null),
    `-> ${JSON.stringify(deletedKeys)}`)

  // 7. Sanitasi folder auth saat startup (session-*.json kotor/bengkak/korup)
  const tmpAuthDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wangbot-auth-clean-'))
  fs.writeFileSync(path.join(tmpAuthDir, 'creds.json'), '{"me":{"id":"628123@s.whatsapp.net"}}')
  fs.writeFileSync(path.join(tmpAuthDir, 'session-corrupt.0.json'), '{bukan json valid')
  const bloatedKeys = {}
  for (let i = 1; i <= 300; i++) bloatedKeys[String(i)] = 'aGVsbG8='
  const bloatedSession = {
    version: 'v1',
    _sessions: {
      open1: {
        registrationId: 1,
        currentRatchet: { ephemeralKeyPair: {}, lastRemoteEphemeralKey: '', previousCounter: 0, rootKey: '' },
        indexInfo: { baseKey: 'open1', baseKeyType: 1, closed: -1, used: 100, created: 100, remoteIdentityKey: '' },
        _chains: { c1: { chainKey: { counter: 300, key: 'aGVsbG8=' }, chainType: 2, messageKeys: bloatedKeys } },
      },
      closed1: {
        registrationId: 1,
        currentRatchet: {},
        indexInfo: { closed: 10, used: 10 },
        _chains: {},
      },
      closed2: {
        registrationId: 1,
        currentRatchet: {},
        indexInfo: { closed: 20, used: 20 },
        _chains: {},
      },
      closed3: {
        registrationId: 1,
        currentRatchet: {},
        indexInfo: { closed: 30, used: 30 },
        _chains: {},
      },
      brokenEntry: { invalid: true },
    },
  }
  const bloatedPath = path.join(tmpAuthDir, 'session-158184383758357.0.json')
  fs.writeFileSync(bloatedPath, JSON.stringify(bloatedSession))

  const cleanResult = SignalSession.sanitizeAuthFolder(tmpAuthDir, {
    maxRetainedKeys: 50,
    maxClosedSessions: 2,
  })
  ok('file session korup dihapus & file bengkak dirapikan',
    cleanResult.removed === 1 && cleanResult.cleaned === 1 && !fs.existsSync(path.join(tmpAuthDir, 'session-corrupt.0.json')))
  ok('creds.json tidak pernah disentuh sanitasi',
    fs.existsSync(path.join(tmpAuthDir, 'creds.json')))
  const afterClean = JSON.parse(fs.readFileSync(bloatedPath, 'utf8'))
  ok('closed session berlebih & entri rusak dibuang, messageKeys dipangkas ke <= 50',
    Object.keys(afterClean._sessions).length === 3 &&
      !afterClean._sessions.closed1 &&
      !afterClean._sessions.brokenEntry &&
      Object.keys(afterClean._sessions.open1._chains.c1.messageKeys).length === 50)
  fs.rmSync(tmpAuthDir, { recursive: true, force: true })

  // 8. Placeholder cache no-op mencegah penundaan 5 detik & loop PDO
  const phCache = SignalSession.createNoOpPlaceholderCache()
  ok('createNoOpPlaceholderCache.get() mengembalikan true', phCache.get('ANY_MSG_ID') === true)

  console.log(`\n===== HASIL: ${pass} lulus, ${fail} gagal =====`)
  cleanDb()
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
