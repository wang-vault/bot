# 🧠 Ask AI — Panduan Konfigurasi

Fitur **Ask AI** (`.ai`) meneruskan pertanyaan user ke penyedia AI pilihanmu. Bot
**tidak dikunci ke satu vendor**: yang bot butuhkan hanya tiga hal.

| Yang dibutuhkan | Contoh | Keterangan |
|---|---|---|
| **URL endpoint** | `https://api.openai.com/v1` | Base URL API, biasanya diakhiri `/v1` |
| **API key** | `sk-xxxxxxxx` | Key dari penyedia AI kamu |
| **Nama model** | `gpt-4o-mini` | Nama model persis seperti di dokumentasi penyedia |

Sisanya (provider, system prompt, temperature, timeout, memori, header tambahan)
opsional dan sudah punya nilai bawaan.

---

## 1. Dua cara mengisi konfigurasi

### A. Lewat `.env` (perlu restart)

```env
AI_API_URL=https://api.groq.com/openai/v1
AI_API_KEY=gsk_xxxxxxxxxxxx
AI_MODEL=llama-3.3-70b-versatile
```

### B. Lewat WhatsApp (tanpa restart) — disarankan

Kirim ke bot **dari nomor owner**:

```
.aiset api https://api.groq.com/openai/v1
.aiset key gsk_xxxxxxxxxxxx
.aiset model llama-3.3-70b-versatile
.aiset test
```

Nilai yang di-set lewat `.aiset` disimpan di `data/database.json` dan **menang**
atas `.env`. Mau kembali ke `.env`? `.aiset reset`.

> 🔐 API key disimpan sebagai teks biasa di `data/database.json` (sama seperti
> Client API token di fitur Minecraft). Jaga file itu, jangan di-commit.
> Di chat dan di log, key selalu ditampilkan tersamar (`gsk_***xx`).

---

## 2. Resep per penyedia

### OpenAI
```
.aiset api https://api.openai.com/v1
.aiset key sk-xxxxxxxx
.aiset model gpt-4o-mini
```
Model generasi baru yang menolak `max_tokens`/`temperature` ditangani otomatis
(bot mencoba ulang dengan `max_completion_tokens`).

### Groq (cepat, ada free tier)
```
.aiset api https://api.groq.com/openai/v1
.aiset key gsk_xxxxxxxx
.aiset model llama-3.3-70b-versatile
```

### OpenRouter (ratusan model dalam satu key)
```
.aiset api https://openrouter.ai/api/v1
.aiset key sk-or-xxxxxxxx
.aiset model openai/gpt-4o-mini
.aiset header set HTTP-Referer https://wangstore.id
.aiset header set X-Title WangBot
```
Header juga bisa lewat `.env`: `AI_EXTRA_HEADERS={"HTTP-Referer":"https://wangstore.id"}`.

### Google Gemini (AI Studio)
```
.aiset api https://generativelanguage.googleapis.com/v1beta
.aiset key AIzaxxxxxxxx
.aiset model gemini-2.0-flash
```
Provider ditebak otomatis dari URL. Kalau kamu memakai **proxy Gemini non-Google**,
set manual: `.aiset provider gemini`.

### DeepSeek
```
.aiset api https://api.deepseek.com/v1
.aiset key sk-xxxxxxxx
.aiset model deepseek-chat
```

### Mistral
```
.aiset api https://api.mistral.ai/v1
.aiset key xxxxxxxx
.aiset model mistral-small-latest
```

### Ollama / LM Studio di server sendiri (tanpa biaya API)
```
.aiset api http://127.0.0.1:11434/v1
.aiset key ollama
.aiset model llama3.2
```
`AI_API_KEY` tetap wajib diisi walaupun server lokal tidak memeriksanya — isi apa
saja, misal `ollama`. Untuk LM Studio biasanya `http://127.0.0.1:1234/v1`.

---

## 3. Daftar command

