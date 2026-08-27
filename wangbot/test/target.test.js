// Test: owner/admin menambahkan orang pakai NOMOR (bukan JID).
// Menjalankan command asli lewat src/handler.js + database sungguhan.
//
//   node test/target.test.js
const path = require('path')
const fs = require('fs')
const os = require('os')
const BOT = path.resolve(__dirname, '..')

process.env.OWNER_NUMBER = '6281234567890'
process.env.PREFIX = '.'
process.env.BROADCAST_DELAY = process.env.BROADCAST_DELAY || '0'
process.env.DB_PATH = path.join(os.tmpdir(), 'wangbot-target-db.json')
try {
  fs.unlinkSync(process.env.DB_PATH)
} catch (_) {}

const OWNER = '6281234567890@s.whatsapp.net'
const ADMIN = '628777000111@s.whatsapp.net'
const MEMBER = '628555123456@s.whatsapp.net'
const GROUP = '120363000000000000@g.us'

let pass = 0
let fail = 0
const ok = (n, c, x = '') => (c ? (pass++, console.log(`  ✅ ${n}`)) : (fail++, console.log(`  ❌ ${n} ${x}`)))

function makeSock(sender) {
  const sock = {
    sent: [],
    updates: [],
    user: { id: OWNER.replace('@', ':9@'), name: 'WangBot' },
    store: { groupMetadata: new Map(), messages: new Map() },
    sendMessage: async (jid, content, opts) => {
      sock.sent.push({ jid, content, opts })
      return { key: { id: 'T' + sock.sent.length } }
    },
    groupMetadata: async (jid) => ({
      id: jid,
      subject: 'Grup Uji Nomor',
      participants: [
        { id: OWNER, jid: OWNER, admin: 'superadmin' },
        { id: ADMIN, jid: ADMIN, admin: 'admin' },
        { id: MEMBER, jid: MEMBER, admin: null },
      ],
    }),
    groupParticipantsUpdate: async (jid, jids, action) => {
      sock.updates.push({ jid, jids, action })
      return jids.map((j) => ({ jid, status: '200' }))
    },
    groupInviteCode: async () => 'KODEGRUP',
    sendPresenceUpdate: async () => ({}),
    presenceSubscribe: async () => ({}),
  }
  return sock
}

function rawMsg(text, opts = {}) {
  const inGroup = opts.group !== false
  return {
    key: {
      remoteJid: inGroup ? GROUP : opts.sender || OWNER,
      fromMe: false,
      participant: inGroup ? opts.sender || OWNER : undefined,
      id: 'T' + Math.random().toString(36).slice(2, 8).toUpperCase(),
    },
    message: { conversation: text },
    pushName: 'Tester',
    messageTimestamp: Math.floor(Date.now() / 1000),
  }
}

function textOf(content) {
  if (!content) return ''
  if (typeof content === 'string') return content
  if (content.text) return content.text
  return ''
}

async function send(handle, db, loader, text, opts = {}) {
  const sock = makeSock(opts.sender)
  await handle(sock, db, loader, rawMsg(text, opts))
  return { sock, reply: sock.sent.map((s) => textOf(s.content)).filter(Boolean).join(' | ') }
}

