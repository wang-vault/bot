# 🧭 Personal Agent — Kepribadian, Otonomi, dan Penjaga Kode

Personal Agent membuat WangBot lebih dari command bot yang diberi fitur AI. Agent
mempunyai **identitas konsisten**, **memori jangka panjang**, bisa menerjemahkan
instruksi bahasa natural menjadi command yang sudah ada, dan melakukan
**self-check source code secara proaktif**.

Agent menggunakan provider/model yang sama dengan `.ai`, jadi isi dulu
`AI_API_URL`, `AI_API_KEY`, dan `AI_MODEL` atau gunakan `.aiset`.

## Kemampuan utama

1. **Kepribadian tetap** — nama, panggilan owner, peran, sifat, dan gaya bicara
   disimpan di database dan ikut digunakan oleh `.ai`.
2. **Personal assistant** — owner dapat menulis `.asisten cek status hosting dan
   resource node`; model memilih command yang tepat dari allowlist.
3. **Bisa diajak bicara di grup** — hanya grup yang owner daftarkan lewat
   `.groupaccess`, dengan batas role per grup dan jawaban yang dirutekan
   (obrolan -> grup, server/hosting -> DM owner). Lihat
   [docs/GROUP-ACCESS.md](GROUP-ACCESS.md).
4. **Memori jangka panjang** — fakta non-rahasia tetap tersimpan setelah restart.
5. **Tindakan dengan pagar pengaman** — pemeriksaan dapat berjalan otomatis,
   sedangkan broadcast/restart/power server dan tindakan sensitif meminta
   `.approve <ID>`.
6. **Guardian** — memeriksa syntax JavaScript, target `require`, command yang gagal
   load/bentrok, kesehatan database, versi Node, dan pemakaian memori. Error
   runtime dari logger juga dikumpulkan dan dilaporkan ke seluruh owner.
7. **Deep check** — `.selfcheck deep` menjalankan seluruh `npm test` dan menyertakan
   hasilnya dalam laporan.

## Mulai cepat

```text
.persona name Aruna
.persona owner Wang
.persona role asisten pribadi dan penjaga semua operasional serverku
.persona traits proaktif, teliti, hangat, tegas saat ada risiko
.agentset mode safe
.asisten cek kesehatan bot dan jelaskan kalau ada masalah
```

Jika ingin berbicara tanpa prefix di chat pribadi owner:

```text
.agentset autochat on
```

Auto-chat di private chat hanya untuk **owner**. Di grup, auto-chat butuh dua
opt-in sekaligus (`agentset autochat on` + `groupaccess autochat on <jid>`) dan
defaultnya pesan harus **men-tag bot** — jadi bot tidak mencampuri setiap
percakapan grup.

## Agent di grup (allowlist + role)

```text
.groupaccess add                    # owner: izinkan grup tempat command ini dipakai
.groupaccess role admin <jid>       # owner + admin grup (default)
.groupaccess tools read <jid>       # di grup: hanya alat baca-saja yang otomatis
.groupaccess route smart <jid>      # obrolan -> grup, server/hosting -> DM owner
```

Perbedaan perilaku penting dibanding chat pribadi owner:

| Aspek | Private (owner) | Grup yang diizinkan |
|---|---|---|
| Siapa yang boleh memanggil | hanya owner | sesuai `role` grup: `owner`/`admin`/`member`/`all` |
| Memori jangka panjang | ikut dipakai | **tidak pernah** masuk prompt |
| Riwayat percakapan | per nomor (`agent:<nomor>`) | per grup (`agent:<jid@g.us>`) |
| Alat `write`/`high` | sesuai mode otonomi | otomatis hanya `read`; lainnya jadi proposal ke owner |
| Proposal `.approve` | tampil di chat owner | **DM owner**, grup hanya dikabari |
| Isi jawaban | apa adanya | dirutekan + disamarkan untuk non-owner |
| Menulis memori (`ingat ...`) | boleh bila owner minta | ditolak |

Command grup/admin (`kick`, `warn`, `promote`, ...) tetap tidak bisa dijalankan
agent dari mana pun — agent hanya boleh memakai command yang ada di allowlist
alat, dan yang menuntut konteks grup diblokir.

Detail semua saklar (enforce, jeda, test, requests, rute, `.env`):
**[docs/GROUP-ACCESS.md](GROUP-ACCESS.md)**.

## Tingkat otonomi

| Mode | Perilaku |
|---|---|
| `chat` | Agent hanya berbicara; tidak menjalankan command. |
| `supervised` | Semua command usulan harus disetujui owner. |
| `safe` | Command baca-saja berjalan otomatis; perubahan meminta approval. Ini default yang disarankan. |
| `autonomous` | Baca dan operasi ringan berjalan otomatis; tindakan sensitif tetap meminta approval. |

Ubah mode:

```text
.agentset mode safe
.agentset mode autonomous
```

### Command yang dapat dipilih agent

Allowlist mencakup status/runtime/statistik, status panel dan resource, informasi
layanan, laporan/feedback, status Minecraft, self-check, backup, cek monitoring,
tes jaringan keluar (`.pingl` — ping IP/domain & cek port), dan beberapa tindakan
operasional.

`pingl` adalah alat **baca-saja**: di grup yang diizinkan owner (`.groupaccess tools
read`) agent boleh langsung menjalankan ping; hasilnya diperlakukan seperti jawaban
lainnya — masuk DM owner kalau rute grup mengarahkan topik server/hosting ke privat.

Command berikut **tidak pernah diberikan kepada model**, pada mode apa pun:

