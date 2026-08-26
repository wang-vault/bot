// Test fitur monitoring server Minecraft:
//   - protokol SLP & RCON diuji terhadap server TCP palsu (test/fake-mc.js)
//   - Pterodactyl Client API diuji terhadap panel palsu (test/fake-client-panel.js)
//   - command .mcstatus/.mcplayers/.mcres/.mcpower dijalankan lewat handler asli
//   - alert otomatis diuji lewat Monitor.nowMc()
//
//   node test/mc.test.js
const path = require('path')
const os = require('os')
const fs = require('fs')
const net = require('net')

const BOT = path.resolve(__dirname, '..')
process.env.OWNER_NUMBER = '6281234567890'
process.env.DB_PATH = path.join(os.tmpdir(), 'wangbot-mc-test-db.json')
process.env.BROADCAST_DELAY = '0'
process.env.MC_PING_TIMEOUT = '800'
process.env.MC_MONITOR_INTERVAL = '1'
// Hapus file utama DAN .bak: Database._write() menyimpan cadangan .bak, dan
// bila file utama tidak ada ia memulihkan dari .bak (data run sebelumnya).
for (const f of [process.env.DB_PATH, process.env.DB_PATH + '.bak', process.env.DB_PATH + '.tmp']) {
  try {
    fs.unlinkSync(f)
  } catch (_) {}
}

const { Database } = require(path.join(BOT, 'src/database'))
const config = require(path.join(BOT, 'src/config'))
const MC = require(path.join(BOT, 'src/lib/minecraft'))
const Mc = require(path.join(BOT, 'src/lib/mc'))
const Panel = require(path.join(BOT, 'src/lib/panel'))
const Monitor = require(path.join(BOT, 'src/lib/monitor'))
const { handle } = require(path.join(BOT, 'src/handler'))
const { loadCommands } = require(path.join(BOT, 'src/commands'))
const startFakeMc = require('./fake-mc')
const startFakePanel = require('./fake-client-panel')

const OWNER = '6281234567890@s.whatsapp.net'
const CUSTOMER = '628999000111@s.whatsapp.net'
const OTHER = '628777666555@s.whatsapp.net'

let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) {
    pass++
    console.log('  ✅ ' + name)
  } else {
    fail++
    console.log('  ❌ ' + name + (extra ? ' -> ' + extra : ''))
  }
}

function makeSock() {
  const sent = []
  return {
    sent,
    user: { id: OWNER.replace('@', ':11@') },
    sendMessage: async (jid, content) => {
      sent.push({ jid, text: content && content.text ? content.text : '' })
      return {}
    },
    groupMetadata: async (jid) => ({ id: jid, subject: 'G', participants: [] }),
    store: { groupMetadata: new Map(), messages: new Map() },
    lastText(jid) {
      const hits = sent.filter((s) => !jid || s.jid === jid)
      return hits.length ? hits[hits.length - 1].text : ''
    },
  }
}

function wa(sock, text, sender, chat) {
  return {
    key: { remoteJid: chat || sender, fromMe: false, id: 'MC' + Math.random().toString(36).slice(2), participant: sender },
    message: { conversation: text },
    pushName: 'tester',
    messageTimestamp: Math.floor(Date.now() / 1000),
  }
}

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port
      s.close(() => resolve(p))
    })
  })
}

