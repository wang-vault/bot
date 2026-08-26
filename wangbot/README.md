# 👑 WangBot — WhatsApp Bot untuk WangStore

Bot WhatsApp multi-fitur berbasis **Node.js** + **Baileys**, dirancang untuk komunitas **WangStore** (hosting, VPS, dedicated server). File utama: **`index.js`**. Nomor owner diatur lewat **`.env`** dan bisa diubah kapan saja.

> ✅ **80+ command** terbagi dalam 14 kategori — teruji load & dry-run tanpa error.

---

## 📦 Fitur Lengkap

| Kategori | Fitur |
|---|---|
| 👋 **Community** | Auto Welcome, Auto Goodbye, Auto Rules, Auto Website, Auto Link Grup, AFK + Auto Remove AFK, Auto Reply FAQ |
| 🛡️ **Moderasi** | Anti Link, Anti Promo, Anti Spam, Anti Flood, Anti Virtex, Anti Tag All, Auto Delete, Warning System, Auto Kick (opsional), Whitelist Link & Member, ON/OFF per grup |
| 📊 **Monitoring Hosting** | Status Website & Panel, Status/Ping Node, Resource (CPU/RAM/Disk), Spesifikasi Node, Jumlah Server Aktif |
| 🎮 **Server Minecraft** | Status server MC pelanggan (SLP), Player Online, MOTD & Versi, Resource per Server, Alert Down/Otomatis Pulih, Restart & Power, Console Command (panel/RCON) |
| 📦 **Informasi Layanan** | Paket Hosting, VPS, Dedicated Server, Public IP, Kontak Admin, Website, Link Grup |
| 📢 **Marketing** | Auto Promotion, Daftar Grup Promosi, Multi Template, Jadwal & Interval, Pause/Resume, Kirim Manual, Statistik |
| 🖼️ **Media** | Sticker dari Gambar, Sticker Gambar + Teks (meme), Sticker dari Teks, Watermark |
| 👁️ **View Once** | Buka Gambar & Video sekali lihat |
| 👮 **Admin Grup** | Kick, Add, Promote, Demote, Open/Close, Tag All, Hide Tag, Revoke & Ambil Link |
| 📡 **Broadcast** | Broadcast ke semua grup / grup tertentu |
| 📋 **Utility** | Menu, Ping, Runtime, Info Bot, Owner, Prefix Info |
| 📈 **Statistik** | Total Grup, User, Command, Uptime, Top Command |
| 📂 **Logging** | Log Error, Command, Join/Leave, Promosi |
| 🔐 **Keamanan** | Owner/Admin Only, Rate Limit, Blacklist User & Grup |
| 🎫 **Customer Service** | FAQ, Kontak, Jam Operasional, Feedback, Laporan |
| 🚨 **Monitoring Otomatis** | Notif Node Offline, Website/Panel Down, Alert RAM/CPU/Disk tinggi, Maintenance Mode, Server Minecraft Down/Pulih ke pelanggan |
| 👑 **Owner** | Eval JS, Exec Terminal, Restart, Git Pull, Backup/Restore DB, Broadcast, Join/Leave Grup, Add/Del Owner |
| 🎮 **Games** | Tebak Angka, Suit, Dadu, Coin Flip, Slot |

---

## 🚀 Instalasi & Menjalankan

### Prasyarat
- **Node.js v18+** (v20 disarankan)
- Akun WhatsApp aktif (akan dijadikan bot)

### Langkah

```bash
# 1. Install dependency
npm install

# 2. Atur konfigurasi di .env (WAJIB)
cp .env.example .env
#   -> isi OWNER_NUMBER (nomor kamu)
#   -> isi WANGSTORE_WEBSITE, WANGSTORE_PANEL, COMMUNITY_GROUP, ADMIN_CONTACT, dll.

# 3. Jalankan bot
npm start
#   -> Scan QR yang muncul di terminal dengan WhatsApp kamu

# 4. (Opsional) Jalankan pakai PM2 agar auto-restart
npm install -g pm2
pm2 start ecosystem.config.js
pm2 logs wangbot
pm2 save && pm2 startup
```

