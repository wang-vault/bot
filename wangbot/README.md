# 👑 WangBot — WhatsApp Bot untuk WangStore

Bot WhatsApp multi-fitur berbasis **Node.js** + **Baileys**, dirancang untuk komunitas **WangStore** (hosting, VPS, dedicated server). File utama: **`index.js`**. Nomor owner diatur lewat **`.env`** dan bisa diubah kapan saja.

> ✅ **101 command** terbagi dalam 17 kategori, termasuk Personal Agent dengan self-check proaktif.

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
| 🧠 **Ask AI** | Tanya AI apa saja (`.ai`), provider bebas (OpenAI/Groq/OpenRouter/Gemini/DeepSeek/Ollama), API key & model diatur owner lewat `.env` **atau** WhatsApp tanpa restart, memori percakapan, mode grup/pribadi, uji koneksi |
| 🧭 **Personal Agent** | Kepribadian & peran tetap, memori jangka panjang, instruksi natural → command, 4 mode otonomi, approval tindakan sensitif, auto-chat khusus owner, self-check kode + laporan proaktif |
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
| `AI_API_URL` | URL endpoint AI, mis. `https://api.openai.com/v1` |
| `AI_API_KEY` | API key penyedia AI |
| `AI_MODEL` | Nama model, mis. `gpt-4o-mini` |
| `AI_PROVIDER` | `openai` \| `gemini` \| `auto` (default `auto`) |
| `ASSISTANT_MODE` | `chat` \| `supervised` \| `safe` \| `autonomous` |
| `ASSISTANT_AUTO_CHAT` | Pesan private owner tanpa prefix (`0`/`1`) |
| `ASSISTANT_GUARDIAN` | Self-check kode otomatis (`0`/`1`) |
| `ASSISTANT_CHECK_INTERVAL` | Interval self-check dalam menit (default `360`) |

> **Monitoring hosting** butuh **Application API Key** Pterodactyl. Jika tidak diisi, fitur monitoring node nonaktif tetapi cek status website tetap jalan.

> 🧠 **Ask AI dan Personal Agent** memakai 3 nilai yang sama: `AI_API_URL`, `AI_API_KEY`, `AI_MODEL`. Kalau tidak diisi, self-check Guardian tetap bekerja tanpa AI, tetapi percakapan `.ai`/`.asisten` nonaktif. Konfigurasi provider: **[`docs/AI.md`](docs/AI.md)**. Panduan agent: **[`docs/ASSISTANT.md`](docs/ASSISTANT.md)**.

### 👑 Mengubah Owner
Owner bisa diubah kapan saja **tanpa edit kode**:
- **Via `.env`:** ubah `OWNER_NUMBER` lalu restart.
- **Via command (tanpa restart):** `.addowner 0812xxxx` dan `.delowner 0812xxxx`.

### 🔢 Semua input orang pakai NOMOR, bukan JID
Owner & admin tidak perlu tahu bentuk JID (`628123@s.whatsapp.net`). Cukup ketik nomor;
bot yang menormalkan sendiri ke JID di belakang layar, dan semua balasan juga menampilkan
nomor (bukan JID).

Format yang diterima — semuanya setara:

```
.addowner 081234567890
.addowner +62 812-3456-7890
.addowner 62 812 3456 7890
.addowner 6281234567890
.addowner wa.me/6281234567890
.addowner                      <- tanpa argumen = nomor kamu sendiri
.addowner 628123450000@s.whatsapp.net   <- JID penuh tetap diterima
```

Nomor ber-spasi (`+62 811-9999-8888`) dibaca sebagai **satu** nomor, sedangkan dua nomor
berurutan tetap jadi dua target: `.kick 0812xxx 0813xxx`.

Command yang memakai aturan ini: `.addowner` `.delowner` `.blacklist add/del user`
`.whitelist add/del member` `.warn` `.delwarn` `.kick` `.promote` `.demote` `.add`
`.mcadmin add`. Semua tetap bisa dipakai dengan **reply** atau **tag** seperti sebelumnya.

