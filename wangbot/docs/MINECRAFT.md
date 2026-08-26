# 🎮 Monitoring Server Minecraft — WangBot

Fitur ini membuat WangBot bisa memantau **server Minecraft pelanggan** lewat WhatsApp:
status online/offline, jumlah player, MOTD, pemakaian CPU/RAM/disk, alert otomatis
saat server mati, sampai menyalakan ulang server dan mengirim console command.

---

## Cara kerja (3 sumber data)

| Sumber | Yang didapat | Kebutuhan |
|---|---|---|
| **SLP** (Server List Ping, port game) | online/offline, jumlah player + daftar nama, MOTD, versi, latency | IP:port server bisa dijangkau bot. Nol dependency — protokol ditulis di `src/lib/minecraft.js` memakai `net` bawaan Node |
| **Pterodactyl Client API** | power state, CPU, RAM, disk, uptime **per server**, kontrol power, console | `PANEL_CLIENT_TOKEN` (Client API key milik akun pelanggan) |
| **RCON** (opsional) | console command langsung ke server | `enable-rcon=true` + password + port RCON terbuka |

Bot **tidak** membaca log server atau SSH ke mesin. Semua lewat jalur di atas.

---

## Alur untuk pelanggan

```
1. .mclink <email panel> <Client API key>     ← hubungkan akun panel
2. .mcservers                                 ← lihat server yang terlihat
3. .mcwatch <nama server>                     ← aktifkan pemantauan
4. .mcstatus                                  ← cek status kapan saja
```

Setelah itu bot memeriksa server tiap `MC_MONITOR_INTERVAL` menit dan mengirim
WhatsApp ke pelanggan bila server mati / pulih / RAM-CPU melewati batas.

### Cara pelanggan mengambil Client API key

1. Login ke panel WangStore.
2. Klik foto profil → **API Credentials**.
3. **Create New** → centang **Read** (tambahkan **Control** bila ingin bisa restart dari WA).
4. Salin key-nya, kirim ke bot lewat `.mclink`.

> 🔒 **Kenapa aman?** Client API key hanya bisa melihat server yang memang
> terlihat oleh akun itu sendiri. Jadi batas hak akses dijaga oleh panel, bukan
> oleh bot. Pelanggan yang tahu uuid server orang lain tetap tidak bisa
> membacanya. Di sisi bot, ada lapisan kedua: `resolveServer()` hanya
> mengembalikan server dengan `ownerJid` == pengirim (kecuali owner bot).

---

## Daftar command

### Pelanggan

| Command | Fungsi |
|---|---|
| `.mclink <email> <key>` | Hubungkan akun panel. `.mclink off` untuk melepas |
| `.mcservers` | Daftar server yang dipantau + status RCON |
| `.mcwatch <server> [on\|off]` | Aktifkan / jeda pemantauan sebuah server |
| `.mcstatus [server]` | Status lengkap: online, player, versi, MOTD, CPU/RAM/disk |
| `.mcplayers [server]` | Siapa saja yang sedang main |
| `.mcres [server]` | Detail resource dengan bar persentase |
| `.mcconsole [server] <cmd>` | Kirim console command (`say`, `list`, `whitelist add`, …) |
| `.mcpower <server> <start\|stop\|restart\|kill>` | Kontrol power. Alias: `.mcrestart`, `.mcstart`, `.mcstop` |
| `.mcrcon <server> <port> <password>` | Set / uji / hapus RCON (jalur cadangan console) |

### Owner

| Command | Fungsi |
|---|---|
| `.mcadmin list` | Semua server + pelanggan yang terhubung |
| `.mcadmin add <nomor> <nama> <host> <port>` | Daftarkan server manual (tanpa panel) |
| `.mcadmin sethost <id> <host> <port>` | Ganti alamat yang diping (server di belakang NAT) |
| `.mcadmin monitor <id> <on\|off>` | Jeda / aktifkan pemantauan |
| `.mcadmin check` | Jalankan cek monitoring sekarang |
| `.mcadmin rm <id>` | Hapus server dari pemantauan |