Setelah login, ketik `.menu` di chat WhatsApp untuk melihat semua command.

---

## ⚙️ Konfigurasi `.env`

| Variabel | Keterangan |
|---|---|
| `BOT_NAME` | Nama bot (default: WangBot) |
| `OWNER_NUMBER` | Nomor owner, bisa lebih dari 1 (pisahkan koma). Contoh: `6281234567890` |
| `PREFIX` | Prefix command (default: `.`) |
| `WANGSTORE_WEBSITE` | URL website |
| `WANGSTORE_PANEL` | URL panel |
| `COMMUNITY_GROUP` | Link grup komunitas |
| `ADMIN_CONTACT` / `WHATSAPP_ADMIN` | Nomor admin |
| `OPERATIONAL_HOURS` | Jam operasional, contoh `08:00-22:00` |
| `PANEL_API_URL` | URL Pterodactyl (untuk monitoring) |
| `PANEL_API_TOKEN` | Application API key Pterodactyl |
| `MONITOR_INTERVAL` | Interval cek monitoring (menit) |
| `ALERT_RAM/CPU/DISK_THRESHOLD` | Batas alert otomatis (persen) |
| `LOG_LEVEL` | Level log baileys (default: `warn`) |

> **Monitoring hosting** butuh **Application API Key** Pterodactyl. Jika tidak diisi, fitur monitoring node nonaktif tetapi cek status website tetap jalan.

### 👑 Mengubah Owner
Owner bisa diubah kapan saja **tanpa edit kode**:
- **Via `.env`:** ubah `OWNER_NUMBER` lalu restart.
- **Via command (tanpa restart):** `.addowner 6281xxxx` dan `.delowner 6281xxxx`.

---

## 🗂️ Struktur Proyek

```
wangbot/
├── index.js              # File utama (entry point)
├── ecosystem.config.js   # Konfigurasi PM2 (auto-restart)
├── package.json
├── .env / .env.example   # Konfigurasi & nomor owner
├── data/                 # database.json + sesi auth (auto dibuat)
└── src/
    ├── config.js         # Loader .env
    ├── database.js       # Database JSON + auto-save
    ├── connection.js     # Koneksi WhatsApp (Baileys) + reconnect
    ├── handler.js        # Router pesan, permission, rate-limit, AFK, FAQ
    ├── events/groups.js  # Welcome/Goodbye/Rules otomatis
    ├── lib/              # func, message, panel, monitor, mc, minecraft,
    │                     #   marketing, moderation, sticker, layanan, logger
    └── commands/         # 92 command dalam 15 folder kategori
```

---

## 💡 Contoh Command Populer

```
.menu                          # semua command
.ping                          # cek kecepatan bot
.groupsetting                  # lihat & atur fitur grup
.groupsetting antilink on      # aktifkan anti link
.welcome (reply member)        # —
.afk lagi makan                # set AFK
.sticker (reply gambar)        # buat sticker
.smeme atas|bawah (reply)      # sticker meme
.status                        # monitoring hosting
.paket                         # info layanan
.feedback pelayanan mantap     # kirim saran
.bc <teks>                     # broadcast ke semua grup (owner)
.eval <kode js>                # owner
```

---

## 🔧 Catatan Teknis
- **Database** disimpan otomatis di `data/database.json` (debounced auto-save + simpan saat exit).
- **Sesi** disimpan di `data/auth/` — jika logout, hapus folder itu lalu jalankan ulang untuk scan QR baru.
- **Restart** butuh process manager (PM2/systemd). Command `.restart` memicu `process.exit(1)` agar di-restart otomatis.
- **Sticker** hanya untuk gambar (sticker video sengaja dinonaktifkan). Render teks memakai `sharp` (sudah include).
- Semua error tertangkap (`uncaughtException`/`unhandledRejection`) agar bot tidak crash.

---

## 🆘 Troubleshooting