async function main() {
  const loader = loadCommands()
  const db = new Database(process.env.DB_PATH)

  console.log('\n[1] PROTOKOL: VarInt, MOTD, player list, uptime')
  ok('writeVarInt(0) = 0x00', MC.writeVarInt(0).equals(Buffer.from([0x00])))
  ok('writeVarInt(300) = 0xAC 0x02', MC.writeVarInt(300).equals(Buffer.from([0xac, 0x02])))
  ok('writeVarInt(2147483647) 5 byte', MC.writeVarInt(2147483647).length === 5)
  const back = MC.readVarInt(MC.writeVarInt(25565))
  ok('readVarInt(writeVarInt(25565)) == 25565 (3 byte)', back.value === 25565 && back.size === 3, JSON.stringify(back))
  ok('readVarInt data belum lengkap -> null', MC.readVarInt(Buffer.from([0x80]), 0) === null)
  ok(
    'motdText meratakan chat component + buang kode warna',
    MC.motdText({ text: '§aWang§7Store', extra: [{ text: ' §bSMP' }] }) === 'WangStore SMP',
    MC.motdText({ text: '§aWang§7Store', extra: [{ text: ' §bSMP' }] })
  )
  ok('stripColors buang §k-§r', MC.stripColors('§lbold§r normal') === 'bold normal')
  ok(
    'playerList memotong di limit',
    MC.playerList({ players: { online: 3, sample: ['a', 'b', 'c'] } }, 2).includes('1 player lainnya')
  )
  ok('uptimeText 90 menit -> 1j 30m', MC.uptimeText(5400000) === '1j 30m', MC.uptimeText(5400000))

  console.log('\n[2] SLP: ping server Minecraft palsu')
  const fake = await startFakeMc({ mode: 'slp' })
  const rconFake = await startFakeMc({ mode: 'rcon' })
  const p = await MC.ping('127.0.0.1', fake.port)
  ok('ping menjawab online', p.online === true, JSON.stringify(p))
  ok('player online terbaca 3/20', p.online && p.players.online === 3 && p.players.max === 20)
  ok('versi terbaca', p.online && /Paper 1\.20\.4/.test(p.version.name), p.online ? p.version.name : '')
  ok('MOTD terbaca & bersih dari kode warna', p.online && p.description === 'WangStore | Survival SMP', p.online ? p.description : '')
  ok('latency terisi angka', p.online && typeof p.latency === 'number' && p.latency >= 0)
  ok('sample player terbaca', p.online && p.players.sample.join(',') === 'Budi,Sari,Joko')
  ok('server palsu mencatat request SLP', fake.log.slpRequests >= 1, 'slpRequests=' + fake.log.slpRequests)

  const closed = await freePort()
  const pDown = await MC.ping('127.0.0.1', closed)
  ok('port tertutup -> online:false + pesan error', pDown.online === false && /ditolak/.test(pDown.error || ''), JSON.stringify(pDown))

  console.log('\n[3] RCON: login, command, password salah')
  const r = await MC.rcon('127.0.0.1', rconFake.port, 'rahasia123', 'list')
  ok('rcon mengembalikan output list', /Budi, Sari, Joko/.test(r[0].response), JSON.stringify(r))
  ok('server palsu menerima command "list"', rconFake.log.rconCommands.includes('list'))
  const authPkt = MC.rconPacket(1, 3, 'rahasia123')
  const authBody = authPkt.slice(12, 4 + authPkt.readInt32LE(0) - 2)
  ok('paket RCON: string ber-prefix VarInt (bukan karakter mentah)', authBody[0] === 10 && authBody.slice(1).toString() === 'rahasia123', authBody.toString('hex'))
  let authErr = ''
  try {
    await MC.rcon('127.0.0.1', rconFake.port, 'salah', 'list')
  } catch (e) {
    authErr = e.message
  }
  ok('password salah ditolak', /password RCON salah/.test(authErr), authErr)
  let connErr = ''
  try {
    await MC.rcon('127.0.0.1', closed, 'rahasia123', 'list')
  } catch (e) {
    connErr = e.message
  }
  ok('RCON ke port tertutup memberi pesan jelas', /ditolak/.test(connErr), connErr)

  console.log('\n[4] Registry pelanggan (lib/mc.js)')
  const panel = await startFakePanel({ mcPort: fake.port })
  config.panelApiUrl = 'http://127.0.0.1:' + panel.port
  config.panelClientToken = panel.state.token
  config.mcEnabled = true

  Mc.setEntry(db, CUSTOMER, { email: 'budi@example.com', token: panel.state.token })
  const list = await Mc.listFromPanel(Mc.getEntry(db, CUSTOMER))
  ok('Client API mengembalikan 2 server', !list.error && list.servers.length === 2, JSON.stringify(list))
  ok('alamat MC terbaca dari allocation default', list.servers[0].mcHost === '127.0.0.1' && list.servers[0].mcPort === fake.port, JSON.stringify(list.servers && list.servers[0]))

  const reg = Mc.registerServer(db, CUSTOMER, list.servers[0])
  ok('server terdaftar di registry', !reg.error && reg.server.identifier === 'abcd1234')
  ok('countFor pelanggan = 1', Mc.countFor(db, CUSTOMER) === 1)

  const mine = Mc.resolveServer(db, CUSTOMER, false, '')
  ok('resolve tanpa argumen -> server satu-satunya', !mine.error && mine.server.name === 'Survival')
  const byName = Mc.resolveServer(db, CUSTOMER, false, 'surv')
  ok('resolve dengan sebagian nama', !byName.error && byName.server.identifier === 'abcd1234')
  const steal = Mc.resolveServer(db, OTHER, false, 'Survival')
  ok('pelanggan lain TIDAK bisa mengakses server ini', !!steal.error, JSON.stringify(steal))
  const asOwner = Mc.resolveServer(db, OWNER, true, 'Survival')
  ok('owner bisa mengakses server pelanggan', !asOwner.error && asOwner.server.name === 'Survival')

  console.log('\n[5] Command lewat handler asli')
  const sock = makeSock()

  await handle(sock, db, loader, wa(sock, config.prefix + 'mcservers', CUSTOMER))
  ok('.mcservers menampilkan server & token tersamar', /Survival/.test(sock.lastText()) && !/ptlc_fakeclienttoken/.test(sock.lastText()), sock.lastText().slice(0, 120))

  await handle(sock, db, loader, wa(sock, config.prefix + 'mcstatus', CUSTOMER))
  const st = sock.lastText()
  ok('.mcstatus melaporkan ONLINE', /ONLINE/.test(st), st.slice(0, 160))
  ok('.mcstatus menampilkan jumlah player', /Player\s*:\s*3\/20/.test(st), st.slice(0, 200))
  ok('.mcstatus menampilkan RAM dari panel', /RAM/.test(st) && /75%/.test(st), st.replace(/\n/g, ' | ').slice(0, 300))

  await handle(sock, db, loader, wa(sock, config.prefix + 'mcplayers', CUSTOMER))
  ok('.mcplayers menampilkan daftar nama', /Budi/.test(sock.lastText()), sock.lastText().slice(0, 120))

  await handle(sock, db, loader, wa(sock, config.prefix + 'mcres', CUSTOMER))
  ok('.mcres menghitung persen RAM', /RAM/.test(sock.lastText()) && /75%/.test(sock.lastText()), sock.lastText().replace(/\n/g, ' | ').slice(0, 200))

  // resource lewat Client API langsung
  const res = await Panel.clientResources('abcd1234')
  ok('clientResources: 3072/4096 MB = 75%', res.ramPct === 75 && res.memoryMB === 3072, JSON.stringify(res))
  ok('clientResources: cpu_absolute 45.6 -> 45.6%', res.cpuPctRaw === 45.6, JSON.stringify(res))
  ok('clientResources: uptime 90 menit', MC.uptimeText(res.uptimeMs) === '1j 30m')

  // .mcpower
  await handle(sock, db, loader, wa(sock, config.prefix + 'mcpower Survival restart', CUSTOMER))
  ok('.mcpower mengirim signal restart ke panel', panel.log.power.includes('restart'), JSON.stringify(panel.log.power))
  ok('.mcpower menjawab sukses', /Perintah/.test(sock.lastText()), sock.lastText().slice(0, 100))

  // .mcwatch off
  await handle(sock, db, loader, wa(sock, config.prefix + 'mcwatch Survival off', CUSTOMER))
  ok('.mcwatch off menghapus dari pemantauan', Mc.serverOf(db, 'abcd1234') === null, sock.lastText().slice(0, 80))
  await new Promise((r) => setTimeout(r, 5500)) // lewati cooldown .mcwatch (5 detik)
  await handle(sock, db, loader, wa(sock, config.prefix + 'mcwatch Survival', CUSTOMER))
  ok('.mcwatch mengembalikan server ke daftar', !!Mc.serverOf(db, 'abcd1234'))

  console.log('\n[6] Alert otomatis (Monitor.nowMc)')
  // 6a: panel bilang running -> tidak ada alert
  let r1 = await Mc.monitorTick(db)
  ok('tick pertama: 1 server diperiksa, 0 down', r1.checked === 1 && r1.down === 0, JSON.stringify(r1))
  ok('tidak ada alert saat server sehat', r1.alerts.length === 0 && r1.adminAlerts.length === 0)

  // 6b: server mati -> tick 1 menandai, tick 2 baru alert
  const srvRec = Mc.serverOf(db, 'abcd1234')
  srvRec.panel = false // matikan sumber panel supaya SLP jadi penentu
  srvRec.host = '127.0.0.1'
  srvRec.port = closed
  db.save()

  let r2 = await Mc.monitorTick(db)
  ok('server mati tick-1: terdeteksi down tapi belum alert', r2.down === 1 && r2.alerts.length === 0, JSON.stringify(r2))
  let r3 = await Mc.monitorTick(db)
  ok('server mati tick-2: alert ke pelanggan', r3.down === 1 && r3.alerts.length === 1 && r3.alerts[0].jid === CUSTOMER, JSON.stringify(r3))
  ok('isi alert menyebut nama server', r3.alerts[0] && /Survival/.test(r3.alerts[0].text), r3.alerts[0] && r3.alerts[0].text)
  ok('admin ikut diberi tahu', r3.adminAlerts.length === 1, JSON.stringify(r3.adminAlerts))
  let r4 = await Mc.monitorTick(db)
  ok('tidak spam alert saat masih mati', r4.down === 1 && r4.alerts.length === 0, JSON.stringify(r4))
  // remindEveryMs negatif = pengingat selalu jatuh tempo. Tidak pakai 1 ms
  // karena bila tick berjalan pada milidetik yang sama (elapsed 0) tes jadi flaky.
  const rRemind = await Mc.monitorTick(db, { remindEveryMs: -1 })
  ok('pengingat berkala dikirim bila diminta', rRemind.alerts.length === 1 && /Server Minecraft Down/.test(rRemind.alerts[0].text), JSON.stringify(rRemind.alerts))

  // 6c: pulih -> alert RECOVER lewat Monitor.nowMc (jalur scheduler sungguhan)
  srvRec.port = fake.port
  db.save()
  const sock2 = makeSock()
  await Monitor.nowMc(sock2, db)
  ok('alert recover terkirim ke nomor pelanggan', sock2.sent.some((s) => s.jid === CUSTOMER && /Kembali Online/.test(s.text)), JSON.stringify(sock2.sent.map((s) => s.jid + ': ' + s.text.slice(0, 40))))

  // 6d: RAM tinggi memicu alert sekali saja
  panel.state.resources.resources.memory_bytes = 4000 * 1024 * 1024 // 97%
  srvRec.panel = true
  db.save()
  const r5 = await Mc.monitorTick(db)
  ok('RAM 97% memicu alert', r5.alerts.length === 1 && /RAM Server Tinggi/.test(r5.alerts[0].text), JSON.stringify(r5.alerts))
  const r6 = await Mc.monitorTick(db)
  ok('alert RAM tidak berulang selama masih tinggi', r6.alerts.length === 0, JSON.stringify(r6.alerts))
  panel.state.resources.resources.memory_bytes = 1024 * 1024 * 1024 // turun ke 25%
  await Mc.monitorTick(db)
  panel.state.resources.resources.memory_bytes = 4000 * 1024 * 1024 // naik lagi
  const r7 = await Mc.monitorTick(db)
  ok('alert RAM muncul lagi setelah sempat turun', r7.alerts.length === 1, JSON.stringify(r7.alerts))

  console.log('\n[7] Panel: token salah & server tanpa panel')
  config.panelClientToken = 'ptlc_salah'
  const bad = await Panel.clientResources('abcd1234')
  ok('token salah -> pesan actionable, bukan crash', /Token ditolak/.test(bad.error || ''), JSON.stringify(bad))
  config.panelClientToken = panel.state.token

  console.log('\n[8] .mcadmin (owner) & menu')
  await handle(sock, db, loader, wa(sock, config.prefix + 'mcadmin list', OWNER))
  ok('.mcadmin list menampilkan server pelanggan', /Survival/.test(sock.lastText()) && /628999000111/.test(sock.lastText()), sock.lastText().replace(/\n/g, ' | ').slice(0, 200))
  await handle(sock, db, loader, wa(sock, config.prefix + 'mcadmin list', CUSTOMER))
  ok('.mcadmin ditolak untuk non-owner', /khusus \*Owner\*/.test(sock.lastText()), sock.lastText().slice(0, 60))

  await handle(sock, db, loader, wa(sock, config.prefix + 'mcadmin add 628555000111 ManualMC 127.0.0.1 ' + fake.port, OWNER))
  ok('.mcadmin add mendaftarkan server manual', /didaftarkan/.test(sock.lastText()), sock.lastText().slice(0, 100))
  const manual = Mc.allServers(db).find((s) => s.name === 'ManualMC')
  ok('server manual tersimpan tanpa sumber panel', !!manual && manual.panel === false && manual.host === '127.0.0.1')
  const chkManual = await Mc.checkServer(db, manual)
  ok('server manual bisa diping (online)', chkManual.online === true, JSON.stringify(chkManual.error))

  await handle(sock, db, loader, wa(sock, config.prefix + 'menu', CUSTOMER))
  ok('menu menampilkan kategori SERVER MINECRAFT', /SERVER MINECRAFT/.test(sock.lastText()))
  ok('menu menampilkan .mcstatus', /mcstatus/.test(sock.lastText()))

  console.log('\n[9] Keamanan: console command dibatasi di grup')
  const GROUP = '111-222@g.us'
  await handle(sock, db, loader, wa(sock, config.prefix + 'mcconsole Survival say halo', CUSTOMER, GROUP))
  ok('console ditolak di grup untuk pelanggan', /chat pribadi/.test(sock.lastText()), sock.lastText().slice(0, 80))
  // tunggu cooldown command (mcconsole cooldown 6 detik) lewat dulu
  await new Promise((r) => setTimeout(r, 6500))
  await handle(sock, db, loader, wa(sock, config.prefix + 'mcconsole Survival stop', CUSTOMER))
  ok('command berbahaya butuh konfirmasi --ya', /--ya/.test(sock.lastText()), sock.lastText().slice(0, 120))
  await new Promise((r) => setTimeout(r, 6500))
  await handle(sock, db, loader, wa(sock, config.prefix + 'mcconsole Survival say halo --ya', CUSTOMER))
  ok('dengan --ya command diteruskan (gagal wajar karena tanpa panel ws)', /Gagal menjalankan command|CONSOLE/.test(sock.lastText()), sock.lastText().slice(0, 90))

  console.log('\n[10] Persistensi database')
  db.save(true) // paksa tulis (save() biasa di-debounce 400ms)
  const raw = JSON.parse(fs.readFileSync(process.env.DB_PATH, 'utf8'))
  ok('registry tersimpan di database.json', !!raw.minecraft && !!raw.minecraft.servers.abcd1234)
  ok('Client API key tersimpan untuk pelanggan', raw.minecraft.entries[CUSTOMER].token === panel.state.token)
  ok('state monitoring tersimpan', !!raw.monitor.lastMcState.abcd1234, JSON.stringify(raw.monitor.lastMcState))
  const db2 = new Database(process.env.DB_PATH)
  ok('database bisa dibaca ulang dengan data MC utuh', Mc.allServers(db2).length >= 2, String(Mc.allServers(db2).length))

  fake.server.close()
  rconFake.server.close()
  panel.server.close()

  console.log(`\n===== HASIL: ${pass} lulus, ${fail} gagal =====`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