> Catatan: JID **grup** (`.promogroup`, `.broadcast`) memang tetap `xxx@g.us` — grup tidak punya nomor telepon.

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
    ├── lib/              # ai, assistant, persona, guardian, code-health,
    │                     # monitor, mc, marketing, moderation, logger, dll.
    └── commands/         # 101 command dalam 17 folder kategori
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
.ai kenapa server mc lag?      # tanya AI dengan kepribadian bot
.asisten cek kesehatan bot     # agent memilih & menjalankan alat yang aman
.persona name Aruna            # bentuk identitas agent tanpa restart
.agentset mode safe            # baca otomatis, perubahan butuh approval
.selfcheck deep                # audit source + jalankan seluruh test
.aiset api https://api.groq.com/openai/v1   # owner: set endpoint AI
.aiset key gsk_xxxx            # owner: set API key (disamarkan di chat & log)
.aiset test                    # owner: uji koneksi AI
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
- **Guardian** memeriksa syntax/require/command/database/runtime dan melaporkan perubahan masalah ke seluruh owner; tindakan sensitif hasil rencana AI selalu membutuhkan `.approve`.

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
- `.id` menunjukkan `Nomor kamu : 62xxxxxx` (sudah di-resolve, bukan `@lid`).
- Owner: `✅ YA`.

Jika tetap `@lid` di `.id`, berarti nomor asli tidak tersedia di metadata grup (jarang) → daftarkan via `.addowner` (tanpa argumen) di **private chat** bot.

> 🔐 `.addowner` sekarang **hanya bisa dipakai owner**. Pengecualian: bila bot belum punya owner sama sekali (`OWNER_NUMBER` kosong dan daftar owner di database kosong), klaim pertama diizinkan untuk bootstrap. Sebelumnya command ini terbuka untuk semua orang — siapa pun bisa menjadikan dirinya owner lalu memakai `.eval`/`.exec` (eksekusi kode di server). Lihat `AUDIT.md` poin P0.

---

## 🧪 Test & Audit

WangBot punya test yang benar-benar menjalankan kode (bukan sekadar cek sintaks):

```bash
npm test                 # core + plumbing + Minecraft + AI + nomor + Personal Agent
npm run test:mc          # khusus Minecraft: 70 assertion (SLP, RCON, Client API, alert, command)
npm run test:ai          # khusus Ask AI (provider, error, command, keamanan log)
npm run test:assistant   # persona, planner JSON, policy/approval, memori, dan scanner kode
npm run test:target      # khusus input NOMOR: 57 assertion (addowner/delowner, warn, kick, blacklist, mcadmin, .id)
npm run fake:panel       # API Pterodactyl Application tiruan di :8791 (2 node)
npm run fake:mc          # server Minecraft tiruan (SLP + RCON)
npm run fake:client-panel# Pterodactyl Client API tiruan (resource per server)
npm run fake:ai          # penyedia AI tiruan di :8793 (gaya OpenAI + Gemini, plus simulasi 401/404/429)
npm run test:dryrun      # jalankan SEMUA command lewat handler asli + sock palsu, lapor error/balasan

# lengkap dengan monitoring:
npm run fake:panel &
FAKE_PANEL=http://127.0.0.1:8791 FAKE_WEBSITE=http://127.0.0.1:8791 npm test   # -> 24 assertion

# uji AI terhadap penyedia tiruan yang berjalan terpisah (opsional):
npm run fake:ai &
FAKE_AI=http://127.0.0.1:8793 npm run test:ai   # -> 79 assertion
```

Hasil terakhir: seluruh suite lulus, termasuk **50/50** pemeriksaan Personal Agent.
Rincian temuan & perbaikan: **[`AUDIT.md`](AUDIT.md)**.
Panduan fitur server Minecraft: **[`docs/MINECRAFT.md`](docs/MINECRAFT.md)**.
Panduan Ask AI (resep OpenAI/Groq/OpenRouter/Gemini/Ollama): **[`docs/AI.md`](docs/AI.md)**.
Panduan Personal Agent (persona, otonomi, approval, Guardian): **[`docs/ASSISTANT.md`](docs/ASSISTANT.md)**.

---
© WangStore — MIT License