- `.exec` dan `.eval`;
- tambah/hapus owner;
- restore database;
- pengaturan API key/provider AI;
- token panel, RCON, dan command console;
- command lain di luar allowlist `src/lib/assistant.js`.

Command sensitif yang memang ada di allowlist—misalnya broadcast, promo manual,
restart bot, git pull, maintenance node, power server Minecraft, dan join grup—
selalu menghasilkan proposal seperti ini:

```text
ID: A1B2C3
Perintah: .mcpower Survival restart
Setujui: .approve A1B2C3
Tolak: .reject A1B2C3
```

Proposal kedaluwarsa otomatis (default 10 menit) dan dihapus **sebelum**
dieksekusi, sehingga pesan approval ganda tidak menjalankan tindakan dua kali.

## Memori

```text
.agentset remember laporan-mingguan dibuat setiap Senin pagi
.agentset memory
.agentset forget laporan-mingguan
.agentset forget all
```

Agent juga boleh mengisi memori jika owner secara eksplisit berkata “ingat ...”.
Password, API key, token, cookie, secret, dan session ditolak oleh lapisan kode,
bukan hanya oleh prompt AI. Maksimum 50 fakta.

Riwayat percakapan jangka pendek dan memori jangka panjang berbeda:

```text
.agentset clearhistory   # hapus konteks chat, fakta tetap ada
.agentset forget all     # hapus fakta jangka panjang
```

## Guardian dan laporan kode

```text
.selfcheck               # cepat: source + command + DB + runtime
.selfcheck deep          # semua di atas + npm test
.agentset guardian on
.agentset interval 360   # menit, minimum 15
.agentset errors on      # laporkan error runtime dari logger
.agentset healthy off    # tidak spam laporan ketika sehat
```

Pemeriksaan cepat otomatis berjalan setelah koneksi WhatsApp siap dan kemudian
sesuai interval. Guardian mengirim laporan hanya ketika:

- ditemukan masalah baru atau jenis masalah berubah;
- masalah yang sebelumnya ada sudah pulih;
- masalah yang sama masih ada setelah periode pengingat (default 24 jam); atau
- `healthy on` dan waktunya laporan rutin.

Fingerprint laporan disimpan di database agar reconnect/restart tidak menyebabkan
spam yang sama. Guardian **mendiagnosis dan melapor**, tidak mengedit source code
sendiri.

### Apa yang diperiksa

- syntax semua `index.js`, `ecosystem.config.js`, dan `src/**/*.js`;
- `require('./file-lokal')` yang targetnya hilang;
- penggunaan `logger.*` tanpa deklarasi/import;
- file command yang gagal load;
- nama dan alias command yang bentrok;
- struktur command (`name`, `run`, deskripsi);
- database dapat diserialisasi dan ukurannya masih wajar;
- owner tersedia (perlindungan keamanan);
- versi Node memenuhi `package.json`;
- RSS/heap proses;
- seluruh test suite jika memakai mode `deep`.

Error runtime dilaporkan dari sumber logger aplikasi, dideduplikasi, disamarkan
dari pola API key/token, dan dibatasi satu laporan per fingerprint per jam.

## Semua command Personal Agent

| Command | Fungsi |
|---|---|
| `.asisten <instruksi>` | Bicara dan beri agent pekerjaan dalam bahasa natural. |
| `.persona` | Lihat identitas agent. |
| `.persona name\|owner\|role\|traits\|style <teks>` | Bentuk kepribadian. |
| `.agentset status` | Status lengkap agent dan guardian. |
| `.agentset mode <mode>` | Atur tingkat otonomi. |
| `.agentset autochat on\|off` | Pesan private owner tanpa prefix. |
| `.agentset guardian on\|off` | Nyalakan/matikan self-check otomatis. |
| `.agentset interval <menit>` | Interval pemeriksaan otomatis. |
| `.agentset errors on\|off` | Laporan error runtime. |
| `.agentset healthy on\|off` | Laporan berkala saat sehat. |
| `.agentset memory\|remember\|forget` | Kelola memori jangka panjang. |
| `.agentset pending` | Daftar tindakan menunggu approval. |
| `.agentset group` | Ringkasan grup yang boleh memakai agent (atur: `.groupaccess`). |
| `.approve <ID>` | Setujui dan jalankan tindakan. |
| `.reject <ID>` | Batalkan tindakan. |
| `.selfcheck [deep]` | Audit kesehatan bot sekarang. |
| `.groupaccess ...` | (owner) grup mana yang boleh memanggil agent + batas role. |

## Konfigurasi `.env`

Lihat blok `PERSONAL AGENT` di `.env.example`. Nilai penting:

```env
ASSISTANT_ENABLED=1
ASSISTANT_MODE=safe
ASSISTANT_AUTO_CHAT=0
ASSISTANT_GUARDIAN=1
ASSISTANT_CHECK_INTERVAL=360
# akses grup (lihat docs/GROUP-ACCESS.md)
GROUP_ACCESS_ENFORCE=1
GROUP_ACCESS_ROLE=admin
GROUP_AGENT_TOOLS=read
GROUP_AGENT_ROUTE=smart
GROUP_AGENT_AUTOREPLY=0
GROUP_AGENT_MENTION=1
ASSISTANT_REPORT_RUNTIME_ERRORS=1
ASSISTANT_REPORT_HEALTHY=0
```

Pengaturan melalui WhatsApp disimpan ke `data/database.json` dan berlaku tanpa
restart. Seperti database bot lainnya, file tersebut harus dijaga dan tidak boleh
dikomit ke Git.
