# 👥 Akses Grup untuk Personal Agent & Ask AI

Secara bawaan agent dulu hanya bisa diajak bicara di **chat pribadi owner**.
Sekarang agent (`.asisten`) dan Ask AI (`.ai`) bisa dihubungi **dari grup**, dengan
dua pagar yang hanya bisa dibuka oleh **owner**:

1. **Allowlist grup** — hanya grup yang didaftarkan owner yang boleh memakai agent/AI.
2. **Batas role** — di dalam grup itu, hanya peran yang diizinkan owner yang boleh memanggil.

Admin grup **tidak** punya jalan masuk ke pengaturan ini. `.groupsetting` (milik
admin) tidak menyentuh blok `groupAccess` sama sekali.

---

## 1. Menambah grup ke allowlist

Owner tidak perlu hafal JID grup. Ada tiga cara:

```text
# A) dari dalam grupnya langsung
.groupaccess add

# B) balas / forward salah satu pesan grup itu ke bot, lalu
.groupaccess add

# C) ketik JID manual (lihat daftarnya dengan .groupaccess listgrup)
.groupaccess add 120363012345678901@g.us Support WangStore
```

```text
.groupaccess listgrup          # semua grup yang bot ikuti + status izinnya
.groupaccess listgrup support  # filter berdasarkan nama
.groupaccess list              # grup yang sudah diizinkan + pengaturannya
.groupaccess detail <jid>      # satu grup lengkap
.groupaccess del <jid>         # tutup aksesnya seketika
.groupaccess del all           # kosongkan allowlist
```

## 2. Batas role per grup

```text
.groupaccess role owner  <jid>   # hanya owner bot
.groupaccess role admin  <jid>   # owner + admin grup  <- default
.groupaccess role member <jid>   # semua peserta grup
.groupaccess role all    <jid>   # siapa pun di grup (termasuk bukan peserta)
.groupaccess role auto   <jid>   # kembali ikut default global
```

Tanpa JID, nilai yang berubah adalah **default untuk semua grup**
(`.groupaccess role admin`). Dengan `all`, nilai ditulis eksplisit ke semua grup.

Role dihitung dari metadata grup: `owner` = nomor ada di daftar owner,
`admin` = `admin`/`superadmin` grup, `member` = peserta biasa, dan
`guest` = pengirim yang tidak ada di daftar peserta (ditolak kecuali batas `all`).
Nomor owner yang tampil sebagai `@lid` (grup dengan "sembunyikan nomor") tetap
 dikenali karena handler me-resolve-nya lebih dulu.

## 3. Seberapa jauh agent boleh bertindak di grup

```text
.groupaccess tools none <jid>   # hanya bicara, tidak pernah menjalankan command
.groupaccess tools read <jid>   # hanya alat baca-saja   <- default
.groupaccess tools full <jid>   # ikut mode otonomi global, tapi ...
```

Aturan yang **tidak bisa** dilewati level apa pun:

| Di grup | Perilaku |
|---|---|
| risiko `read` | jalan otomatis (mode `safe`/`autonomous`) |
| risiko `write` | hanya otomatis bila penanya **owner** + `tools full` + mode `autonomous`; selain itu jadi proposal |
| risiko `high` (broadcast, restart, power server, git pull, join, dsb.) | **selalu** butuh `.approve` owner |
| `.exec`, `.eval`, `addowner`, `restore`, pengaturan AI/panel/RCON | tidak pernah bisa dipilih model (di luar allowlist alat) |
| command khusus grup/admin (`kick`, `warn`, `promote`, ...) | diblokir dari agent — tindakan grup tetap dilakukan manusia |

Permintaan persetujuan **tidak pernah muncul di grup**: detail + ID dikirim ke
**DM owner**, grup hanya menerima kabar `🛂 permintaan diteruskan ke owner`.
Setelah owner `.approve <ID>` di chat pribadinya, hasilnya dilaporkan balik ke grup
asal (ringkasan; detail tetap di DM bila topiknya privat).

## 4. Ke mana jawaban dikirim (rute)

```text
.groupaccess route smart  <jid>   # default
.groupaccess route group  <jid>   # semua jawaban tampil di grup
.groupaccess route private <jid>  # semua jawaban ke DM owner
.groupaccess route admin  <jid>   # semua jawaban ke DM admin grup
```

`smart` memisahkan berdasarkan isi jawaban **dan** kategori command yang dijalankan:

| Topik | Contoh pemicu | Tujuan |
|---|---|---|
| obrolan | sapaan, basa-basi, pertanyaan umum | **grup** |
| server & hosting | server, VPS, panel, node, CPU/RAM/disk, Minecraft, RCON, invoice, pelanggan | **DM owner + penanya** |
| admin grup | warn, kick, promote, blacklist, groupsetting, approve/reject, link grup | **DM admin grup** |
| owner | API key, token, password, session, eval/exec, restore, prefix, backup | **DM owner saja** |