async function main() {
  const { Database } = require(path.join(BOT, 'src/database'))
  const db = new Database(process.env.DB_PATH)
  require(path.join(BOT, 'src/database')).Database.instance = db
  const func = require(path.join(BOT, 'src/lib/func'))
  const { loadCommands } = require(path.join(BOT, 'src/commands'))
  const { handle } = require(path.join(BOT, 'src/handler'))
  const loader = loadCommands()

  // ---------------------------------------------------------------- [A]
  console.log('\n[A] HELPER: normalisasi nomor -> JID')
  const cases = [
    ['081234567890', '6281234567890@s.whatsapp.net'],
    ['+62 812-3456-7890', '6281234567890@s.whatsapp.net'],
    ['62 812 3456 7890', '6281234567890@s.whatsapp.net'],
    ['6281234567890', '6281234567890@s.whatsapp.net'],
    ['6281234567890@s.whatsapp.net', '6281234567890@s.whatsapp.net'],
    ['wa.me/6281234567890', '6281234567890@s.whatsapp.net'],
    ['@6281234567890', '6281234567890@s.whatsapp.net'],
    ['123456789012345@lid', '123456789012345@lid'],
    ['123456789-111@g.us', ''],
    ['halo', ''],
    ['5', ''],
    ['', ''],
  ]
  for (const [input, want] of cases) {
    const got = func.jidFromInput(input)
    ok(`jidFromInput(${JSON.stringify(input)})`, got === want, `-> ${JSON.stringify(got)} (ingin ${JSON.stringify(want)})`)
  }
  ok('num() menampilkan nomor, bukan JID', func.num('6281234567890@s.whatsapp.net') === '6281234567890')
  ok('targets() bisa banyak nomor sekaligus', JSON.stringify(func.targets({ args: '081234567890, 0813-1111-2222', mentionedJid: [], quoted: null })) ===
    JSON.stringify(['6281234567890@s.whatsapp.net', '6281311112222@s.whatsapp.net']))
  ok('targets(firstOnly) berhenti di nomor pertama', JSON.stringify(func.targets({ args: '081234567890 spam 5 kali', mentionedJid: [], quoted: null }, undefined, { firstOnly: true })) ===
    JSON.stringify(['6281234567890@s.whatsapp.net']))
  ok('targets() tidak salah baca angka pendek di alasan', func.targets({ args: 'order 12345 gagal', mentionedJid: [], quoted: null }).length === 0)
  ok('nomor ber-spasi "+62 811-9999-8888" dibaca satu nomor', JSON.stringify(func.targets({ args: '+62 811-9999-8888', mentionedJid: [], quoted: null })) ===
    JSON.stringify(['6281199998888@s.whatsapp.net']),
    `-> ${JSON.stringify(func.targets({ args: '+62 811-9999-8888', mentionedJid: [], quoted: null }))}`)
  ok('nomor ber-spasi "0812 3456 7890" dibaca satu nomor', JSON.stringify(func.targets({ args: '0812 3456 7890', mentionedJid: [], quoted: null })) ===
    JSON.stringify(['6281234567890@s.whatsapp.net']))
  ok('dua nomor berurutan tetap jadi dua target', JSON.stringify(func.targets({ args: '08555123456 081311112222', mentionedJid: [], quoted: null })) ===
    JSON.stringify(['628555123456@s.whatsapp.net', '6281311112222@s.whatsapp.net']))

  // ---------------------------------------------------------------- [B]
  console.log('\n[B] .addowner pakai nomor')
  let r = await send(handle, db, loader, '.addowner 081311112222', { sender: OWNER, group: false })
  ok('nomor 0813.. disimpan sebagai 62813..', db.data.owners.includes('6281311112222@s.whatsapp.net'), `-> ${JSON.stringify(db.data.owners)}`)
  ok('balasan menampilkan nomor', /6281311112222/.test(r.reply), `-> ${r.reply}`)
  ok('balasan TIDAK menampilkan JID', !r.reply.includes('@s.whatsapp.net'), `-> ${r.reply}`)

  r = await send(handle, db, loader, '.addowner +62 811-9999-8888', { sender: OWNER, group: false })
  ok('format "+62 811-9999-8888" diterima', db.data.owners.includes('6281199998888@s.whatsapp.net'), `-> ${JSON.stringify(db.data.owners)}`)

  r = await send(handle, db, loader, '.addowner 628123450000@s.whatsapp.net', { sender: OWNER, group: false })
  ok('JID penuh masih diterima (kompatibilitas lama)', db.data.owners.includes('628123450000@s.whatsapp.net'), `-> ${JSON.stringify(db.data.owners)}`)

  const beforeBad = db.data.owners.length
  r = await send(handle, db, loader, '.addowner bukan-nomor', { sender: OWNER, group: false })
  ok('input bukan nomor ditolak, bukan disimpan asal', /bukan nomor yang bisa dipakai/.test(r.reply) && db.data.owners.length === beforeBad, `-> ${r.reply}`)

  r = await send(handle, db, loader, '.addowner', { sender: OWNER, group: false })
  ok('tanpa argumen -> pakai nomor sendiri', /6281234567890/.test(r.reply), `-> ${r.reply}`)

  r = await send(handle, db, loader, '.addowner 089990001111', { sender: MEMBER })
  ok('non-owner tetap ditolak menambah owner', /khusus \*Owner\*/.test(r.reply) && !db.data.owners.includes('6289990001111@s.whatsapp.net'), `-> ${r.reply}`)

  // ---------------------------------------------------------------- [C]
  console.log('\n[C] .delowner pakai nomor')
  r = await send(handle, db, loader, '.delowner 081311112222', { sender: OWNER, group: false })
  ok('nomor 0813.. dihapus', !db.data.owners.includes('6281311112222@s.whatsapp.net'), `-> ${JSON.stringify(db.data.owners)}`)
  ok('balasan delowner pakai nomor', /6281311112222/.test(r.reply) && !r.reply.includes('@s.whatsapp.net'), `-> ${r.reply}`)

  r = await send(handle, db, loader, '.delowner 081234567890', { sender: OWNER, group: false })
  ok('owner dari .env tidak bisa dihapus lewat command', /owner dari \.env/.test(r.reply), `-> ${r.reply}`)

  r = await send(handle, db, loader, '.delowner', { sender: OWNER, group: false })
  ok('.delowner tanpa nomor -> contoh pemakaian', /Contoh: \.delowner 081234567890/.test(r.reply), `-> ${r.reply}`)

  // ---------------------------------------------------------------- [D]
  console.log('\n[D] .blacklist / .whitelist pakai nomor')
  r = await send(handle, db, loader, '.blacklist add user 08555123456', { sender: OWNER, group: false })
  ok('blacklist menyimpan JID ternormalisasi', db.data.blacklist.users.includes(MEMBER), `-> ${JSON.stringify(db.data.blacklist.users)}`)
  ok('balasan blacklist pakai nomor', /628555123456 diblacklist/.test(r.reply), `-> ${r.reply}`)

  r = await send(handle, db, loader, '.blacklist list', { sender: OWNER, group: false })
  ok('daftar blacklist tampil sebagai nomor', /@628555123456/.test(r.reply) && !r.reply.includes('@s.whatsapp.net'), `-> ${r.reply}`)

  r = await send(handle, db, loader, '.blacklist del user 08555123456', { sender: OWNER, group: false })
  ok('blacklist del pakai nomor', !db.data.blacklist.users.includes(MEMBER), `-> ${JSON.stringify(db.data.blacklist.users)}`)

  r = await send(handle, db, loader, '.whitelist add member 08555123456', { sender: ADMIN })
  const g = db.getGroup(GROUP)
  ok('whitelist member menyimpan JID ternormalisasi', g.wlMembers.includes(MEMBER), `-> ${JSON.stringify(g.wlMembers)}`)
  ok('balasan whitelist pakai nomor', /@628555123456 di-whitelist/.test(r.reply), `-> ${r.reply}`)

  r = await send(handle, db, loader, '.whitelist del member 08555123456', { sender: ADMIN })
  ok('whitelist del pakai nomor', !g.wlMembers.includes(MEMBER), `-> ${JSON.stringify(g.wlMembers)}`)

  // ---------------------------------------------------------------- [E]
  console.log('\n[E] .warn / .delwarn pakai nomor')
  r = await send(handle, db, loader, '.warn 08555123456 spam link promo', { sender: ADMIN })
  ok('warning tersimpan di key ternormalisasi', !!db.data.warnings[GROUP + ':' + MEMBER], `-> ${JSON.stringify(Object.keys(db.data.warnings))}`)
  ok('alasan tidak ikut menelan nomor', /Alasan: spam link promo/.test(r.reply), `-> ${r.reply}`)

  r = await send(handle, db, loader, '.warn 08555123456', { sender: ADMIN })
  ok('warn tanpa alasan tetap jalan', /Alasan: Pelanggaran/.test(r.reply), `-> ${r.reply}`)

  r = await send(handle, db, loader, '.delwarn 08555123456', { sender: ADMIN })
  ok('delwarn pakai nomor mereset peringatan', !db.data.warnings[GROUP + ':' + MEMBER], `-> ${JSON.stringify(Object.keys(db.data.warnings))}`)

  r = await send(handle, db, loader, '.warn 081234567890 coba', { sender: ADMIN })
  ok('owner tetap tidak bisa di-warn lewat nomor', /Tidak bisa warn admin\/owner/.test(r.reply), `-> ${r.reply}`)

  // ---------------------------------------------------------------- [F]
  console.log('\n[F] .kick / .promote / .demote / .add pakai nomor')
  r = await send(handle, db, loader, '.kick 08555123456', { sender: ADMIN })
  const kick = r.sock.updates.find((u) => u.action === 'remove')
  ok('.kick memanggil WhatsApp dengan JID ternormalisasi', kick && kick.jids[0] === MEMBER, `-> ${JSON.stringify(r.sock.updates)}`)
  ok('balasan .kick pakai nomor', /628555123456/.test(r.reply), `-> ${r.reply}`)

  r = await send(handle, db, loader, '.promote 08555123456', { sender: ADMIN })
  ok('.promote pakai nomor', r.sock.updates.some((u) => u.action === 'promote' && u.jids[0] === MEMBER), `-> ${JSON.stringify(r.sock.updates)}`)

  r = await send(handle, db, loader, '.demote 08555123456', { sender: ADMIN })
  ok('.demote pakai nomor', r.sock.updates.some((u) => u.action === 'demote' && u.jids[0] === MEMBER), `-> ${JSON.stringify(r.sock.updates)}`)

  r = await send(handle, db, loader, '.kick 08555123456 081311112222', { sender: ADMIN })
  const kick2 = r.sock.updates.filter((u) => u.action === 'remove')
  ok('.kick bisa lebih dari satu nomor', kick2.length === 1 && kick2[0].jids.length === 2, `-> ${JSON.stringify(r.sock.updates)}`)

  r = await send(handle, db, loader, '.add 08123450000', { sender: ADMIN })
  ok('.add member pakai nomor 0812..', r.sock.updates.some((u) => u.action === 'add' && u.jids[0] === '628123450000@s.whatsapp.net'), `-> ${JSON.stringify(r.sock.updates)}`)
  ok('balasan .add pakai nomor', /628123450000/.test(r.reply), `-> ${r.reply}`)

  r = await send(handle, db, loader, '.kick', { sender: ADMIN })
  ok('.kick tanpa target -> contoh pemakaian', /Contoh: \.kick 081234567890/.test(r.reply), `-> ${r.reply}`)

  // ---------------------------------------------------------------- [G]
  console.log('\n[G] .mcadmin add pakai nomor pelanggan')
  r = await send(handle, db, loader, '.mcadmin add 081234567890 Survival play.wangstore.id 25565', { sender: OWNER, group: false })
  const Mc = require(path.join(BOT, 'src/lib/mc'))
  ok('server manual terdaftar untuk JID ternormalisasi', Mc.allServers(db).some((s) => s.ownerJid === OWNER && s.name === 'Survival'),
    `-> ${JSON.stringify(Mc.allServers(db).map((s) => s.ownerJid))}`)
  ok('entri pelanggan memakai JID ternormalisasi', !!db.data.minecraft.entries[OWNER], `-> ${JSON.stringify(Object.keys(db.data.minecraft.entries))}`)
  ok('balasan mcadmin pakai nomor', /6281234567890/.test(r.reply), `-> ${r.reply}`)

  r = await send(handle, db, loader, '.mcadmin add bukan-nomor X host 25565', { sender: OWNER, group: false })
  ok('mcadmin menolak input bukan nomor', /bukan nomor yang bisa dipakai/.test(r.reply), `-> ${r.reply}`)

  // ---------------------------------------------------------------- [H]
  console.log('\n[H] .id menampilkan nomor')
  r = await send(handle, db, loader, '.id', { sender: MEMBER, group: false })
  ok('.id menampilkan nomor peminta', /Nomor kamu\s*: 628555123456/.test(r.reply), `-> ${r.reply.split('\n').slice(0, 4).join(' / ')}`)
  ok('.id tidak menampilkan JID untuk nomor biasa', !r.reply.includes('@s.whatsapp.net'), `-> ${r.reply.slice(0, 200)}`)

  console.log(`\n===== HASIL: ${pass} lulus, ${fail} gagal =====`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error('\nFATAL:', e)
  process.exit(1)
})
