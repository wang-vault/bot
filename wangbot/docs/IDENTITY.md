# 🪪 Identitas: nomor WhatsApp, bukan LID

Sejak beberapa waktu WhatsApp mengalamatkan sebagian chat dengan **LID**
(*Linked ID* — identitas anonim, contoh `123456789012345@lid`):

* grup yang memakai fitur **"sembunyikan nomor"**, dan
* **chat pribadi** akun yang nomornya belum dibagikan ke kontak.

Masalahnya: LID **bukan nomor telepon**. Angkanya bukan nomor yang bisa dibuka
lewat `wa.me`, bukan yang diketik owner/admin, dan bukan yang cocok dengan
`OWNER_NUMBER`. Kalau bot menyimpan LID sebagai identitas:

* owner tidak dikenali lagi ketika nomor datanya berubah bentuk,
* alert/monitoring gagal terkirim (DM ke LID tidak andal),
* data pelanggan Minecraft terbelah dua (satu entri `@lid`, satu entri nomor).

Karena itu **WangBot memakai nomor WhatsApp sebagai identitas di semua tempat**,
dan memakai LID hanya sebagai *kunci pencarian* nomor. Modulnya:
`src/lib/identity.js`.

---

## 1. Aturan singkat

| Hal | Bentuk yang dipakai bot |
|---|---|
| Owner (`.env` / `.addowner`) | `6281234567890` (nomor) |
| Pelanggan MC (`mc.entries`, `mc.servers[].ownerJid`) | nomor |
| Staf `.pingl`, pengguna, blacklist, AFK | nomor |
| Admin grup (untuk DM) | nomor (fallback: JID apa adanya) |
| JID grup | tetap `xxx@g.us` (grup tidak punya nomor) |

Angka LID **tidak pernah** dianggap nomor. Jadi tidak ada lagi orang yang
"kebetulan lolos" jadi owner hanya karena angka LID-nya mirip nomor owner.

---

## 2. Bagaimana LID diubah jadi nomor

`Identity.resolve()` mencoba sumber berikut, berurutan:

1. **atribut stanza pesan** — WhatsApp menitipkan `participant_pn` / `sender_pn`
   (Baileys: `key.participantPn`, `key.senderPn`). Ini yang paling akurat dan
   bekerja juga di chat pribadi.
2. **metadata grup** — Baileys menaruh pasangannya berdampingan:
   `participant.jid` (nomor) dan `participant.lid` (LID).
3. **`OWNER_LID_MAP` di `.env`** — pasangan yang dinyatakan admin.
4. **pemetaan yang sudah dipelajari bot** (`db.identity.lidToPn`).
5. **identitas bot sendiri** dari auth creds (`sock.user.id` + `sock.user.lid`).
6. `sock.signalRepository.lidMapping.getPNForLID()` — hanya ada di Baileys baru
   (v7); kalau tidak ada, langkah ini dilewati tanpa error.

Hasilnya disimpan (`Identity.learn`) sehingga tidak perlu ditebak ulang, dan
bertahan setelah bot restart. Kalau **semua** sumber gagal, JID dibiarkan
`@lid` (bot tetap jalan) dan dicatat di `db.identity.pending` supaya owner
mendapat laporan — bukan dikarang nomornya.

---

## 3. Migrasi otomatis data lama

Begitu sebuah LID berhasil dipetakan, `Identity.learn()` memindahkan data yang
terlanjur tersimpan dengan kunci LID ke kunci nomor:

* `owners` (array), `users`, `afk`, `blacklist.users`, `pingl.staff`,
  `minecraft.entries`, `minecraft.servers[].ownerJid`/`addedBy`,
  `assistant.pending[].requestedBy`, `groupAccess.requests`.

Selain itu, setiap kali bot menyala `index.js` memanggil
`Identity.canonicalizeOwners(db)` yang merapikan `db.owners` (LID → nomor,
duplikat dibuang) dan menulis peringatan ke log bila masih ada entri LID yang
nomornya belum diketahui.

---

## 4. Kalau owner tidak dikenali

1. Jalankan **`.id`** di chat bot. Balasannya menampilkan:
   * `Nomor kamu` — nomor yang dipakai bot untukmu,
   * `LID kamu` + status pemetaannya (kalau pesanmu datang sebagai LID),
   * daftar owner dalam bentuk nomor,
   * daftar owner berbentuk LID yang belum punya nomor (kalau ada).
2. Kalau statusnya *belum diketahui*:
   * kirim satu pesan di **grup** yang ada botnya (metadata grup memuat pasangan
     LID → nomor), lalu cek `.id` lagi; atau
   * `.addowner 081234567890` (nomor aslinya); atau
   * admin server mengisi di `.env` lalu restart:

     ```env
     OWNER_LID_MAP=123456789012345@lid:6281234567890
     ```

3. `.addowner` juga **menolak** menyimpan LID sebagai owner: bot akan meminta
   nomornya lebih dulu.

---

## 5. Konfigurasi `.env` terkait

| Variabel | Arti |
|---|---|
| `OWNER_NUMBER` | Daftar owner — **nomor** (boleh lebih dari satu, pisah koma). Entri `@lid` juga diterima tapi dianggap bentuk darurat. |
| `OWNER_LID` | LID owner yang dinyatakan eksplisit (opsional, pisah koma). |
| `OWNER_LID_MAP` | Pasangan `LID:nomor`, mis. `123456789012345@lid:6281234567890`. |
| `COUNTRY_CODE` | Kode negara untuk normalisasi nomor lokal (`0` di depan). Default `62`. |

---

## 6. Untuk pengembang

```js
const Identity = require('./src/lib/identity')

Identity.bare(jid)             // buang sufiks device: '62812:9@s.whatsapp.net'
Identity.num(jid)              // angka untuk ditampilkan ke user
Identity.isLid(jid) / isPn(jid)

Identity.resolve(jid, { db, key, participants, sock })   // @lid -> nomor (sinkron)
await Identity.resolveAsync(jid, ctx)                    // + signalRepository
Identity.learn(db, lid, pn)    // simpan pemetaan (sekaligus migrasi data lama)
Identity.pnFor(db, lid)        // pemetaan yang sudah diketahui

Identity.ownerEntries(db)      // { pn: [...], lids: [...], unresolved: [...] }
Identity.ownerJids(db)         // nomor owner saja (untuk DM/notifikasi)
Identity.isOwnerJid(jid, db)   // cek owner (nomor, nomor mentah, atau LID)
Identity.canonicalizeOwners(db) // rapikan db.owners saat boot
```

Helper command yang dipakai command:

```js
m.func.pnTargets(m)      // target (argumen/tag/reply) yang WAJIB nomor
m.func.pnTarget(m)       // satu target nomor ('' kalau belum diketahui)
m.func.jidToPn(m, jid)   // konversi satu JID ke nomor
m.func.ownerJids(db)     // daftar nomor owner
```

Tesnya: `npm run test:identity` (69 assertion) — termasuk regresi "angka LID
tidak boleh ditebak sebagai nomor owner".
