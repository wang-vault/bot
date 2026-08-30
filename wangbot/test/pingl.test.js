// Test fitur ping keluar (.pingl) + lapisan src/lib/netprobe.js.
// Termasuk pemeriksaan bahwa input chat tidak pernah bisa jadi perintah shell,
// parsing output ping lintas gaya (Linux/Windows/Indonesia), pengukuran TCP,
// dan command-nya lewat handler asli (owner + staf).
//
//   node test/pingl.test.js
const path = require('path')
const fs = require('fs')
const os = require('os')
const net = require('net')

const BOT = path.resolve(__dirname, '..')
process.env.OWNER_NUMBER = '6281234567890'
process.env.PREFIX = '.'
process.env.DB_PATH = path.join(os.tmpdir(), 'wangbot-pingl-db.json')
process.env.AUTH_PATH = path.join(os.tmpdir(), 'wangbot-pingl-auth')
delete process.env.PINGL_STAFF
delete process.env.PING_COUNT
delete process.env.PING_MAX_COUNT
delete process.env.PING_TIMEOUT
delete process.env.PING_BIN
try { fs.unlinkSync(process.env.DB_PATH) } catch (_) {}

const { Database } = require(path.join(BOT, 'src/database'))
const NetProbe = require(path.join(BOT, 'src/lib/netprobe'))
const Assistant = require(path.join(BOT, 'src/lib/assistant'))
const Handler = require(path.join(BOT, 'src/handler'))
const { loadCommands } = require(path.join(BOT, 'src/commands'))

const OWNER = '6281234567890@s.whatsapp.net'
const USER = '628999000111@s.whatsapp.net'
// .pingl punya cooldown 4 detik per pengirim -> tiap sub-test pakai nomor sendiri
let seq = 500
const fresh = () => `62877110${(seq++).toString().padStart(4, '0')}@s.whatsapp.net`
const GROUP = '120363000000000003@g.us'

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

function makeSock(parts = []) {
  const sock = {
    sent: [],
    user: { id: '6281234567899:12@s.whatsapp.net', name: 'WangBot' },
    sendMessage: async (jid, content) => {
      sock.sent.push({ jid, content })
      return { key: { id: 'S' + sock.sent.length } }
    },
    groupMetadata: async () => ({ id: GROUP, subject: 'Grup Uji', participants: parts }),
    sendPresenceUpdate: async () => ({}),
    presenceSubscribe: async () => ({}),
  }
  return sock
}

function rawMsg(text, sender, inGroup = false) {
  return {
    key: {
      remoteJid: inGroup ? GROUP : sender,
      fromMe: false,
      participant: inGroup ? sender : undefined,
      id: 'PL' + Math.random().toString(36).slice(2, 9).toUpperCase(),
    },
    message: { conversation: text },
    pushName: 'Tester',
    messageTimestamp: Math.floor(Date.now() / 1000),
  }
}
const textOf = (c) => (c && c.text) || ''
const last = (sock, i = 0) => sock.sent.slice(i).map((x) => textOf(x.content)).join('\n')

// Fake binary `ping` supaya parsing bisa diuji deterministik tanpa jaringan.
function fakePing(stdout, exitCode = 0) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wangbot-fakeping-'))
  const file = path.join(dir, 'ping')
  const payload = JSON.stringify({ stdout, exitCode })
  fs.writeFileSync(
    file,
    `#!/bin/sh\nprintf '%s' ${JSON.stringify(payload)} | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const o=JSON.parse(d);process.stdout.write(o.stdout);process.exit(o.exitCode)})'\n`
  )
  fs.chmodSync(file, 0o755)
  return { dir, file }
}

const LINUX_PING = `PING 1.1.1.1 (1.1.1.1) 56(84) bytes of data.
64 bytes from 1.1.1.1: icmp_seq=1 ttl=53 time=3.21 ms
64 bytes from 1.1.1.1: icmp_seq=2 ttl=53 time=2.98 ms
64 bytes from 1.1.1.1: icmp_seq=3 ttl=53 time=12.4 ms
64 bytes from 1.1.1.1: icmp_seq=4 ttl=53 time=3.05 ms

--- 1.1.1.1 ping statistics ---
4 packets transmitted, 4 received, 0% packet loss, time 3005ms
rtt min/avg/max/mdev = 2.980/5.410/12.400/3.981 ms
`

