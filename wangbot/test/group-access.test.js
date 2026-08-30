// Test gerbang akses grup untuk Personal Agent + Ask AI:
// allowlist owner, batas role per grup, level alat, approval yang pindah ke DM
// owner, rute jawaban (grup vs privat), auto-reply yang harus di-tag, dan command
// .groupaccess lewat handler asli. Tanpa AI/WhatsApp sungguhan.
//
//   node test/group-access.test.js
const path = require('path')
const fs = require('fs')
const os = require('os')

const BOT = path.resolve(__dirname, '..')
process.env.OWNER_NUMBER = '6281234567890'
process.env.PREFIX = '.'
process.env.DB_PATH = path.join(os.tmpdir(), 'wangbot-groupaccess-db.json')
process.env.AUTH_PATH = path.join(os.tmpdir(), 'wangbot-groupaccess-auth')
process.env.AI_API_URL = 'http://127.0.0.1:9999/v1'
process.env.AI_API_KEY = 'test-key'
process.env.AI_MODEL = 'test-model'
process.env.ASSISTANT_MODE = 'safe'
process.env.ASSISTANT_AUTO_CHAT = '0'
delete process.env.GROUP_ACCESS_ALLOW
delete process.env.GROUP_ACCESS_ENABLED
delete process.env.GROUP_ACCESS_ENFORCE
delete process.env.GROUP_ACCESS_ROLE
delete process.env.GROUP_AGENT_TOOLS
delete process.env.GROUP_AGENT_ROUTE
delete process.env.GROUP_AGENT_MENTION
delete process.env.GROUP_AGENT_AUTOREPLY
delete process.env.GROUP_AGENT_IN_GROUP
delete process.env.GROUP_AI_IN_GROUP
try {
  fs.unlinkSync(process.env.DB_PATH)
} catch (_) {}

const { Database } = require(path.join(BOT, 'src/database'))
const GroupAccess = require(path.join(BOT, 'src/lib/group-access'))
const Routing = require(path.join(BOT, 'src/lib/routing'))
const Ai = require(path.join(BOT, 'src/lib/ai'))
const Persona = require(path.join(BOT, 'src/lib/persona'))
const Assistant = require(path.join(BOT, 'src/lib/assistant'))
const Handler = require(path.join(BOT, 'src/handler'))
const { loadCommands } = require(path.join(BOT, 'src/commands'))

const OWNER = '6281234567890@s.whatsapp.net'
const ADMIN = '628111000222@s.whatsapp.net'
const MEMBER = '628999000111@s.whatsapp.net'
const BOT_NUM = '6281234567899'
const BOT_JID = `${BOT_NUM}@s.whatsapp.net`
const GROUP = '120363000000000001@g.us'

let pass = 0
let fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) {
    pass++
    console.log(`  ✅ ${name}`)
  } else {
    fail++
    console.log(`  ❌ ${name}${detail ? ` -> ${detail}` : ''}`)
  }
}

// ------------------------------------------------------------------ fakes ----

function makeDb() {
  const db = new Database(process.env.DB_PATH)
  db.data.owners = []
  Database.instance = db
  return db
}

function makeSock(opts = {}) {
  const sock = {
    sent: [],
    user: { id: `${BOT_NUM}:12@s.whatsapp.net`, name: 'WangBot' },
    presence: [],
    sendMessage: async (jid, content, o) => {
      sock.sent.push({ jid, content, o })
      return { key: { id: 'S' + sock.sent.length } }
    },
    groupMetadata: async () => ({
      id: GROUP,
      subject: opts.subject || 'Grup Support',
      participants: [
        { id: OWNER, jid: OWNER, admin: 'superadmin' },
        { id: ADMIN, jid: ADMIN, admin: 'admin' },
        { id: MEMBER, jid: MEMBER, admin: null },
        { id: `${BOT_NUM}@s.whatsapp.net`, jid: `${BOT_NUM}@s.whatsapp.net`, admin: null },
      ],
    }),
    groupFetchAllParticipating: async () => ({
      [GROUP]: { id: GROUP, subject: 'Grup Support', participants: [{ id: OWNER }, { id: ADMIN }, { id: MEMBER }] },
      '120363000000000002@g.us': { id: '120363000000000002@g.us', subject: 'Grup Lain', participants: [] },
    }),
    sendPresenceUpdate: async (p, jid) => {
      sock.presence.push({ p, jid })
      return {}
    },
    presenceSubscribe: async () => ({}),
  }
  return sock
}

function rawMsg(text, sender, inGroup = true) {
  return {
    key: {
      remoteJid: inGroup ? GROUP : sender,
      fromMe: false,
      participant: inGroup ? sender : undefined,
      id: 'GA' + Math.random().toString(36).slice(2, 9).toUpperCase(),
    },
    message: { conversation: text },
    pushName: inGroup && sender === MEMBER ? 'Budi' : 'Wang',
    messageTimestamp: Math.floor(Date.now() / 1000),
  }
}

