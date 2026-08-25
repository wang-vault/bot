# 🔍 Audit Bug & Fungsi — WangBot

Tanggal audit : 2026-08-25
Scope         : seluruh kode di zip `wangbot (7).zip` (121 file, 82 command)
Cara verifikasi: **dijalankan sungguhan**, bukan dibaca saja.

## Cara audit dilakukan

| Langkah | Perintah | Hasil |
|---|---|---|
| Cek sintaks semua file | `node --check` pada 93 file `.js` | 0 error sintaks |
| Install dependency | `npm install` | ⚠️ gagal di `sharp` nested (lihat **[D1]**) |
| Jalankan **semua** command lewat handler asli | `npm run test:dryrun` | 82 command, **0 error**, semua membalas kecuali `.exec` (async, by design) |
| Uji logika inti (24 assertion) | `npm test` | **24/24 lulus** setelah perbaikan (sebelumnya 15/24) |
| Uji monitoring | `test/fake-panel.js` (API Pterodactyl tiruan, 2 node) | output dibandingkan angka mentah |
| Uji media | `sharp` asli → `textToImage`, `memeImage`, `makeSticker` | PNG 512×512 → stiker WebP (magic `RIFF`) OK |
| Uji celah keamanan | skrip PoC user asing → `.addowner` → `.exec` | **terbukti RCE**, kini tertutup |