Nama server boleh ditulis sebagian (`.mcstatus surv` cocok dengan "Survival").
Bila pelanggan hanya punya satu server, namanya boleh dihilangkan.

---

## Perilaku alert

- **Down**: server ditandai pada tick pertama, alert dikirim pada **tick kedua**.
  Glitch jaringan sesaat tidak menghasilkan alert palsu.
- **Tidak spam**: setelah alert down, bot diam sampai server pulih atau sampai
  `MC_DOWN_REMIND_MINUTES` (default 30 menit) lewat → kirim pengingat.
- **Pulih**: alert 🟢 lengkap dengan perkiraan lama downtime.
- **Resource**: RAM/CPU alert sekali saat melewati threshold, lalu diam sampai
  turun dulu dan naik lagi (pola `crossed()` yang sama dengan monitoring node).
- **Tujuan**: pelanggan pemilik server. Ringkasan singkat juga dikirim ke
  admin/owner bila `MC_NOTIFY_ADMIN=1`.

---

## Keamanan

| Risiko | Penanganan |
|---|---|
| Pelanggan mengakses server orang lain | Client API key membatasi apa yang terlihat di panel + `resolveServer()` memfilter `ownerJid` |
| Client API key bocor | Disimpan per pelanggan, ditampilkan tersamar (`.mcservers`), bisa dilepas dengan `.mclink off` |
| Console command merusak (`stop`, `op`, `ban`) | Harus dikonfirmasi dengan akhiran `--ya` |
| Console/power dipakai iseng di grup | Dibatasi ke chat pribadi (ubah lewat `MC_CONSOLE_IN_GROUP=1`) |
| Pelanggan mendaftarkan ratusan server | `MC_MAX_SERVERS_PER_USER` (default 5) |

---

## Konfigurasi `.env`

```ini
PANEL_CLIENT_TOKEN=          # Client API key (opsional; tanpa ini hanya SLP yang jalan)
MC_MONITOR=1                 # 0 = matikan fitur
MC_MONITOR_INTERVAL=2        # menit
MC_ALERT_RAM_THRESHOLD=90
MC_ALERT_CPU_THRESHOLD=90
MC_DOWN_REMIND_MINUTES=30
MC_MAX_SERVERS_PER_USER=5
MC_PING_TIMEOUT=5000         # ms
MC_NOTIFY_ADMIN=1
MC_CONSOLE_IN_GROUP=0
```

`PANEL_CLIENT_TOKEN` di `.env` hanya dipakai sebagai default/owner. Untuk
pelanggan, token disimpan di database lewat `.mclink` dan dipakai per permintaan.

---

## Catatan teknis

- **SLP** memakai VarInt + string ber-prefix VarInt. Dua hal yang mudah keliru
  dan sudah diuji: server **tidak** membalas Handshake (hanya Status Request
  yang dijawab), dan string JSON direspons **diawali VarInt panjang** sehingga
  tidak boleh langsung di-`JSON.parse`.
- **RCON** memakai format Source RCON: `[int32 len][int32 id][int32 type]
  [VarInt len + string][0x00]`. Tanpa prefix VarInt, server Minecraft membaca
  karakter pertama password sebagai panjang string dan login selalu gagal.
- **Console panel** memakai websocket dua tahap (panel → daemon Wings). Jalur
  ini tetap jalan walau server Minecraft berada di belakang NAT, karena koneksi
  dibuat dari sisi daemon, bukan dari bot.
- **Alamat server** diambil dari *allocation default* di panel. Bila server di
  belakang NAT, owner bisa menimpanya dengan `.mcadmin sethost`.
- **TPS** tidak tersedia: protokol Minecraft standar tidak mengirimnya. Bila
  dibutuhkan, ambil lewat console (`timings`, plugin) — bukan lewat SLP.

---

## Menguji

```bash
npm run test:mc        # 70 assertion
npm run fake:mc        # server Minecraft tiruan (SLP/RCON) di :25599
npm run fake:client-panel   # Pterodactyl Client API tiruan di :8792
```

`test/mc.test.js` menjalankan kode sungguhan: server TCP palsu untuk SLP & RCON,
HTTP palsu untuk Client API, dan command dijalankan lewat `src/handler.js` asli.