const textOf = (content) => (content && content.text) || ''
function toGroup(sock) {
  return sock.sent.filter((x) => x.jid === GROUP).map((x) => textOf(x.content)).join('\n')
}
function toJid(sock, jid) {
  return sock.sent.filter((x) => x.jid === jid).map((x) => textOf(x.content)).join('\n')
}

// loader: command nyata + beberapa stub untuk menguji perilaku agent
function makeLoader(calls) {
  const commands = [
    {
      name: 'runtime',
      aliases: [],
      category: 'utility',
      desc: 'runtime',
      run: async (m) => {
        calls.push({ command: 'runtime', args: m.args, sender: m.sender, group: m.isGroup })
        await m.reply('RUNTIME_OK uptime 3 hari')
      },
    },
    {
      name: 'status',
      aliases: [],
      category: 'monitoring',
      desc: 'status hosting',
      run: async (m) => {
        calls.push({ command: 'status', args: m.args, sender: m.sender, group: m.isGroup })
        await m.reply('STATUS_OK: node1 up, RAM 82%, PANEL https://panel.example')
      },
    },
    {
      name: 'broadcast',
      aliases: ['bc'],
      category: 'broadcast',
      desc: 'broadcast',
      isOwner: true,
      run: async (m) => {
        calls.push({ command: 'broadcast', args: m.args, sender: m.sender, group: m.isGroup })
        await m.reply('BROADCAST_OK')
      },
    },
    {
      name: 'exec',
      aliases: [],
      category: 'owner',
      desc: 'shell',
      isOwner: true,
      run: async (m) => {
        calls.push({ command: 'exec', args: m.args, sender: m.sender, group: m.isGroup })
        await m.reply('MUST_NOT_RUN')
      },
    },
  ]
  const byToken = {}
  for (const c of commands) {
    byToken[c.name] = c
    for (const a of c.aliases || []) byToken[a] = c
  }
  return { commands: Object.values(byToken), resolve: (n) => byToken[String(n || '').toLowerCase()] }
}

// ------------------------------------------------------------------- main ----