Yang **tidak** bisa diverifikasi di sini: koneksi WhatsApp sungguhan (butuh scan QR), panel Pterodactyl asli
(dipakai API tiruan dengan bentuk respons sesuai dokumentasi resmi: memory/disk node & server dalam **MB**
[docs](https://docs.pteroca.com/advanced-topics/scaling-infrastructure)), dan build `sharp` di VPS Anda.

---

## 🔴 P0 — Celah keamanan (KRITIS, sudah diperbaiki)

### 1. `.addowner` tidak punya proteksi → siapa pun bisa ambil alih bot lalu jalankan shell
`src/commands/owner/addowner.js` sengaja dimatikan flag `isOwner`-nya (ada komentar
*"VERSI SELF-CONTAINED (tanpa proteksi isOwner)"*). Akibatnya **user biasa** yang mengetik `.addowner`
langsung jadi owner, lalu punya akses `.eval` dan `.exec`.

Bukti eksekusi (sebelum perbaikan), user asing `628777000111`:

```
> .addowner          → ✅ 628777000111@s.whatsapp.net sekarang jadi *OWNER*.
> .exec echo PWNED-$(id -un)
                     → ```PWNED-user```          ← perintah shell benar-benar dieksekusi di server
> .eval 6*7          → ```42```
```

**Perbaikan** (`addowner.js:34`): proteksi owner dikembalikan di dalam `run()`
(`if (hasOwner && !m.isOwner) return ...`). Jalan *bootstrap* tetap ada: kalau bot **belum** punya owner
sama sekali (`OWNER_NUMBER` kosong & `db.owners` kosong), klaim pertama masih diizinkan supaya bot tetap
bisa di-setup. Setelah fix, PoC yang sama hanya dibalas `⛔ Command khusus *Owner*.` dan `db.owners` tetap `[]`.

---

## 🟠 P1 — Fungsi yang benar-benar rusak (sudah diperbaiki)

### 2. Anti Flood tidak pernah jalan kalau Anti Spam OFF
`src/lib/moderation.js` — pencatatan pesan hanya dilakukan di blok **Anti Spam**. Blok **Anti Flood**
hanya membaca daftar itu. Jadi dengan `antispam=OFF, antiflood=ON`, daftar pesan selalu kosong
→ flood tidak pernah terdeteksi.

Bukti: 12 pesan beruntun, `floodLimit=5` → **0 pesan dihapus** (seharusnya dihapus).
**Perbaikan** (`moderation.js:113`): pesan dicatat sekali di awal (hanya bila salah satu fitur aktif),
lalu dipakai kedua pemeriksaan. Setelah fix: pesan ke-5 dst. dihapus. ✅

### 3. Alert RAM/CPU/Disk monitoring tidak pernah terkirim
`src/lib/monitor.js` memakai `prev.ramPct < config.alertRam` sebagai syarat. Pada tick pertama
`prev` = `{}`, dan `undefined < 90` bernilai **false** → node yang sudah kritis sejak awal tidak pernah
alert. Pada tick berikutnya `prev.ramPct` sudah 95 → `95 >= 90 && 95 < 90` juga false → **alert tidak
pernah muncul sama sekali** kecuali angkanya sempat turun dulu.

Bukti (node uji RAM 95%, CPU 94%, Disk 97%, threshold 90): tick-1 dan tick-2 tidak ada alert resource.
**Perbaikan** (`monitor.js:28`, fungsi `crossed()`): alert dikirim saat pertama kali terlihat di atas
threshold (`prev == null`) **atau** saat naik melewati batas. Setelah fix: `⚠️ Alert RAM Tinggi 95%`,
`CPU 94%`, `Disk 97%` muncul di tick-1 dan tidak diulang di tick-2. ✅

### 4. Node yang maintenance dilaporkan "Offline" (alert ganda & menyesatkan)
`panel.js` menurunkan `online` dari `!maintenance_mode`, lalu `monitor.js` mengirim **dua** alert untuk
node yang sama: `🔴 ALERT: Node Offline` **dan** `🛠️ Maintenance Mode`.
**Perbaikan**: alert offline dilewati bila node sedang maintenance; ditambah alert
`✅ Maintenance Selesai` saat maintenance berakhir. ✅

### 5. Angka RAM & Disk di monitoring salah satuan
`src/lib/panel.js` membagi nilai Pterodactyl dengan 1024 **dua kali**, padahal `allocated_resources.memory/disk`
dan limit node sudah dalam **MB**. Ada juga baris mati `Math.round(a.memory * (a.memory_overallocate >= 0 ? 1 : 1))`
(kedua cabang bernilai 1).

Bukti (node uji: 32 GB RAM / 500 GB disk, terpakai 16 GB / 200 GB):

| Command | Sebelum | Sesudah |
|---|---|---|
| `.nodespec` | `RAM Limit: 32 MB` / `Disk: 500 MB` | `RAM Limit: 32 GB` / `Disk: 500 GB` / `Terpakai: RAM 16 GB, Disk 200 GB` |
| `.servers`  | `Total RAM : 0 MB` / `Total Disk : 1 MB` | `RAM terpakai: 76.5 GB / 96 GB` / `Disk terpakai: 1.14 TB / 1.46 TB` |

**Perbaikan** (`panel.js:20` helper `humanMB()`, field numerik `ramMB/diskMB/cpuAlloc`),
`spec.js:28` dan `servers.js:21` ikut disesuaikan. ✅

### 6. Promosi otomatis tetap jalan tiap 30 menit walau interval di-OFF-kan
`src/lib/marketing.js` — `Math.max(MIN_INTERVAL, mk.intervalMinutes || 0)` membuat interval **selalu** ≥ 30 menit,
termasuk saat owner mengisi `interval 0` (OFF) dan hanya memakai `schedule` harian.

Bukti: `interval=0`, `schedule=23:59`, `lastSent` 45 menit lalu → scheduler **tetap mengirim**.
**Perbaikan** (`marketing.js:86`): `interval 0 = OFF`; batas minimum 30 menit hanya berlaku bila interval > 0.
Body scheduler juga diekstrak jadi `Marketing.tick()` supaya bisa diuji. Setelah fix: 4 skenario scheduler lulus. ✅

### 7. Broadcast tidak pernah menjangkau grup sisanya
`src/commands/broadcast/broadcast.js` selalu memotong `targets.slice(0, batch)` (default 20) dan pesannya
menyuruh *"Ulangi command untuk lanjut"* — tapi mengulang hanya mengirim ulang ke **20 grup pertama yang sama**.

Bukti: 25 grup, 2× `.broadcast` → grup baru di percobaan ke-2: **0**.
**Perbaikan** (`broadcast.js:41,47`): target diurutkan stabil + kursor `db.data.broadcastCursor`
disimpan, jadi broadcast berikutnya menyambung ke grup sisanya. Setelah fix: percobaan ke-2 menjangkau grup baru. ✅

### 8. `BROADCAST_DELAY=0` diabaikan (ketemu dari timing test)
`(m.config.broadcastDelay || 5) * 1000` → nilai `0` dianggap "tidak diisi" dan jatuh ke 5 detik.
Test broadcast yang seharusnya <1 detik memakan **220 detik**.
**Perbaikan** (`broadcast.js:41`): pakai perbandingan eksplisit (`>= 0`), bukan `||`. Test suite turun 220s → 0.1s. ✅

---

## 🟡 P2 — Bug kecil / ambiguitas (sudah diperbaiki)

| # | File | Masalah | Perbaikan |
|---|---|---|---|
| 9 | `admin/promote.js:3` | Alias `.admin` dipakai 2 command (`promote` & `owner`). Yang menang `owner`, jadi `.admin @user` tidak pernah mempromosikan siapa pun | alias `promote` → `prom`, `naikinadmin` |
| 10 | `admin/link.js:3` | `.linkgc` dipakai 2 command (`admin/link` & `info/linkgc`) → link invite grup tak pernah keluar lewat `.linkgc` | alias `admin/link` → `linkgrup`, `invitelink`, `linkinvite` |
| 11 | `monitoring/ping.js:18` | Alias `ping` bentrok dengan command `.ping` (utility) → alias mati | alias → `pingserver`, `latency` |
| 12 | `monitoring/resources.js` | Alias `resource` menduplikasi nama command-nya sendiri | alias → `res`, `resources` |
| 13 | `cs/jamop.js:18` | Jam operasional lewat tengah malam (mis. `22:00-06:00`) selalu terbaca TUTUP | deteksi rentang melingkar |
| 14 | `lib/func.js:107` | Regex anti-virtex menulis `jar` dua kali | dirapikan + `scr`, `msi` |
| 15 | `cs/feedback.js:20`, `cs/laporan.js:19` | Notifikasi hanya ke `owners[0]`; owner lain tak pernah dapat | kirim ke semua owner (dedup) |
| 16 | `owner/exec.js:20`, `owner/gitpull.js` | `m.reply()` di dalam callback `exec` tidak di-catch → bisa jadi *unhandled rejection* | `.catch(logger.error)` |
| 17 | `cs/listfeedback.js`, `cs/listlaporan.js` | Nomor urut mulai lagi dari 1 pada potongan 20 data terakhir | offset mengikuti index asli |
| 18 | `lib/monitor.js` | `setTimeout` tick pertama tidak pernah dibatalkan → saat reconnect <10 detik, tick jalan dengan `sock` lama | disimpan & dibersihkan di `stop()` |

Verifikasi: `node test/dryrun.js` (alias) → **tidak ada alias mati / nama duplikat**, 82 command.

---

## 🔵 Catatan yang **tidak** saya ubah (butuh keputusan Anda)

| # | Temuan | Kenapa tidak diubah |
|---|---|---|
| **D1** | `npm install` **gagal** di lingkungan ini: `wa-sticker-formatter@4.4.4` menarik `sharp@^0.30` yang mengunduh libvips dari GitHub (`Client network socket disconnected`). Saya pasang dengan `npm install --ignore-scripts` lalu hapus `sharp` nested agar memakai `sharp@0.33` di root — stiker tetap jadi (teruji). | Mengubah dependency tree berisiko. Kalau VPS Anda memang gagal install, tambahkan `"overrides": { "sharp": "^0.33.5" }` di `package.json`. |
| **D2** | `.eval` / `.exec` tetap ada (RCE by design untuk owner) | Fitur resmi bot; sudah aman setelah P0 ditutup. Pertimbangkan menambah `BOT_PASSWORD` sebagai lapisan kedua. |
| **D3** | `.restore` memakai `_deepMerge`, bukan mengganti DB | Key yang tidak ada di file backup tetap dipertahankan. Kalau memang mau "ganti total", itu perubahan perilaku. |
| **D4** | Alert monitoring hanya dikirim ke `owners[0]` (`lib/monitor.js` `notifyTarget`) | Sama seperti P2-15, tapi ini menyangkut target alert; lebih baik diputuskan Anda (atau pakai `MONITOR_NOTIFY`). |
| **D5** | Status AFK & game `tebakangka` bersifat global/in-memory | Hilang saat restart; AFK tidak per-grup. Perubahan desain. |
| **D6** | `panel.js` tidak punya status node asli (Pterodactyl Application API tidak menyediakannya) — `online` tetap diturunkan dari `maintenance_mode` | Sudah tidak lagi memicu alert ganda (#4), tapi label 🟢/🔴 di `.nodespec` tetap aproksimasi. |

---

## ✅ Cara menjalankan ulang pemeriksaan

```bash
cd wangbot
npm install                 # (lihat D1 bila gagal di sharp)
npm test                    # 21 assertion (24 bila FAKE_PANEL diisi) — logika inti
npm run test:dryrun         # jalankan 82 command lewat handler asli, lapor error/balasan
npm run fake:panel          # API Pterodactyl tiruan di :8791 untuk uji monitoring
FAKE_PANEL=http://127.0.0.1:8791 FAKE_WEBSITE=http://127.0.0.1:8791 npm test
```

Terakhir dijalankan: `npm test` → **24/24 lulus** (1,6 detik), `npm run test:dryrun` → **82 command, 0 error**.

## 📝 Daftar file yang diubah

```
src/commands/owner/addowner.js         (P0 keamanan)
src/lib/moderation.js                  (#2 anti flood)
src/lib/monitor.js                     (#3 #4 #18 alert monitoring)
src/lib/panel.js                       (#5 satuan MB + humanMB)
src/commands/monitoring/spec.js        (#5)
src/commands/monitoring/servers.js     (#5)
src/lib/marketing.js                   (#6 scheduler)
src/commands/broadcast/broadcast.js    (#7 #8 kursor + delay)
src/commands/admin/promote.js          (#9)
src/commands/admin/link.js             (#10)
src/commands/monitoring/ping.js        (#11)
src/commands/monitoring/resources.js   (#12)
src/commands/cs/jamop.js               (#13)
src/lib/func.js                        (#14)
src/commands/cs/feedback.js            (#15)
src/commands/cs/laporan.js             (#15)
src/commands/cs/listfeedback.js        (#17)
src/commands/cs/listlaporan.js         (#17)
src/commands/owner/exec.js             (#16)
src/commands/owner/gitpull.js          (#16)
package.json                           (script test)
test/core.test.js, test/dryrun.js, test/fake-panel.js   (baru)
```