Grup selalu dapat penanda singkat supaya tidak terlihat macet:

```text
🔒 Aruna menjawab di chat privat owner & kamu (chat pribadi) — topik server & hosting
   tidak ditampilkan di grup.
```

Teks yang dikirim ke **non-owner** disamarkan (pola `sk-…`, `gsk_…`, `AIza…`,
`api key=…`, `token=…`, `password=…` diganti `[SECRET]`). Kalau DM gagal
terkirim (nomor diblokir, hanya punya `@lid`), jawaban dikirim ke grup dalam versi
samar supaya tidak hilang begitu saja.

## 5. Saklar & mode lama

```text
.groupaccess on|off        # 0 = agent & .ai bungkam total di SEMUA grup
.groupaccess enforce on    # default: wajib allowlist
.groupaccess enforce off   # perilaku lama: semua grup boleh, batas role tetap aktif
.groupaccess agent on|off [jid|all]   # Personal Agent per grup
.groupaccess ai on|off [jid|all]      # Ask AI per grup
```

Saklar global `.ai` lama tetap berfungsi sebagai pemotong di atas semuanya:
`.aiset group off` mematikan AI di grup walau grup sudah diizinkan.

## 6. Auto-chat di grup (pesan tanpa prefix)

```text
.agentset autochat on              # master switch (private owner + grup)
.groupaccess autochat on <jid>     # grup ini ikut menjawab tanpa prefix
.groupaccess mention off <jid>     # tidak perlu tag bot (default: HARUS tag)
```

Default-nya aman: agent hanya menjawab pesan non-command di grup bila
(1) auto-chat global aktif, (2) `autochat` grup itu aktif, (3) pemanggil
memenuhi batas role, dan (4) bot **di-tag** / pesannya membalas pesan bot.
Grup yang di-blacklist atau di-mute tetap tidak dijawab.

## 7. Saat ada grup yang mencoba tapi belum diizinkan

Setiap percobaan di grup non-allowlist dicatat dan owner dikabari sekali per 6 jam:

```text
🔔 PERMINTAAN AKSES DI GRUP
Grup   : Support WangStore
JID    : `120363...@g.us`
Fitur  : Personal Agent (.asisten)
Peminta : 628999000111 (peran: member)
```

```text
.groupaccess requests      # daftar permintaan
.groupaccess clearrequests # bersihkan
```

## 8. Pengujian & kebersihan

```text
.groupaccess test agent <jid>   # bagaimana keputusan gerbang untuk grup itu
.groupaccess test ai <jid>
.groupaccess clearchat <jid|all>   # hapus riwayat AI + agent grup
.groupaccess jeda on|off <jid>     # menjeda sementara tanpa menghapus
```

## 9. Konfigurasi `.env` (default, boleh diubah tanpa restart)

```env
GROUP_ACCESS_ENABLED=1     # 0 = agent/AI bungkam di semua grup
GROUP_ACCESS_ENFORCE=1     # 0 = semua grup boleh (perilaku lama)
GROUP_AGENT_IN_GROUP=1     # default fitur agent untuk grup baru
GROUP_AI_IN_GROUP=1        # default fitur .ai untuk grup baru
GROUP_ACCESS_ROLE=admin    # owner | admin | member | all
GROUP_AGENT_TOOLS=read     # none | read | full
GROUP_AGENT_ROUTE=smart    # smart | group | private | admin | owner
GROUP_AGENT_MENTION=1      # auto-reply grup hanya saat bot di-tag
GROUP_AGENT_AUTOREPLY=0    # agent menjawab pesan non-command di grup
GROUP_ACCESS_ALLOW=120363012345678901@g.us,120363098765432109@g.us
```

`GROUP_ACCESS_ALLOW` hanya untuk bootstrap saat start (harus JID grup, bukan link
undangan) — berguna ketika server baru dipasang. Nilai yang di-set lewat
`.groupaccess` tersimpan di `data/database.json` dan menang atas `.env`.

## 10. Yang tidak berubah

- Chat pribadi owner: tidak terpengaruh gerbang grup; `.asisten` di DM tetap
  hanya untuk owner dan tetap mendapat memori jangka panjang.
- Orang selain owner tidak pernah bisa memakai agent di **chat pribadi**.
- Memori pribadi owner tidak pernah masuk prompt grup, dan member grup tidak bisa
  menulis memori itu.
- Riwayat percakapan agent di grup dipisah per grup (`agent:<jid@g.us>`),
  `.aiclear` untuk `m.chat` seperti sebelumnya.
- Isi `.asisten` tetap disamarkan di `data/logs/command.log` (`[private:N chars]`).

## 11. Test

```bash
npm run test:group    # gerbang akses + rute + approval relay (101 assertion)
npm run test:ai       # Ask AI termasuk blok [K] gerbang grup
npm test              # semuanya
```