| Command | Hak | Fungsi |
|---|---|---|
| `.ai <pertanyaan>` | semua | Tanya AI. Bisa juga me-reply sebuah pesan lalu kirim `.ai` |
| `.ai` | semua | Bantuan + status singkat |
| `.aiclear` | semua | Lupakan obrolan sebelumnya di chat itu |
| `.aiset status` | owner | Lihat seluruh konfigurasi (key tersamar) + statistik pemakaian |
| `.aiset api <url>` | owner | Set base URL / endpoint |
| `.aiset key <apikey>` | owner | Set API key |
| `.aiset model <nama>` | owner | Set nama model |
| `.aiset provider openai\|gemini\|auto` | owner | Paksa gaya API |
| `.aiset system <teks>` | owner | Peran/gaya jawaban AI (boleh multi-baris) |
| `.aiset temp <0-2>` | owner | Temperature (kreativitas) |
| `.aiset maxtokens <n>` | owner | Batas panjang jawaban |
| `.aiset timeout <detik>` | owner | Batas tunggu jawaban |
| `.aiset history <0-40>` | owner | Jumlah pesan riwayat yang dibawa (`0` = tanpa memori) |
| `.aiset maxchars <n>` | owner | Panjang pertanyaan maksimum |
| `.aiset header set/del <Nama> [nilai]` | owner | Header tambahan |
| `.aiset group on\|off` | owner | Boleh/tidak dipakai di grup |
| `.aiset on\|off` | owner | Nyalakan/matikan seluruh fitur |
| `.aiset test` | owner | Uji koneksi ke provider sekarang |
| `.aiset reset` | owner | Hapus override, kembali ke `.env` |

Alias `.ai`: `.ask`, `.askai`, `.tanya`, `.gpt`, `.chatgpt`.

---

## 4. Pengaturan opsional (`.env`)

| Variabel | Bawaan | Keterangan |
|---|---|---|
| `AI_PROVIDER` | `auto` | `openai`, `gemini`, atau `auto` (ditebak dari URL) |
| `AI_SYSTEM_PROMPT` | prompt WangStore | Peran AI. Kosongkan → pakai bawaan |
| `AI_TEMPERATURE` | `0.7` | 0 = kaku/faktual, 2 = kreatif |
| `AI_MAX_TOKENS` | `700` | Batas panjang jawaban (± 500 kata) |
| `AI_TIMEOUT` | `30` | Detik. `< 1000` dianggap detik, selain itu milidetik |
| `AI_HISTORY` | `6` | Pesan riwayat per chat (disimpan di memori, TTL 30 menit) |
| `AI_MAX_CHARS` | `1500` | Tolak pertanyaan super panjang (hemat biaya) |
| `AI_ENABLED` | `1` | `0` = matikan `.ai` |
| `AI_ALLOW_GROUP` | `1` | `0` = `.ai` hanya di chat pribadi |
| `AI_EXTRA_HEADERS` | — | JSON header tambahan |

Setiap nilai punya tiga sumber dengan urutan prioritas:
**database (`.aiset`) → `.env` → bawaan**. `.aiset status` menunjukkan asal tiap
nilai (`db` / `env` / `default`).

---

## 5. Keamanan & biaya

- **Owner only**: semua `.aiset` ditolak untuk non-owner (dipaksa oleh handler).
- **Log disamarkan**: argumen `.aiset`, `.mcrcon`, dan `.mclink` tidak ditulis apa
  adanya ke `data/logs/*_command.log`.
- **Rate limit**: `.ai` punya cooldown 8 detik per user + rate limit global bot
  (25 command/menit/user).
- **Batas biaya**: `AI_MAX_CHARS` memotong pertanyaan panjang, `AI_MAX_TOKENS`
  memotong jawaban, `AI_HISTORY` membatasi konteks yang dikirim.
- **Matikan di grup** kalau tidak mau member memakai kuota AI-mu:
  `.aiset group off`.

---

## 6. Troubleshooting

| Gejala | Sebab & solusi |
|---|---|
| `Ask AI belum dikonfigurasi` | Isi `api`, `key`, dan `model` (lihat bagian 1) |
| `API key ditolak (HTTP 401/403)` | Key salah/salah salin, atau key untuk produk lain (mis. Gemini AI Studio vs Vertex) |
| `Endpoint/model tidak ditemukan (404)` | Nama model salah ketik, atau URL kurang `/v1`. Coba `.aiset status` lalu `.aiset test` |
| `Kuota / rate limit habis (429)` | Free tier penyedia habis — ganti model/penyedia atau tambah saldo |
| `Provider tidak menjawab (timeout)` | Naikkan `.aiset timeout 60`, atau model memang lambat |
| `Gagal menghubungi <url>` | URL salah / server bot tidak bisa keluar internet / port diblokir firewall |
| `Provider membalas kosong` | Model mengembalikan respons kosong (filter konten). Coba model lain |
| Jawaban terasa "bukan WangStore" | Ubah peran: `.aiset system Kamu adalah CS WangStore...` |

Perintah diagnostik tercepat: **`.aiset status`** lalu **`.aiset test`**.
