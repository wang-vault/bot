// Personal Agent tests: persona, structured planner, command policy/approval,
// long-term memory, and source scanner. No real AI/network/WhatsApp is used.
const fs = require('fs')
const os = require('os')
const path = require('path')

const BOT = path.resolve(__dirname, '..')
process.env.OWNER_NUMBER = '6281234567890'
process.env.PREFIX = '.'
process.env.AI_API_URL = 'http://127.0.0.1:9999/v1'
process.env.AI_API_KEY = 'test-key'
process.env.AI_MODEL = 'test-model'
process.env.ASSISTANT_MODE = 'safe'
process.env.ASSISTANT_AUTO_CHAT = '0'
process.env.DB_PATH = path.join(os.tmpdir(), 'wangbot-assistant-db.json')

try { fs.unlinkSync(process.env.DB_PATH) } catch (_) {}

const { Database } = require(path.join(BOT, 'src/database'))
const config = require(path.join(BOT, 'src/config'))
const func = require(path.join(BOT, 'src/lib/func'))
const Ai = require(path.join(BOT, 'src/lib/ai'))
const Persona = require(path.join(BOT, 'src/lib/persona'))
const Assistant = require(path.join(BOT, 'src/lib/assistant'))
const CodeHealth = require(path.join(BOT, 'src/lib/code-health'))
const Guardian = require(path.join(BOT, 'src/lib/guardian'))
const Handler = require(path.join(BOT, 'src/handler'))

const OWNER = '6281234567890@s.whatsapp.net'
let pass = 0
let fail = 0
const ok = (name, condition, detail = '') => {
  if (condition) {
    pass++
    console.log(`  ✅ ${name}`)
  } else {
    fail++
    console.log(`  ❌ ${name}${detail ? ` -> ${detail}` : ''}`)
  }
}

function makeLoader(calls) {
  const commands = [
    {
      name: 'runtime', aliases: ['uptime'], category: 'utility', desc: 'runtime',
      run: async (m) => { calls.push({ command: 'runtime', args: m.args }); await m.reply('RUNTIME_OK') },
    },
    {
      name: 'checkmonitor', aliases: [], category: 'monitoring', desc: 'monitor',
      run: async (m) => { calls.push({ command: 'checkmonitor', args: m.args }); await m.reply('MONITOR_OK') },
    },
    {
      name: 'broadcast', aliases: ['bc'], category: 'broadcast', desc: 'broadcast',
      run: async (m) => { calls.push({ command: 'broadcast', args: m.args }); await m.reply('BROADCAST_OK') },
    },
    {
      name: 'exec', aliases: ['$'], category: 'owner', desc: 'shell',
      run: async (m) => { calls.push({ command: 'exec', args: m.args }); await m.reply('MUST_NOT_RUN') },
    },
    {
      name: 'rules', aliases: [], category: 'community', desc: 'group only', isGroup: true,
      run: async (m) => { calls.push({ command: 'rules', args: m.args }); await m.reply('MUST_NOT_RUN') },
    },
  ]
  const byToken = {}
  for (const command of commands) {
    byToken[command.name] = command
    for (const alias of command.aliases) byToken[alias] = command
  }
  return { commands, resolve: (name) => byToken[String(name || '').toLowerCase()] }
}

function makeM(db, loader) {
  const sent = []
  const sock = {
    sent,
    sendMessage: async (jid, content) => { sent.push({ jid, content }); return { key: { id: String(sent.length) } } },
    sendPresenceUpdate: async () => ({}),
    presenceSubscribe: async () => ({}),
  }
  return {
    db,
    loader,
    config,
    func,
    sock,
    conn: sock,
    sender: OWNER,
    chat: OWNER,
    isOwner: true,
    isGroup: false,
    isCmd: true,
    fromMe: false,
    body: '',
    args: '',
    query: '',
    command: 'asisten',
    reply: async (text) => { sent.push({ jid: OWNER, content: { text: String(text) } }); return {} },
    replyMedia: async (content) => { sent.push({ jid: OWNER, content }); return {} },
    react: async () => ({}),
    sent,
  }
}

function texts(m) {
  return m.sent.map((x) => x.content && x.content.text || '').filter(Boolean).join('\n')
}