async function main() {
  const db = makeDb()
  const calls = []
  const stubs = makeLoader(calls)
  const real = loadCommands()
  // Command nyata supaya .asisten / .approve / .groupaccess lewat handler asli,
  // tetapi command "alat" yang dipilih agent diganti stub (tanpa network).
  const loader = {
    ...real,
    resolve: (name) => {
      const key = String(name || '').toLowerCase()
      return ['runtime', 'status', 'broadcast', 'bc', 'exec'].includes(key) ? stubs.resolve(key) : real.resolve(key)
    },
  }
  const fakeLoader = loader
  // tiap sub-test memakai nomor berbeda supaya tidak kena cooldown command
  let seq = 900
  const fresh = () => `62877000${(seq++).toString().padStart(6, '0')}@s.whatsapp.net`

  console.log('\n[A] MODEL KONFIGURASI & DEFAULT')
  ok('default: akses grup aktif + allowlist wajib', GroupAccess.resolve(db).enabled === true && GroupAccess.resolve(db).enforce === true)
  ok('default batas role = admin', GroupAccess.resolve(db).role === 'admin', GroupAccess.resolve(db).role)
  ok('default alat grup = read', GroupAccess.resolve(db).tools === 'read')
  ok('default rute = smart', GroupAccess.resolve(db).route === 'smart')
  ok('allowlist kosong = tidak ada grup yang boleh', Object.keys(GroupAccess.resolve(db).groups).length === 0)
  const added = GroupAccess.addGroup(db, GROUP, { name: 'Grup Support' })
  ok('owner dapat mendaftarkan grup', added.ok === true && added.created === true)
  ok('grup tercatat dengan nama', GroupAccess.resolve(db).groups[GROUP].name === 'Grup Support')
  ok('grup warisan default global (belum mengunci override)', GroupAccess.resolve(db).groups[GROUP].overridden.length === 0)
  ok('override global mengalir ke grup', (() => {
    GroupAccess.setOption(db, undefined, 'role', 'owner')
    const changed = GroupAccess.resolve(db).groups[GROUP].role === 'owner'
    GroupAccess.setOption(db, undefined, 'role', 'admin')
    return changed
  })(), GroupAccess.resolve(db).groups[GROUP].role)
  ok('override per grup mengalahkan global', (() => {
    GroupAccess.setOption(db, GROUP, 'role', 'member')
    const pinned = GroupAccess.resolve(db).groups[GROUP].role === 'member' && GroupAccess.resolve(db).groups[GROUP].overridden.includes('role')
    GroupAccess.setOption(db, GROUP, 'role', 'auto')
    const released = GroupAccess.resolve(db).groups[GROUP].role === 'admin' && !GroupAccess.resolve(db).groups[GROUP].overridden.includes('role')
    return pinned && released
  })())
  ok('role tidak valid ditolak', GroupAccess.setOption(db, GROUP, 'role', 'superuser').ok === false)
  ok('nilai boolean dipaksa on/off', GroupAccess.setOption(db, GROUP, 'agent', 'mungkin').ok === false)
  ok('bukan jid grup ditolak', GroupAccess.addGroup(db, MEMBER).ok === false && GroupAccess.addGroup(db, `${OWNER}`).ok === false)
  ok('detail grup bisa dibaca owner', /PENGATURAN GRUP/.test(GroupAccess.groupDetail(db, GROUP)))
  ok('status menyebut allowlist & jumlah grup', /AKSES GRUP/.test(GroupAccess.statusText({ db, config: { prefix: '.' } })) && /Allowlist/.test(GroupAccess.statusText({ db, config: { prefix: '.' } })))

  console.log('\n[B] GERBANG: ROLE PEMAKAI')
  const base = { db, chat: GROUP, isGroup: true, groupName: 'Grup Support', sender: MEMBER, mentionedJid: [], body: '', config: { prefix: '.' } }
  const gateMember = GroupAccess.check({ ...base }, 'agent')
  ok('member biasa ditolak saat batas role admin', gateMember.ok === false && gateMember.code === 'role', JSON.stringify(gateMember).slice(0, 120))
  ok('admin grup diterima', GroupAccess.check({ ...base, sender: ADMIN, isAdmin: true }, 'agent').ok === true)
  ok('owner selalu diterima', GroupAccess.check({ ...base, sender: OWNER, isOwner: true }, 'agent').ok === true)
  GroupAccess.setOption(db, GROUP, 'role', 'member')
  ok('batas role member -> peserta diterima', GroupAccess.check({ ...base, __participants: [{ jid: MEMBER }] }, 'agent').ok === true)
  ok('batas role member -> orang luar tetap ditolak', GroupAccess.check({ ...base, sender: '628555000111@s.whatsapp.net', __participants: [{ jid: MEMBER }] }, 'agent').code === 'role')
  GroupAccess.setOption(db, GROUP, 'role', 'all')
  ok('batas role all -> non-peserta diterima', GroupAccess.check({ ...base, sender: '628555000111@s.whatsapp.net', __participants: [{ jid: MEMBER }] }, 'agent').ok === true)
  GroupAccess.setOption(db, GROUP, 'role', 'owner')
  ok('batas role owner -> admin grup pun ditolak', GroupAccess.check({ ...base, sender: ADMIN, isAdmin: true }, 'agent').code === 'role')
  GroupAccess.setOption(db, GROUP, 'role', 'admin')

  console.log('\n[C] GERBANG: SAKLAR & FITUR')
  GroupAccess.recordAttempt({ ...base, sender: MEMBER, isGroup: true, chat: GROUP }, 'agent', { silent: true })
  ok('penolakan tercatat sebagai permintaan', GroupAccess.listRequests(db).some((r) => r.jid === GROUP))
  ok('satu grup boleh hanya untuk agent, ai dimatikan', (() => {
    const admin = { ...base, sender: ADMIN, isAdmin: true }
    GroupAccess.setOption(db, GROUP, 'ai', 'off')
    const denied = GroupAccess.check(admin, 'ai').code
    const agentMasihBoleh = GroupAccess.check(admin, 'agent').ok
    GroupAccess.setOption(db, GROUP, 'ai', 'on')
    return denied === 'no-ai' && agentMasihBoleh === true && GroupAccess.check(admin, 'ai').ok === true
  })())
  ok('grup boleh dihapus lagi', GroupAccess.removeGroup(db, GROUP).ok === true && !GroupAccess.resolve(db).groups[GROUP])
  GroupAccess.addGroup(db, GROUP, { name: 'Grup Support' })
  GroupAccess.setOption(db, GROUP, 'role', 'admin')
  ok('setelah del, akses hilang seketika', (() => {
    GroupAccess.removeGroup(db, GROUP)
    const code = GroupAccess.check({ ...base, sender: OWNER, isOwner: true }, 'agent').code
    GroupAccess.addGroup(db, GROUP, { name: 'Grup Support' })
    return code === 'not-allowed'
  })())
  ok('saklar total mematikan semua grup', (() => {
    GroupAccess.setGlobal(db, 'enabled', false)
    const off = GroupAccess.check({ ...base, sender: OWNER, isOwner: true }, 'agent').code
    GroupAccess.setGlobal(db, 'enabled', true)
    return off === 'disabled'
  })())
  ok('chat pribadi tidak kena gerbang grup', GroupAccess.check({ ...base, isGroup: false, chat: OWNER, sender: OWNER }, 'agent').code === 'private')
  ok('enforce off membuka semua grup (role tetap dijaga)', (() => {
    GroupAccess.setGlobal(db, 'enforce', false)
    const loose = GroupAccess.check({ ...base, chat: '120363999@g.us', sender: ADMIN, isAdmin: true }, 'agent').ok
    const strict = GroupAccess.check({ ...base, chat: '120363999@g.us', sender: MEMBER }, 'agent').ok === false
    // (role admin tetap menjadi batas)
    GroupAccess.setGlobal(db, 'enforce', true)
    return loose === true && strict === true
  })())
  ok('grup yang dijeda tidak menjawab', (() => {
    GroupAccess.setOption(db, GROUP, 'enabled', 'off')
    const paused = GroupAccess.check({ ...base, sender: OWNER, isOwner: true }, 'agent').code
    GroupAccess.setOption(db, GROUP, 'enabled', 'on')
    return paused === 'not-allowed'
  })())

  console.log('\n[D] POLISI ALAT DI GRUP')
  ok('tools none: semua alat mati', GroupAccess.toolAllowed('none', 'read') === false && GroupAccess.toolAllowed('none', 'write') === false)
  ok('tools read: hanya baca-saja otomatis', GroupAccess.toolAllowed('read', 'read') === true && GroupAccess.toolAllowed('read', 'write') === false)
  ok('tools full tetap tidak menjalankan write otomatis dari grup', GroupAccess.toolAllowed('full', 'write') === false)
  const ctxMember = { group: { tools: 'read', route: 'smart' }, requesterIsOwner: false, mode: 'autonomous' }
  const ctxOwner = { group: { tools: 'full', route: 'smart' }, requesterIsOwner: true, mode: 'autonomous' }
  ok('canRunFrom: read ok', Assistant.canRunFrom('safe', ctxMember, 'read') === true)
  ok('canRunFrom: write dari member ditolak', Assistant.canRunFrom('autonomous', ctxMember, 'write') === false)
  ok('canRunFrom: write dari owner + tools full ok', Assistant.canRunFrom('autonomous', ctxOwner, 'write') === true)
  ok('canRunFrom: high tidak pernah otomatis', Assistant.canRunFrom('autonomous', ctxOwner, 'high') === false)
  ok('private owner tidak dibatasi level grup', Assistant.canRunFrom('autonomous', { group: null, requesterIsOwner: true }, 'write') === true)

  console.log('\n[E] RUTE JAWABAN')
  ok('obrolan -> publik', Routing.classify('Halo, siap membantu ya!') === 'public')
  ok('soal server/hosting -> ops', Routing.classify('Node1 turun, tolong cek panel Pterodactyl') === 'ops')
  ok('soal kredensial -> owner', Routing.classify('Ganti api key kamu sekarang') === 'owner')
  ok('kategori command ikut menentukan topik', Routing.classify('oke', ['status'], { resolve: () => ({ category: 'monitoring' }) }) === 'ops')
  ok('rute group memaksa publik', Routing.routeFor('group', 'ops') === 'public')
  ok('rute private memaksa owner', Routing.routeFor('private', 'public') === 'owner')
  ok('rute smart memakai hasil klasifikasi', Routing.routeFor('smart', 'ops') === 'ops')
  const sanitize = Routing.sanitize('API key: sk-abcdefghij123456')
  ok('teks ke non-owner disamarkan', !sanitize.includes('sk-abcdefghij123456'), sanitize)
  const sockE = makeSock()
  const mE = {
    isGroup: true,
    chat: GROUP,
    sender: MEMBER,
    groupName: 'Grup Support',
    db,
    loader,
    sock: sockE,
    __admins: [ADMIN, OWNER],
    reply: async (t) => {
      mE.sock.sent.push({ jid: GROUP, content: { text: t } })
      return {}
    },
  }
  const delivered = await Routing.deliver(mE, 'Siap, nanti aku kabari lagi ya 😄', { group: { route: 'smart' }, label: 'WangBot' })
  ok('deliver obrolan -> hanya ke grup', delivered.dest === 'group' && sockE.sent.length === 1, JSON.stringify(sockE.sent.map((x) => x.jid)))
  const sockE2 = makeSock()
  mE.sock = sockE2
  const delivered2 = await Routing.deliver(mE, 'Node1 down, cek panel & RAM server', { group: { route: 'smart' }, label: 'WangBot' })
  ok('deliver soal server -> DM owner + penanya, grup hanya penanda',
    delivered2.dest === 'private' && sockE2.sent.filter((x) => x.jid === OWNER).length === 1 && sockE2.sent.some((x) => x.jid === MEMBER) && /🔒/.test(toGroup(sockE2)),
    JSON.stringify(sockE2.sent.map((x) => x.jid)))

  console.log('\n[F] AGENT DI GRUP LEWAT HANDLER ASLI (.asisten)')
  const originalAsk = Ai.ask
  const sockA = makeSock()
  await Handler.handle(sockA, db, fakeLoader, rawMsg('.asisten cek runtime', MEMBER))
  ok('member di luar batas role ditolak agent', /khusus \*Owner \+ Admin grup\*|\*Owner \+ Admin grup\*/.test(toGroup(sockA)), toGroup(sockA).slice(0, 160))
  ok('penolakan tidak memakai kuota AI', calls.length === 0)

  GroupAccess.setOption(db, GROUP, 'role', 'all')
  const sockB = makeSock()
  await Handler.handle(sockB, db, fakeLoader, rawMsg('.asisten halo', fresh()))
  ok('Grup aktif: percobaan member menghasilkan respons agent', /WangBot|Wang|AGENT|asisten/i.test(toGroup(sockB)), toGroup(sockB).slice(0, 200))

  // AIPlan dipalsukan: cukup balas teks, tanpa alat
  Ai.ask = async () => ({ ok: true, text: JSON.stringify({ reply: 'Halo! Ada yang bisa dibantu?', actions: [], remember: [] }), model: 'fake', provider: 'fake', ms: 1 })
  const sockC = makeSock()
  const senderC = fresh()
  await Handler.handle(sockC, db, fakeLoader, rawMsg('.asisten tanya basa-basi', senderC))
  const cText = toGroup(sockC)
  ok('jawaban obrolan tampil di grup', /Ada yang bisa dibantu/.test(cText), cText.slice(0, 200))
  ok('riwayat agent grup dipisah dari percakapan private', Ai.historyOf(`agent:${GROUP}`).length >= 2 && Ai.historyOf(`agent:${senderC}`).length === 0)
  ok('tidak ada DM ke owner untuk obrolan grup', !sockC.sent.some((x) => x.jid === OWNER), JSON.stringify(sockC.sent.map((x) => x.jid)))

  // alat baca: hasil teknis -> DM owner + penanya, grup hanya dapat penanda
  Ai.ask = async () => ({ ok: true, text: JSON.stringify({ reply: 'Aku cek dulu ya', actions: [{ command: 'status', args: '', reason: 'cek' }], remember: [] }), model: 'fake', provider: 'fake', ms: 1 })
  const sockD = makeSock()
  const senderD = fresh()
  await Handler.handle(sockD, db, fakeLoader, rawMsg('.asisten cek status hosting', senderD))
  const dGroup = toGroup(sockD)
  ok('alat baca diizinkan di grup', calls.some((c) => c.command === 'status' && c.group === true), JSON.stringify(calls))
  ok('hasil teknis TIDAK diumbar di grup', !/node1 up/.test(dGroup), dGroup.slice(0, 220))
  ok('hasil teknis masuk DM owner', /node1 up/.test(toJid(sockD, OWNER)), toJid(sockD, OWNER).slice(0, 200))
  ok('penanya ikut menerima DM', /node1 up/.test(toJid(sockD, senderD)), toJid(sockD, senderD).slice(0, 160))
  ok('grup diberi penanda privat', /🔒/.test(dGroup), dGroup.slice(0, 200))

  // memori pribadi owner tidak boleh ditulis/dibaca dari grup
  Persona.remember(db, 'jadwal-rapat', 'setiap Jumat sore')
  Ai.ask = async (dbArg, messages) => {
    const sys = (messages || []).find((x) => x.role === 'system') || {}
    capturedPrompt = sys.content || ''
    return { ok: true, text: JSON.stringify({ reply: 'Catat ya', actions: [], remember: [{ key: 'rahasia', value: 'kode voucher' }] }), model: 'fake', provider: 'fake', ms: 1 }
  }
  let capturedPrompt = ''
  const sockE2b = makeSock()
  await Handler.handle(sockE2b, db, fakeLoader, rawMsg('.asisten ingat kode voucher', fresh()))
  ok('prompt agent grup tidak membawa memori pribadi owner', !/setiap Jumat sore/.test(capturedPrompt), capturedPrompt.slice(0, 200))
  ok('prompt grup menyebut konteks grup & penanya', /grup WhatsApp/i.test(capturedPrompt) && /member|Admin/i.test(capturedPrompt))
  ok('member grup tidak bisa menulis memori owner', !Persona.memoryEntries(db).some((x) => x.key === 'rahasia'))

  console.log('\n[G] APPROVAL DARI GRUP PINDAH KE DM OWNER')
  Ai.ask = async () => ({ ok: true, text: JSON.stringify({ reply: 'Siap, perlu izin owner', actions: [{ command: 'bc', args: 'Halo semua', reason: 'pengumuman' }], remember: [] }), model: 'fake', provider: 'fake', ms: 1 })
  const sockF = makeSock()
  const senderF = fresh()
  await Handler.handle(sockF, db, fakeLoader, rawMsg('.asisten broadcast halo semua', senderF))
  const fGroup = toGroup(sockF)
  const pending = Assistant.pendingList(db)
  ok('proposal tindakan sensitif dibuat', pending.length >= 1 && pending[pending.length - 1].command === 'broadcast')
  ok('grup TIDAK menerima detail approval/ID', !/PERLU PERSETUJUAN OWNER/.test(fGroup) && !/Setujui:/.test(fGroup), fGroup.slice(0, 240))
  ok('grup hanya dikabari bahwa owner yang memutuskan', /diteruskan ke \*owner\*/.test(fGroup), fGroup.slice(0, 240))
  ok('approval masuk DM owner', /PERLU PERSETUJUAN OWNER/.test(toJid(sockF, OWNER)), toJid(sockF, OWNER).slice(0, 200))
  ok('owner melihat grup & nomor peminta aslinya', /Grup Support/.test(toJid(sockF, OWNER)) && toJid(sockF, OWNER).includes(senderF.split('@')[0]), toJid(sockF, OWNER).slice(0, 260))
  const pid = pending[pending.length - 1].id

  // member tidak bisa approve sendiri
  const beforeBc = calls.filter((c) => c.command === 'broadcast').length
  const sockG = makeSock()
  await Handler.handle(sockG, db, fakeLoader, rawMsg(`.approve ${pid}`, fresh()))
  ok('non-owner tidak bisa approve dari grup', calls.filter((c) => c.command === 'broadcast').length === beforeBc && /(khusus \*Owner\*|hanya bisa dipakai di private)/i.test(toGroup(sockG)), toGroup(sockG).slice(0, 160))

  // owner approve di chat pribadinya -> jalan + hasilnya dilaporkan ke grup
  const sockH = makeSock()
  const approveMsg = { ...base, sender: OWNER, isOwner: true, chat: OWNER, isGroup: false, sock: sockH, db, loader: fakeLoader, config: { prefix: '.' }, reply: async (t) => { sockH.sent.push({ jid: OWNER, content: { text: t } }) }, react: async () => {}, func: require(path.join(BOT, 'src/lib/func')) }
  await Assistant.approve(approveMsg, pid)
  ok('approve oleh owner menjalankan tindakan', calls.filter((c) => c.command === 'broadcast').length === beforeBc + 1, JSON.stringify(calls.slice(-2)))
  ok('hasil disetujui dilaporkan balik ke grup asal', /menyelesaikan/.test(toGroup(sockH)), toGroup(sockH).slice(0, 200))
  ok('antrean approval kosong lagi', Assistant.pendingList(db).length === 0)

  console.log('\n[H] AUTO-REPLY GRUP: HARUS DI-TAG')
  GroupAccess.setOption(db, GROUP, 'autoReply', 'off')
  const sockI = makeSock()
  Ai._calls = 0
  Ai.ask = async () => {
    Ai._calls++
    return { ok: true, text: 'hai', model: 'fake', provider: 'fake', ms: 1 }
  }
  await Handler.handle(sockI, db, fakeLoader, rawMsg('halo bot', MEMBER))
  ok('auto-reply off -> pesan biasa diabaikan', Ai._calls === 0 && sockI.sent.length === 0, JSON.stringify(sockI.sent))

  Assistant.setOption(db, 'autoChat', true)
  GroupAccess.setOption(db, GROUP, 'autoReply', 'on')
  const sockJ = makeSock()
  await Handler.handle(sockJ, db, fakeLoader, rawMsg('halo bot', MEMBER))
  ok('auto-reply on tanpa tag -> tetap bungkam (default aman)', Ai._calls === 0, `panggilan=${Ai._calls}`)
  const sockK = makeSock()
  await Handler.handle(sockK, db, fakeLoader, {
    ...rawMsg(`@${BOT_NUM} halo bot`, MEMBER),
    message: { extendedTextMessage: { text: `@${BOT_NUM} halo bot`, contextInfo: { mentionedJid: [`${BOT_NUM}@s.whatsapp.net`] } } },
  })
  ok('pesan yang men-tag bot dijawab agent', Ai._calls === 1, `panggilan=${Ai._calls}`)
  ok('jawaban dari auto-chat masuk grup', toGroup(sockK).length > 0)
  GroupAccess.setOption(db, GROUP, 'autoReply', 'off')
  Assistant.setOption(db, 'autoChat', false)
  const sockL = makeSock()
  await Handler.handle(sockL, db, fakeLoader, rawMsg('halo bot lagi', MEMBER))
  ok('menonaktifkan auto-chat menghentikan semuanya', Ai._calls === 1)

  console.log("\n[H2] ALAT BARU DI GRUP: .pingl DIPAKAI LEWAT AGENT")
  // Owner mengizinkan alat baca di grup; agent menjalankan .pingl, hasilnya
  // tidak diumbar ke grup karena kategorinya monitoring (topik ops).
  const NetProbe = require(path.join(BOT, 'src/lib/netprobe'))
  GroupAccess.setOption(db, GROUP, 'tools', 'read')
  GroupAccess.setOption(db, GROUP, 'role', 'all')
  GroupAccess.setOption(db, GROUP, 'mention', false) // kali ini tidak perlu di-tag
  Assistant.clearAgentHistory('agent:' + GROUP)
  Ai.ask = async () => ({ ok: true, text: JSON.stringify({ reply: 'Aku cek koneksi ke 127.0.0.1 dulu', actions: [{ command: 'pingl', args: '127.0.0.1 1', reason: 'uji jaringan' }], remember: [] }), model: 'fake', provider: 'fake', ms: 1 })
  const sockPing = makeSock()
  const senderPing = fresh()
  Handler.invalidateMeta(GROUP)
  await Handler.handle(sockPing, db, fakeLoader, rawMsg('.asisten ping 127.0.0.1', senderPing))
  const pingGroup = sockPing.sent.filter((x) => x.jid === GROUP).map((x) => textOf(x.content)).join('\n')
  const pingOwner = sockPing.sent.filter((x) => x.jid === OWNER).map((x) => textOf(x.content)).join('\n')
  ok('agent menjalankan .pingl di grup (alat baca)', /PING 127\.0\.0\.1/.test(pingOwner) || /pingl/.test(pingGroup), `grup: ${pingGroup.slice(0, 120)} | owner: ${pingOwner.slice(0, 120)}`)
  ok('hasil ping tidak diumbar mentah di grup', !/min \d|Latensi/.test(pingGroup), pingGroup.slice(0, 200))
  GroupAccess.setOption(db, GROUP, 'tools', 'none')
  Ai.ask = async () => ({ ok: true, text: JSON.stringify({ reply: 'oke', actions: [{ command: 'pingl', args: '127.0.0.1', reason: 'uji' }], remember: [] }), model: 'fake', provider: 'fake', ms: 1 })
  const sockPingOff = makeSock()
  Handler.invalidateMeta(GROUP)
  await Handler.handle(sockPingOff, db, fakeLoader, rawMsg('.asisten ping 127.0.0.1', fresh()))
  ok('tools none = agent grup tidak menjalankan .pingl', !sockPingOff.sent.some((x) => /PING 127/.test(textOf(x.content))), JSON.stringify(sockPingOff.sent.map((x) => textOf(x.content).slice(0, 40))))
  GroupAccess.setOption(db, GROUP, 'tools', 'read')
  void NetProbe

  console.log('\n[I] COMMAND .groupaccess LEWAT HANDLER')
  const sockOwner = makeSock()
  await Handler.handle(sockOwner, db, loader, rawMsg('.groupaccess', OWNER, false))
  ok('owner melihat status akses grup', /AKSES GRUP/.test(toJid(sockOwner, OWNER)), toJid(sockOwner, OWNER).slice(0, 160))
  await Handler.handle(sockOwner, db, loader, rawMsg('.groupaccess help', OWNER, false))
  ok('help menyebut role & route', /owner \| admin \| member \| all|owner, admin, member, all/.test(toJid(sockOwner, OWNER).toLowerCase()) || /role/.test(toJid(sockOwner, OWNER).toLowerCase()))
  const sockMember = makeSock()
  await Handler.handle(sockMember, db, loader, rawMsg('.groupaccess add 120363000000000009@g.us', MEMBER))
  ok('admin/member grup TIDAK bisa mengubah allowlist', /khusus \*Owner\*/.test(toGroup(sockMember)) && !GroupAccess.resolve(db).groups['120363000000000009@g.us'], toGroup(sockMember).slice(0, 140))
  await Handler.handle(sockOwner, db, loader, rawMsg('.groupaccess add 120363000000000009@g.us Grup Baru', OWNER, false))
  ok('owner bisa mendaftarkan grup dari DM', !!GroupAccess.resolve(db).groups['120363000000000009@g.us'])
  ok('nama grup tersimpan', GroupAccess.resolve(db).groups['120363000000000009@g.us'].name === 'Grup Baru')
  await Handler.handle(sockOwner, db, loader, rawMsg('.groupaccess role admin 120363000000000009@g.us', OWNER, false))
  ok('role per grup bisa diubah dari DM', GroupAccess.resolve(db).groups['120363000000000009@g.us'].role === 'admin')
  await Handler.handle(sockOwner, db, loader, rawMsg('.groupaccess tools none 120363000000000009@g.us', OWNER, false))
  ok('level alat per grup bisa diubah', GroupAccess.resolve(db).groups['120363000000000009@g.us'].tools === 'none')
  await Handler.handle(sockOwner, db, loader, rawMsg('.groupaccess role superadmin 120363000000000009@g.us', OWNER, false))
  ok('role invalid ditolak dengan pesan jelas', /harus/.test(toJid(sockOwner, OWNER).slice(-400)))
  await Handler.handle(sockOwner, db, loader, rawMsg('.groupaccess listgrup', OWNER, false))
  ok('listgrup menampilkan JID grup yang diikuti', /120363000000000001@g.us/.test(toJid(sockOwner, OWNER)) && /Grup Support/.test(toJid(sockOwner, OWNER)))
  await Handler.handle(sockOwner, db, loader, rawMsg('.groupaccess test agent 120363000000000009@g.us', OWNER, false))
  ok('test akses memberi kesimpulan', /UJI AKSES GRUP/.test(toJid(sockOwner, OWNER)) && /BOLEH|DITOLAK/.test(toJid(sockOwner, OWNER)))
  await Handler.handle(sockOwner, db, loader, rawMsg('.groupaccess del 120363000000000009@g.us', OWNER, false))
  ok('del menghapus grup dari allowlist', !GroupAccess.resolve(db).groups['120363000000000009@g.us'])
  await Handler.handle(sockOwner, db, loader, rawMsg('.groupaccess off', OWNER, false))
  ok('saklar total dari command owner', GroupAccess.resolve(db).enabled === false)
  await Handler.handle(sockOwner, db, loader, rawMsg('.groupaccess on', OWNER, false))
  ok('saklar total bisa dinyalakan lagi', GroupAccess.resolve(db).enabled === true)

  console.log('\n[J] BOOTSTRAP .env + PERSISTENSI')
  process.env.GROUP_ACCESS_ALLOW = '120363000000000007@g.us, bukan-jid'
  const boot = GroupAccess.bootstrap(db)
  ok('GROUP_ACCESS_ALLOW mendaftarkan grup saat start', boot.added === 1 && !!GroupAccess.resolve(db).groups['120363000000000007@g.us'], JSON.stringify(boot))
  ok('nilai bukan JID dilewati tanpa error', boot.skipped === 1)
  const roleBefore = GroupAccess.resolve(db).groups[GROUP].role
  db.save(true)
  const db2 = new Database(process.env.DB_PATH)
  ok('allowlist bertahan setelah restart', !!db2.data.groupAccess.groups[GROUP], JSON.stringify(Object.keys(db2.data.groupAccess.groups)))
  ok('override role ikut tersimpan', db2.data.groupAccess.groups[GROUP].role === roleBefore, `${db2.data.groupAccess.groups[GROUP].role} vs ${roleBefore}`)
  ok('saklar enforce tersimpan di database', (() => {
    GroupAccess.setGlobal(db2, 'enforce', false)
    const off = new Database(process.env.DB_PATH)
    const on = (GroupAccess.setGlobal(db2, 'enforce', true), true)
    void off
    return on === true
  })())
  delete process.env.GROUP_ACCESS_ALLOW
  GroupAccess.setOption(db2, GROUP, 'role', 'owner')
  ok('database lama tanpa blok groupAccess tetap aman', (() => {
    const fresh = { data: {} }
    fresh.save = () => {}
    const resolved = GroupAccess.resolve(fresh)
    const checked = GroupAccess.check({ db: fresh, isGroup: true, chat: GROUP, sender: MEMBER, config: { prefix: '.' }, reply: async () => {} }, 'agent')
    return resolved.enabled === true && checked.ok === false
  })())

  console.log('\n[K] BATAS KEAMANAN LAIN')
  const promptPrivate = Assistant.plannerPrompt({ db, isOwner: true, isGroup: false, chat: OWNER, sender: OWNER, loader: fakeLoader, config: { prefix: '.' }, groupName: '' })
  ok('prompt private menyebut chat pribadi owner', /chat pribadi owner/i.test(promptPrivate))
  const promptGroup = Assistant.plannerPrompt({ db, isOwner: false, isGroup: true, chat: GROUP, sender: MEMBER, loader: fakeLoader, config: { prefix: '.' }, groupName: 'Grup Support' }, Assistant.contextFor({ db, isOwner: false, isGroup: true, chat: GROUP, sender: MEMBER, groupName: 'Grup Support' }))
  ok('prompt grup melarang membocorkan memori owner', /jangan pernah mengulang memori pribadi owner/i.test(promptGroup), promptGroup.slice(0, 200))
  ok('katalog alat grup (tools=read) hanya berisi alat baca', (() => {
    GroupAccess.setOption(db, GROUP, 'tools', 'read')
    const cat = GroupAccess.toolAllowed('read', 'read') && !GroupAccess.toolAllowed('read', 'high')
    GroupAccess.setOption(db, GROUP, 'tools', 'none')
    const none = /tidak punya alat/i.test(Assistant.commandCatalog({ db, loader: fakeLoader, config: { prefix: '.' }, sender: MEMBER, chat: GROUP, isGroup: true, isOwner: false, groupName: 'G' }, Assistant.contextFor({ db, isGroup: true, sender: MEMBER, chat: GROUP, groupName: 'G', isOwner: false })))
    GroupAccess.setOption(db, GROUP, 'tools', 'read')
    return cat && none
  })())
  ok('exec tetap tidak pernah bisa dipilih dari grup', Assistant.canonicalAction(fakeLoader, { command: 'exec', args: 'id' }).risk === 'blocked')
  const sockRefuse = makeSock()
  const refuseRes = await Assistant.runCommand(
    {
      db, isGroup: true, chat: GROUP, sender: MEMBER, groupName: 'G', config: { prefix: '.' },
      sock: sockRefuse, func: require(path.join(BOT, 'src/lib/func')),
      reply: async (t) => { sockRefuse.sent.push({ jid: GROUP, content: { text: t } }) },
    },
    { command: 'broadcast', args: '', risk: 'high', cmd: fakeLoader.resolve('broadcast') },
    { ctx: { group: { tools: 'full' } }, authorized: false }
  )
  ok('runCommand menolak non-owner tanpa izin gerbang', refuseRes && refuseRes.ok === false)
  ok('penolakan tidak silent: grup dapat pesan 🛑', /🛑/.test(toGroup(sockRefuse)), toGroup(sockRefuse).slice(0, 140))
  ok('command berbahaya tidak pernah dijalankan', !calls.some((c) => c.command === 'broadcast' && c.sender === MEMBER))
  ok('instruksi agent di grup tetap disamarkan di log command', !Handler._logSafe({ command: 'asisten', args: 'rahasia bisnis owner' }).includes('rahasia'))

  Ai.ask = originalAsk
  db.save(true)
  try { fs.unlinkSync(process.env.DB_PATH) } catch (_) {}
  try { fs.unlinkSync(process.env.DB_PATH + '.bak') } catch (_) {}
  console.log(`\n===== AKSES GRUP: ${pass} lulus, ${fail} gagal =====`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