const WIN_ID = `Melakukan Ping ke google.com [142.250.185.206] dengan 32 byte data:
Balasan dari 142.250.185.206: icmp_seq=1 ttl=108 waktu=8ms
Balasan dari 142.250.185.206: icmp_seq=2 ttl=108 waktu<1ms
Permintaan timed out.
Balasan dari 142.250.185.206: icmp_seq=4 ttl=108 waktu=9ms

Perkiraan bulatan dalam milidetik:
    Paket = 8ms, Minimum = 0ms, Rata-rata = 8ms, Maksimum = 9ms
`

async function main() {
  const db = new Database(process.env.DB_PATH)
  Database.instance = db

  console.log('\n[A] VALIDASI ALAMAT (anti injeksi)')
  ok('IP biasa diterima', NetProbe.parseTarget('8.8.8.8').host === '8.8.8.8')
  ok('domain dinormalisasi ke kecil', NetProbe.parseTarget('Google.COM').host === 'google.com')
  ok('URL diambil hostname+portnya', (() => {
    const r = NetProbe.parseTarget('https://Web.Example.com:8443/path?q=1')
    return r.ok && r.host === 'web.example.com' && r.port === 8443
  })(), JSON.stringify(NetProbe.parseTarget('https://web.example.com:8443/x')))
  ok('host:port diterima', (() => {
    const r = NetProbe.parseTarget('mc.tokosugoi.id:25565')
    return r.ok && r.host === 'mc.tokosugoi.id' && r.port === 25565
  })())
  ok('[ipv6]:port diterima', (() => {
    const r = NetProbe.parseTarget('[2001:db8::1]:25565')
    return r.ok && r.host === '2001:db8::1' && r.ipv6 === true
  })(), JSON.stringify(NetProbe.parseTarget('[2001:db8::1]:25565')))
  ok('jumlah paket dari argumen kedua', NetProbe.parseTarget('1.1.1.1 6').count === 6)
  ok('jumlah paket dibatasi ke maksimum', NetProbe.parseTarget('1.1.1.1 999').count <= NetProbe.LIMITS.count.max)
  ok('titik akhir domain dibuang', NetProbe.parseTarget('google.com.').host === 'google.com')
  ok('backtick markdown dibuang', NetProbe.parseTarget('`8.8.8.8`').host === '8.8.8.8')
  // Inti keamanan: karakter shell tidak boleh lolos
  for (const evil of ['8.8.8.8; rm -rf /', '1.1.1.1 && id', '$(whoami)', '`id` ; reboot', 'a|b', 'x\ny', 'foo;bar', '../../etc/passwd', '8.8.8.8 -c 99999']) {
    const r = NetProbe.parseTarget(evil)
    ok(`injeksi ditolak: ${JSON.stringify(evil).slice(0, 30)}`, r.ok === false && !r.host, JSON.stringify(r))
  }
  ok('spasi di tengah ditolak', NetProbe.parseTarget('google .com').ok === false)
  ok('port di luar rentang ditolak', NetProbe.parseTarget('google.com:99999').ok === false)
  ok('argumen kosong -> contoh pemakaian', /Contoh/.test(NetProbe.parseTarget('').error))

  console.log('\n[B] ARGUMEN & PARSING OUTPUT')
  const args = NetProbe.buildArgs('1.1.1.1', { count: 5, timeoutSec: 2, ipv6: false })
  ok('argumen Linux = -c/-W lalu host (tanpa shell)', args.join(' ') === '-c 5 -W 2 1.1.1.1', args.join(' '))
  const args6 = NetProbe.buildArgs('2001:db8::1', { count: 3, timeoutSec: 1, ipv6: true })
  ok('IPv6 memakai flag -6', args6.includes('-6') && args6[args6.length - 1] === '2001:db8::1', args6.join(' '))
  const lin = NetProbe.parseIcmpOutput(LINUX_PING)
  ok('sampel waktu Linux terbaca', lin.samples.length === 4 && lin.samples[0] === 2.98 && lin.samples[3] === 12.4, JSON.stringify(lin.samples))
  ok('packet loss Linux terbaca', lin.transmitted === 4 && lin.received === 4 && lin.lossPct === 0)
  ok('ttl terbaca', lin.ttl === 53)
  const win = NetProbe.parseIcmpOutput(WIN_ID)
  ok('format Windows/Indonesia terbaca (waktu= dan waktu<1ms)', win.samples.length === 3 && win.samples[0] === 0.5, JSON.stringify(win.samples))
  ok('timeout tidak dihitung sebagai sampel', win.samples.length === 3 && win.received === 3)
  const st = NetProbe.stats([1, 2, 3, 4])
  ok('min/avg/max/jitter dihitung sendiri', st.min === 1 && st.avg === 2.5 && st.max === 4 && st.jitter === 1.12, JSON.stringify(st))
  ok('unknown host dikenali', NetProbe.parseIcmpOutput('ping: unknown host tidakada.example').unknownHost === true)
  ok('raw socket ditolak dikenali', /not permitted/.test('ping: socket: Operation not permitted') && NetProbe.parseIcmpOutput('ping: socket: Operation not permitted').permissionDenied === true)
  ok('alamat internal diberi label', NetProbe.isPrivateAddress('10.8.0.5') && NetProbe.isPrivateAddress('192.168.1.1') && !NetProbe.isPrivateAddress('1.1.1.1'))

  console.log('\n[C] EKSEKUSI PING (binary tiruan)')
  const fake = fakePing(LINUX_PING)
  const r1 = await NetProbe.pingIcmp('1.1.1.1', { count: 4, timeoutSec: 2, bin: fake.file })
  ok('hasil ping terukur dari binary', r1.ok === true && r1.received === 4 && r1.loss === 0, JSON.stringify(r1).slice(0, 200))
  ok('avg dihitung dari sampel', r1.avg === 5.41, String(r1.avg))
  const fmt = NetProbe.format({ ...r1, host: '1.1.1.1', dns: [], method: 'icmp', mode: 'auto' })
  ok('laporan menampilkan min/avg/max + status', /PING 1\.1\.1\.1/.test(fmt) && /Latensi/.test(fmt) && /min \*2\.98 ms\*/.test(fmt) && /🟢/.test(fmt), fmt)
  const fakeLoss = fakePing(`PING 8.8.8.8 (8.8.8.8) 56(84) bytes of data.
64 bytes from 8.8.8.8: icmp_seq=1 ttl=114 time=250.5 ms
From 10.0.0.1 icmp_seq=2 Destination Host Unreachable

--- 8.8.8.8 ping statistics ---
4 packets transmitted, 1 received, 75% packet loss, time 4000ms
`)
  const r2 = await NetProbe.pingIcmp('8.8.8.8', { count: 4, timeoutSec: 2, bin: fakeLoss.file })
  ok('packet loss besar -> verdict merah/kuning', r2.loss === 75 && r2.unreachable === true, JSON.stringify({ loss: r2.loss, un: r2.unreachable }))
  const fmtLoss = NetProbe.format({ ...r2, host: '8.8.8.8', dns: [], method: 'icmp', mode: 'auto' })
  ok('laporan menyebut angka loss', /75%/.test(fmtLoss) && /🟡|🔴/.test(fmtLoss), fmtLoss)
  const r3 = await NetProbe.pingIcmp('1.1.1.1', { count: 2, timeoutSec: 1, bin: '/tmp/ping-yang-tidak-ada' })
  ok('binary hilang -> unavailable (bukan crash)', r3.ok === false && r3.unavailable === true, JSON.stringify(r3).slice(0, 160))
  fs.rmSync(fake.dir, { recursive: true, force: true })
  fs.rmSync(fakeLoss.dir, { recursive: true, force: true })

  console.log('\n[D] MODE TCP (cek port)')
  const server = net.createServer((sock) => {
    sock.end('ok')
    sock.on('error', () => {}) // klien menutup socket -> ECONNRESET di sisi server tidak boleh menjatuhkan test
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const tcp = await NetProbe.tcpProbe('127.0.0.1', port, { count: 3, timeoutMs: 1500 })
  ok('port terbuka -> 3 koneksi terukur', tcp.ok === true && tcp.received === 3 && tcp.loss === 0, JSON.stringify(tcp).slice(0, 180))
  ok('latensi handshake berupa angka', typeof tcp.avg === 'number' && tcp.avg >= 0, String(tcp.avg))
  const closed = await NetProbe.tcpProbe('127.0.0.1', port === 1 ? 2 : port - 1, { count: 1, timeoutMs: 800 })
  ok('port tertutup -> refused terdeteksi', closed.ok === false && /ECONNREFUSED|timeout/.test((closed.errors || []).join(',')), JSON.stringify(closed).slice(0, 160))
  const fmtTcp = NetProbe.format({ ...tcp, host: '127.0.0.1', dns: [], method: 'tcp', mode: 'auto' })
  ok('laporan TCP menyebut port terbuka', /Port\s*:\s*\d+ — 🟢 terbuka/.test(fmtTcp), fmtTcp)

  console.log('\n[E] AUTO FALLBACK (ICMP mati -> TCP)')
  const noPerm = fakePing('ping: socket: Operation not permitted', 2)
  const auto = await NetProbe.probe(`127.0.0.1:${port}`, { bin: noPerm.file, count: 1, timeoutSec: 1, mode: 'auto' })
  ok('ICMP tidak bisa -> jatuh ke TCP', auto.method === 'tcp' && auto.ok === true, JSON.stringify({ m: auto.method, ok: auto.ok }))
  ok('ada catatan bahwa ICMP tidak tersedia', /icmp-unavailable/.test(JSON.stringify(auto)))
  const icmpOnly = await NetProbe.probe('127.0.0.1', { bin: noPerm.file, count: 1, timeoutSec: 1, mode: 'icmp' })
  ok('mode icmp eksplisit tidak diam-diam berganti metode', icmpOnly.method === 'icmp')
  fs.rmSync(noPerm.dir, { recursive: true, force: true })
  server.close()

  console.log('\n[F] COMMAND .pingl LEWAT HANDLER ASLI')
  const loader = loadCommands()
  const realPing = NetProbe.pingBin()
  const canPing = fs.existsSync(realPing)
  const sockOwner = makeSock()
  await Handler.handle(sockOwner, db, loader, rawMsg(`.pingl ${canPing ? '127.0.0.1 2' : 'localhost:22 1'}`, OWNER))
  const ownerOut = last(sockOwner)
  ok('owner dapat menjalankan .pingl', /PING/.test(ownerOut) && /(Latensi|Hasil|Status)/.test(ownerOut), ownerOut.slice(0, 200))
  ok('alamat yang diuji ikut ditampilkan', new RegExp(canPing ? '127\\.0\\.0\\.1' : 'LOCALHOST').test(ownerOut.toUpperCase()), ownerOut.slice(0, 120))

  const sockNoArg = makeSock()
  await Handler.handle(sockNoArg, db, loader, rawMsg('.pingl', OWNER))
  ok('tanpa argumen -> bantuan cara pakai', /PING LUAR/.test(last(sockNoArg)) && /8\.8\.8\.8/.test(last(sockNoArg)), last(sockNoArg).slice(0, 120))

  const sockUser = makeSock()
  await Handler.handle(sockUser, db, loader, rawMsg('.pingl 8.8.8.8', USER))
  ok('user biasa ditolak (bukan owner/staf)', /khusus \*Owner\*|hanya untuk owner/i.test(last(sockUser)) || sockUser.sent.length === 0, last(sockUser).slice(0, 160))

  const senderGroup = fresh()
  const sockUserGroup = makeSock([{ id: senderGroup, jid: senderGroup, admin: 'admin' }, { id: OWNER, jid: OWNER, admin: 'superadmin' }])
  await Handler.handle(sockUserGroup, db, loader, rawMsg('.pingl 8.8.8.8', senderGroup, true))
  ok('admin grup pun tidak bisa pakai .pingl', sockUserGroup.sent.every((x) => !/PING 8\.8\.8\.8/.test(textOf(x.content))), JSON.stringify(sockUserGroup.sent.map((x) => textOf(x.content).slice(0, 40))))

  // staf tambahan dari database boleh memakai
  const staff = fresh()
  const staffSeen = last
  const sockStaff = makeSock()
  await Handler.handle(sockStaff, db, loader, rawMsg(`.pingl staff add ${staff.split('@')[0]}`, OWNER))
  ok('owner dapat menambah staf', /sekarang staf/.test(staffSeen(sockStaff)), staffSeen(sockStaff).slice(0, 120))
  const sockStaff2 = makeSock()
  await Handler.handle(sockStaff2, db, loader, rawMsg('.pingl 127.0.0.1 1', staff))
  ok('staf yang didaftarkan boleh memakai .pingl', /PING 127\.0\.0\.1/.test(staffSeen(sockStaff2)), staffSeen(sockStaff2).slice(0, 200))
  const sockStaffList = makeSock()
  await Handler.handle(sockStaffList, db, loader, rawMsg('.pingl staff list', OWNER))
  ok('daftar staf bisa dilihat owner', new RegExp(staff.split('@')[0]).test(staffSeen(sockStaffList)), staffSeen(sockStaffList).slice(0, 160))
  const sockStaffDel = makeSock()
  await Handler.handle(sockStaffDel, db, loader, rawMsg(`.pingl staff del ${staff.split('@')[0]}`, OWNER))
  ok('staf dapat dihapus', /tidak lagi menjadi staf/.test(staffSeen(sockStaffDel)), staffSeen(sockStaffDel).slice(0, 120))
  // tunggu sampai cooldown command (4 detik per pengirim) lewat, supaya yang
  // diuji benar-benar pencabutan hak - bukan cooldown.
  await new Promise((r) => setTimeout(r, 4200))
  const sockStaff3 = makeSock()
  await Handler.handle(sockStaff3, db, loader, rawMsg('.pingl 127.0.0.1 1', staff))
  ok('setelah dihapus, staf kehilangan hak', !/PING 127/.test(staffSeen(sockStaff3)) && /hanya untuk owner/i.test(staffSeen(sockStaff3)), staffSeen(sockStaff3).slice(0, 160))
  const selfPromote = fresh()
  const sockStaffOwnerOnly = makeSock()
  await Handler.handle(sockStaffOwnerOnly, db, loader, rawMsg(`.pingl staff add ${selfPromote.split('@')[0]}`, selfPromote))
  ok('non-owner tidak bisa menambah dirinya jadi staf', /hanya bisa diubah \*Owner\*/.test(staffSeen(sockStaffOwnerOnly)) && !db.data.pingl.staff.includes(selfPromote), staffSeen(sockStaffOwnerOnly).slice(0, 160))

  console.log('\n[G] INTEGRITAS & PEMAKAIAN')
  const sockInject = makeSock()
  const reqsBefore = db.data.pingl.stats.runs
  const injector = fresh()
  process.env.PINGL_STAFF = injector.split('@')[0] // biar lolos pagar kepemilikan, fokus uji validasi
  await Handler.handle(sockInject, db, loader, rawMsg('.pingl 8.8.8.8; rm -rf /', injector))
  ok('percobaan injeksi berhenti di validasi', /tidak sah|tidak diizinkan|bukan nama domain/.test(last(sockInject)), last(sockInject).slice(0, 180))
  ok('target tidak aman tidak dihitung sebagai tes', db.data.pingl.stats.runs === reqsBefore, JSON.stringify(db.data.pingl.stats))
  delete process.env.PINGL_STAFF
  ok('statistik pemakaian tercatat', db.data.pingl.stats.runs >= 1 && /127\.0\.0\.1|localhost/.test(db.data.pingl.stats.lastHost), JSON.stringify(db.data.pingl.stats))
  const sockMany = makeSock()
  await Handler.handle(sockMany, db, loader, rawMsg('.pingl a.com, b.com, c.com, d.com, e.com, f.com', OWNER))
  ok('lebih dari 5 alamat sekaligus ditolak', /Maksimal 5/.test(last(sockMany)), last(sockMany).slice(0, 120))
  ok('help command terdaftar di menu', loader.commands.some((c) => c.name === 'pingl' && c.category === 'monitoring'))
  ok('alias pingluar & pinghost aktif', loader.resolve('pingluar') && loader.resolve('pingluar').name === 'pingl' && loader.resolve('pinghost').name === 'pingl')

  console.log('\n[H] AGENT: PING SEBAGAI ALAT BACA')
  ok('policy pingl = read', Assistant.policyFor('pingl', '8.8.8.8') === 'read')
  const catalog = Assistant.commandCatalog({ db, loader, config: { prefix: '.' }, sender: OWNER, chat: OWNER, isOwner: true, isGroup: false })
  ok('katalog alat agent memuat pingl', /- pingl/.test(catalog), catalog.slice(0, 120))
  const prompt = Assistant.plannerPrompt({ db, isOwner: true, isGroup: false, chat: OWNER, sender: OWNER, loader, config: { prefix: '.' }, groupName: '' })
  ok('prompt planner menyertakan pingl', /pingl <ip/.test(prompt))
  const groupCtx = Assistant.contextFor({ db, isGroup: true, chat: GROUP, sender: USER, groupName: 'G', isOwner: false })
  ok('di grup pingl tetap alat baca (tools read)', GroupAccessToolCheck(groupCtx))
  function GroupAccessToolCheck(ctx) {
    const GA = require(path.join(BOT, 'src/lib/group-access'))
    return GA.toolAllowed('read', Assistant.policyFor('pingl')) === true && GA.toolAllowed('none', Assistant.policyFor('pingl')) === false
  }
  ok('tidak ada command shell lain yang ikut terbuka', Assistant.policyFor('exec', 'id') === 'blocked' && Assistant.policyFor('eval', '1') === 'blocked')

  db.save(true)
  const db2 = new Database(process.env.DB_PATH)
  ok('statistik pingl bertahan setelah restart', typeof db2.data.pingl.stats.runs === 'number' && Array.isArray(db2.data.pingl.staff))
  try { fs.unlinkSync(process.env.DB_PATH) } catch (_) {}
  try { fs.unlinkSync(process.env.DB_PATH + '.bak') } catch (_) {}
  console.log(`\n===== PING LUAR: ${pass} lulus, ${fail} gagal =====`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