async function main() {
  const db = new Database(process.env.DB_PATH)
  const calls = []
  const loader = makeLoader(calls)
  const m = makeM(db, loader)

  console.log('\n[A] PERSONA + MEMORI')
  ok('default nama mengikuti BOT_NAME', Persona.resolve(db).name === config.botName, Persona.resolve(db).name)
  ok('persona name dapat diubah', Persona.set(db, 'name', 'Aruna').ok && Persona.resolve(db).name === 'Aruna')
  ok('persona role persisten di database', Persona.set(db, 'role', 'asisten penuh Wang').ok && db.data.assistant.persona.role === 'asisten penuh Wang')
  ok('memori fakta dapat ditulis', Persona.remember(db, 'jadwal-laporan', 'setiap Senin pagi').ok)
  ok('memori menolak API key/token', Persona.remember(db, 'api-key', 'sk-super-rahasia-123456').ok === false)
  ok('memori menolak key prototype khusus', Persona.remember(db, '__proto__', 'nilai').ok === false)
  ok('system prompt membawa identitas', /Identitasmu adalah Aruna/.test(Persona.systemPrompt(db, '', { isOwner: true })))
  const publicPrompt = Persona.systemPrompt(db, '', { isOwner: false, isGroup: true })
  ok('memori pribadi tidak masuk prompt user biasa', !publicPrompt.includes('setiap Senin pagi') && /tidak tersedia/.test(publicPrompt))
  db.save(true)
  const dbReload = new Database(process.env.DB_PATH)
  ok('persona bertahan setelah reload', Persona.resolve(dbReload).name === 'Aruna')
  ok('memori bertahan setelah reload', Persona.memoryEntries(dbReload).some((x) => x.key === 'jadwal-laporan'))

  console.log('\n[B] PARSER RENCANA TERSTRUKTUR')
  const parsed = Assistant.parsePlan('```json\n{"reply":"Aku cek.","actions":[{"command":"runtime","args":"","reason":"cek"}],"remember":[]}\n```')
  ok('JSON dalam code fence terbaca', parsed && parsed.reply === 'Aku cek.' && parsed.actions[0].command === 'runtime')
  const nested = Assistant.parsePlan('teks {"reply":"x { aman }","actions":[],"remember":[]} sisa')
  ok('parser menghormati kurung di dalam string', nested && nested.reply === 'x { aman }')
  ok('respons bukan JSON ditolak sebagai rencana', Assistant.parsePlan('jawaban biasa') === null)
  ok('exec tidak muncul di katalog alat', !Assistant.commandCatalog(m).includes('- exec'))
  ok('command khusus grup tidak muncul dan tetap diblokir', !Assistant.commandCatalog(m).includes('- rules') && Assistant.canonicalAction(loader, { command: 'rules' }).risk === 'blocked')
  ok('policy exec selalu blocked', Assistant.policyFor('exec', 'rm -rf /') === 'blocked')
  ok('policy broadcast selalu high', Assistant.policyFor('broadcast', 'halo') === 'high')
  ok('promoset status read, perubahan high', Assistant.policyFor('promoset', 'status') === 'read' && Assistant.policyFor('promoset', 'enable on') === 'high')
  ok('selfcheck cepat read, deep operasional', Assistant.policyFor('selfcheck', '') === 'read' && Assistant.policyFor('selfcheck', 'deep') === 'write')
  ok('memori butuh permintaan eksplisit owner', Assistant.explicitMemoryRequest('tolong ingat jadwal ini') && !Assistant.explicitMemoryRequest('jangan ingat data ini'))

  console.log('\n[C] MODE SAFE: COMMAND BACA OTOMATIS')
  const originalAsk = Ai.ask
  Ai.ask = async () => ({
    ok: true,
    text: JSON.stringify({
      reply: 'Aku cek runtime sekarang.',
      actions: [{ command: 'uptime', args: '', reason: 'mengecek proses bot' }],
      remember: [{ key: 'sapaan-owner', value: 'panggil Wang' }],
    }),
    model: 'fake', provider: 'fake', ms: 1,
  })
  Assistant.setOption(db, 'mode', 'safe')
  await Assistant.respond(m, 'cek runtime dan ingat panggil aku Wang')
  ok('alias dinormalisasi dan command baca dijalankan', calls.some((x) => x.command === 'runtime'))
  ok('output command diteruskan ke chat', /RUNTIME_OK/.test(texts(m)), texts(m))
  ok('remember dari planner tersimpan', Persona.memoryEntries(db).some((x) => x.key === 'sapaan-owner'))

  console.log('\n[D] TINDAKAN SENSITIF: APPROVAL + ANTI DOUBLE RUN')
  const beforeHigh = calls.filter((x) => x.command === 'broadcast').length
  Ai.ask = async () => ({
    ok: true,
    text: JSON.stringify({
      reply: 'Broadcast siap, aku minta izin dulu.',
      actions: [
        { command: 'bc', args: 'Pengumuman maintenance malam ini', reason: 'mengirim pengumuman' },
        { command: 'broadcast', args: 'Pengumuman maintenance malam ini', reason: 'duplikat dari model' },
      ],
      remember: [],
    }),
    ms: 1,
  })
  await Assistant.respond(m, 'broadcast pengumuman maintenance')
  const pending = Assistant.pendingList(db)
  ok('broadcast belum dijalankan sebelum approve', calls.filter((x) => x.command === 'broadcast').length === beforeHigh)
  ok('proposal approval tersimpan', pending.length === 1 && pending[0].command === 'broadcast')
  const id = pending[0].id
  await Assistant.approve(m, id)
  ok('approve menjalankan command tepat sekali', calls.filter((x) => x.command === 'broadcast').length === beforeHigh + 1)
  await Assistant.approve(m, id)
  ok('approve kedua tidak menjalankan ulang', calls.filter((x) => x.command === 'broadcast').length === beforeHigh + 1)

  console.log('\n[E] SUPERVISED / AUTONOMOUS / CHAT')
  Assistant.setOption(db, 'mode', 'supervised')
  Ai.ask = async () => ({ ok: true, text: '{"reply":"cek","actions":[{"command":"runtime","args":"","reason":"cek"}],"remember":[]}', ms: 1 })
  const beforeRuntime = calls.filter((x) => x.command === 'runtime').length
  await Assistant.respond(m, 'cek runtime')
  const supervised = Assistant.pendingList(db)
  ok('supervised menahan command baca', calls.filter((x) => x.command === 'runtime').length === beforeRuntime && supervised.length === 1)
  await Assistant.reject(m, supervised[0].id)
  ok('reject menghapus proposal', Assistant.pendingList(db).length === 0)

  Assistant.setOption(db, 'mode', 'autonomous')
  Ai.ask = async () => ({ ok: true, text: '{"reply":"cek","actions":[{"command":"checkmonitor","args":"","reason":"audit"}],"remember":[]}', ms: 1 })
  await Assistant.respond(m, 'jalankan monitor')
  ok('autonomous menjalankan operasi ringan', calls.some((x) => x.command === 'checkmonitor'))

  Assistant.setOption(db, 'mode', 'chat')
  const beforeChat = calls.length
  await Assistant.respond(m, 'cek runtime')
  ok('mode chat tidak menjalankan alat', calls.length === beforeChat)

  console.log('\n[F] OUTPUT MODEL TIDAK TERSTRUKTUR')
  Assistant.setOption(db, 'mode', 'safe')
  Ai.ask = async () => ({ ok: true, text: 'Ini jawaban biasa, bukan JSON.', ms: 1 })
  const beforePlain = calls.length
  await Assistant.respond(m, 'halo')
  ok('jawaban biasa tetap disampaikan', /Ini jawaban biasa/.test(texts(m)))
  ok('jawaban biasa tidak mendapat akses command', calls.length === beforePlain)
  Ai.ask = originalAsk

  console.log('\n[G] AUTO-CHAT HANYA OWNER PRIVATE')
  Assistant.setOption(db, 'autoChat', true)
  const auto = { ...m, isCmd: false, body: 'halo', fromMe: false }
  ok('owner private boleh auto-chat saat aktif', Assistant.shouldAutoChat(auto) === true)
  ok('user biasa tidak pernah auto-chat', Assistant.shouldAutoChat({ ...auto, isOwner: false }) === false)
  ok('grup tidak pernah auto-chat', Assistant.shouldAutoChat({ ...auto, isGroup: true }) === false)
  ok('pesan bot sendiri tidak diproses', Assistant.shouldAutoChat({ ...auto, fromMe: true }) === false)

  console.log('\n[H] SOURCE SCANNER')
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'wangbot-health-'))
  fs.mkdirSync(path.join(fixture, 'src'), { recursive: true })
  fs.writeFileSync(path.join(fixture, 'index.js'), "require('./src/missing')\n")
  fs.writeFileSync(path.join(fixture, 'src/good.js'), "const x = 1\nmodule.exports = x\n")
  fs.writeFileSync(path.join(fixture, 'src/loggerbug.js'), "function x () { logger.error('x') }\n")
  fs.writeFileSync(path.join(fixture, 'src/syntax.js'), 'module.exports = { broken: ) }\n')
  const scan = CodeHealth.scanSource(fixture)
  ok('scanner menemukan syntax rusak', scan.issues.some((x) => x.id.startsWith('syntax:')), JSON.stringify(scan.issues))
  ok('scanner menemukan require lokal hilang', scan.issues.some((x) => x.id.startsWith('require:')))
  ok('scanner menemukan logger tanpa import', scan.issues.some((x) => x.id.startsWith('undefined-logger:')))
  fs.rmSync(fixture, { recursive: true, force: true })

  const production = CodeHealth.scanSource(BOT)
  const prodErrors = production.issues.filter((x) => x.severity === 'error')
  ok('source production lolos syntax/require/light lint', prodErrors.length === 0, JSON.stringify(prodErrors.slice(0, 5)))

  const commandFixture = fs.mkdtempSync(path.join(os.tmpdir(), 'wangbot-command-health-'))
  fs.mkdirSync(path.join(commandFixture, 'src/commands/a'), { recursive: true })
  fs.writeFileSync(path.join(commandFixture, 'src/commands/a/one.js'), 'module.exports = {}\n')
  fs.writeFileSync(path.join(commandFixture, 'src/commands/a/two.js'), 'module.exports = {}\n')
  const commandScan = CodeHealth.scanCommands(commandFixture, {
    diagnostics: [],
    commands: [
      { name: 'one', aliases: ['same'], run: async () => {}, file: 'one.js', desc: 'one' },
      { name: 'two', aliases: ['same'], run: async () => {}, file: 'two.js', desc: 'two' },
    ],
  })
  ok('scanner menemukan alias command bentrok', commandScan.issues.some((x) => x.id.startsWith('command-dupe:')))
  fs.rmSync(commandFixture, { recursive: true, force: true })

  console.log('\n[I] GUARDIAN: TARGET + REDAKSI')
  ok('guardian melapor ke owner terdaftar', Guardian.ownerJids(db).includes(OWNER))
  ok('fingerprint runtime stabil untuk angka dinamis', Guardian.runtimeFingerprint('Error id 123456789') === Guardian.runtimeFingerprint('Error id 987654321'))
  ok('redaksi menyembunyikan API key', !CodeHealth.redact('api_key=sk-rahasia1234567890').includes('sk-rahasia'))
  const privateLog = Handler._logSafe({ command: 'asisten', args: 'tolong ingat data pelanggan penting' })
  ok('instruksi pribadi agent tidak masuk command log', !privateLog.includes('pelanggan') && /private/.test(privateLog))
  const rejectedSecretLog = Handler._logSafe({ command: 'agentset', args: 'remember api-key sk-rahasia123456' })
  ok('percobaan memori rahasia tidak masuk command log', !rejectedSecretLog.includes('sk-rahasia'))

  console.log('\n[J] LAPORAN PROAKTIF: BARU, DEDUP, PULIH')
  const originalHealthRun = CodeHealth.run
  const guardianState = Guardian.store(db)
  guardianState.lastRun = 0
  guardianState.lastReportAt = 0
  guardianState.lastFingerprint = ''
  guardianState.lastErrors = 0
  guardianState.lastWarnings = 0
  const baseReport = {
    at: Date.now(), durationMs: 2, deep: false,
    source: { files: 10 }, commands: { expected: 5, loaded: 5 },
    runtime: { rssMB: 50, heapMB: 20, dbBytes: 1000 }, tests: null,
  }
  CodeHealth.run = async () => ({
    ...baseReport,
    at: Date.now(), ok: false, errors: 1, warnings: 0, fingerprint: 'problem-a',
    issues: [{ id: 'syntax:x', severity: 'error', title: 'Syntax rusak', file: 'src/x.js', line: 3, detail: 'token salah' }],
  })
  const beforeReport = m.sent.length
  await Guardian.runCheck({ sock: m.sock, db, loader, notify: true })
  ok('masalah baru otomatis dikirim ke owner', m.sent.length === beforeReport + 1 && /PENJAGA KODE/.test(texts(m)))
  const afterFirstReport = m.sent.length
  await Guardian.runCheck({ sock: m.sock, db, loader, notify: true })
  ok('fingerprint sama tidak membuat spam laporan', m.sent.length === afterFirstReport)
  CodeHealth.run = async () => ({
    ...baseReport,
    at: Date.now(), ok: true, errors: 0, warnings: 0, fingerprint: 'healthy', issues: [],
  })
  await Guardian.runCheck({ sock: m.sock, db, loader, notify: true })
  ok('pemulihan otomatis dilaporkan', m.sent.length === afterFirstReport + 1 && /KEMBALI SEHAT/.test(texts(m)))
  CodeHealth.run = originalHealthRun

  db.save(true)
  try { fs.unlinkSync(process.env.DB_PATH) } catch (_) {}
  try { fs.unlinkSync(process.env.DB_PATH + '.bak') } catch (_) {}
  console.log(`\n===== PERSONAL AGENT: ${pass} lulus, ${fail} gagal =====`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