### Bot "tersambung" tapi perangkat WA mati / tidak aktif
Penyebab paling umum = **session/auth kotor** (mis. setelah crash berulang, ganti versi Baileys, atau perangkat di-remove WhatsApp). Solusinya = **re-pair bersih**:

1. Hentikan bot.
2. **Hapus folder session:**
   ```bash
   rm -rf data/auth
   ```
3. (Opsional tapi disarankan) di HP: WhatsApp → Setelan → Perangkat Tertaut → **hapus perangkat WangBot** yang lama.
4. Jalankan ulang bot → **scan QR baru**.
5. Biarkan aktif ±5 menit tanpa diutak-atik supaya sinkronisasi selesai.

> ⚠️ **Penting:** Jangan pernah menjalankan bot di 2 server/perangkat dengan session yang sama — itu penyebab utama perangkat tiba-tiba "mati". Pakai 1 tempat saja.

### Versi Baileys
- **Stabil:** `6.7.24` (npm dist-tag `legacy`) — sudah dikunci di `package.json`.
- **Jangan** pakai `7.0.0-rc.x` (RC, sering disconnect).
- Jika koneksi error `405` / versi ditolak, set `WA_VERSION` di `.env` ke versi WA Web terbaru (cek di wppconnect.io/whatsapp-versions).

### Bot tidak merespons command / Owner nggak kebaca
- Pastikan di Perangkat Tertaut WA bot berstatus **aktif**.
- DM bot `.ping`. Kalau balas → sehat.
- Cek log `data/logs/` bila perlu (set `LOG_LEVEL=warn` sementara).

### "Owner: ❌ BUKAN" padahal `.env` sudah benar (LID)
Di grup dengan fitur **"sembunyikan nomor"**, kamu muncul sebagai `@lid` (Linked Identity), bukan `@s.whatsapp.net`. WangBot sudah otomatis me-resolve `@lid` → nomor asli, jadi owner tetap cocok. Pastikan:
- `.id` menunjukkan `Nomor/JID : 62xxxxxx@s.whatsapp.net` (sudah di-resolve, bukan `@lid`).
- Owner: `✅ YA`.

Jika tetap `@lid` di `.id`, berarti nomor asli tidak tersedia di metadata grup (jarang) → daftarkan via `.addowner` (tanpa argumen) di **private chat** bot.

> 🔐 `.addowner` sekarang **hanya bisa dipakai owner**. Pengecualian: bila bot belum punya owner sama sekali (`OWNER_NUMBER` kosong dan daftar owner di database kosong), klaim pertama diizinkan untuk bootstrap. Sebelumnya command ini terbuka untuk semua orang — siapa pun bisa menjadikan dirinya owner lalu memakai `.eval`/`.exec` (eksekusi kode di server). Lihat `AUDIT.md` poin P0.

---

## 🧪 Test & Audit

WangBot punya test yang benar-benar menjalankan kode (bukan sekadar cek sintaks):

```bash
npm test                 # core + plumbing + Minecraft — total 112 assertion
npm run test:mc          # khusus Minecraft: 70 assertion (SLP, RCON, Client API, alert, command)
npm run fake:panel       # API Pterodactyl Application tiruan di :8791 (2 node)
npm run fake:mc          # server Minecraft tiruan (SLP + RCON)
npm run fake:client-panel# Pterodactyl Client API tiruan (resource per server)
npm run test:dryrun      # jalankan SEMUA command lewat handler asli + sock palsu, lapor error/balasan

# lengkap dengan monitoring:
npm run fake:panel &
FAKE_PANEL=http://127.0.0.1:8791 FAKE_WEBSITE=http://127.0.0.1:8791 npm test   # -> 24 assertion
```

Hasil terakhir: `21/21` (core) + `21/21` (plumbing) + `70/70` (Minecraft) lulus.
Rincian temuan & perbaikan: **[`AUDIT.md`](AUDIT.md)**.
Panduan fitur server Minecraft: **[`docs/MINECRAFT.md`](docs/MINECRAFT.md)**.

---
© WangStore — MIT License
