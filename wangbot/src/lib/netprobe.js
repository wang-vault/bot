// Probe jaringan keluar: ping ICMP (pakai binary `ping` sistem) + fallback
// TCP connect untuk mengukur latensi ke host/port tertentu.
//
// Kenapa tidak `exec('ping ' + host)` seperti command owner pada umumnya:
// host datang dari chat (bisa juga dari respons model), jadi menconcat string
// ke shell = celah injeksi. Di sini nilai divalidasi ketat dan dieksekusi lewat
// spawn dengan ARGUMEN TERPISAH (tanpa shell), jadi `8.8.8.8; rm -rf /` tidak
// pernah menjadi perintah — paling jauh jadi "host tidak valid".
//
// Fallback TCP penting di container/VPS yang tidak boleh bikin raw socket
// (ping gagal dengan "Operation not permitted"). Dalam keadaan itu latensi
// diukur dari waktu handshake ke port (default 443/80), yang justru lebih
// berguna untuk pelanggan hosting: "port 25565 server MC open atau tidak?".

const { spawn } = require('child_process')
const net = require('net')
const dns = require('dns')

const HOST_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.?$/i
const IPV6_RE = /^[0-9a-f:.]+$/i
const MAX_LEN = 253
const LIMITS = Object.freeze({ count: { min: 1, max: 15, default: 4 }, timeout: { min: 1, max: 8, default: 2 } })

function numEnv(name, fallback) {
  const n = Number(process.env[name])
  return Number.isFinite(n) ? n : fallback
}

function clamp(v, min, max, dflt) {
  const n = Number(v)
  if (!Number.isFinite(n)) return dflt
  return Math.min(max, Math.max(min, Math.round(n)))
}

/**
 * Bersihkan & validasi target. Menerima: `8.8.8.8`, `google.com`,
 * `https://google.com/path`, `mc.tokoSugoi.id:25565`, `[2001:db8::1]:25565`,
 * `google.com 10` (count dipisah dari argumen command).
 * @returns {{ok:boolean, host?:string, port?:number, error?:string, count?:number}}
 */
function parseTarget(input, opts = {}) {
  let raw = String(input || '').trim()
  if (!raw) return { ok: false, error: 'Kosong. Contoh: `ping 8.8.8.8` atau `ping mc.example.com:25565`.' }

  // "host count" / "host 10" -> count diambil dulu
  let count = null
  const m = raw.match(/^(.*?)[\s,]+(\d{1,3})$/)
  if (m) {
    raw = m[1].trim()
    count = Number(m[2])
  }

  // Buang skema/path/whitespace sisa
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    try {
      const u = new URL(raw)
      raw = u.hostname
      if (u.port) raw += `:${u.port}`
    } catch (_) {
      raw = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    }
  }
  raw = raw.replace(/^["'`<]+|["'`>,.;:!?\s]+$/g, '')
  raw = raw.split('/')[0]

  let host = raw
  let port = null
  const bracket = raw.match(/^\[([^\]]+)\](?::(\d{1,5}))?$/)
  if (bracket) {
    host = bracket[1]
    port = bracket[2] ? Number(bracket[2]) : null
  } else if ((raw.match(/:/g) || []).length === 1) {
    const [h, p] = raw.split(':')
    host = h
    if (!/^\d{1,5}$/.test(p || '')) return { ok: false, error: `Port tidak valid: \`${p}\`` }
    port = Number(p)
  } else if (raw.includes(':') && /^\[/.test(raw) === false && IPV6_RE.test(raw)) {
    host = raw // IPv6 polos
  }

  host = String(host || '')
    .trim()
    .replace(/\.$/, '')
    .toLowerCase()
  if (!host) return { ok: false, error: 'Alamat tujuan tidak terbaca.' }
  if (host.length > MAX_LEN) return { ok: false, error: `Alamat terlalu panjang (maks ${MAX_LEN} karakter).` }
  const looksIpv6 = host.includes(':')
  if (looksIpv6) {
    // IPv6: hanya hex/double-colon, lalu serahkan ke resolver sistem.
    if (!/^[0-9a-f:.]+$/.test(host) || (host.match(/::/g) || []).length > 1) {
      return { ok: false, error: `\`${host}\` bukan alamat IPv6 yang sah.` }
    }
  } else if (!HOST_RE.test(host)) {
    return { ok: false, error: `\`${host}\` bukan nama domain/alamat IP yang sah (hanya huruf, angka, titik, dan strip).` }
  }
  if (port !== null && (port < 1 || port > 65535)) return { ok: false, error: `Port ${port} di luar rentang 1-65535.` }

  const dflt = opts.count === undefined ? clamp(numEnv('PING_COUNT', LIMITS.count.default), LIMITS.count.min, maxCount(), LIMITS.count.default) : opts.count
  const finalCount = clamp(count === null ? dflt : count, LIMITS.count.min, maxCount(), dflt)
  return { ok: true, host, port, count: finalCount, ipv6: host.includes(':') }
}

function maxCount() {
  return clamp(numEnv('PING_MAX_COUNT', LIMITS.count.max), LIMITS.count.min, LIMITS.count.max, LIMITS.count.max)
}

function isPrivateAddress(address) {
  // Dipakai hanya untuk memberi label di output (bukan blokir): mendiagnosa
  // jaringan internal justru kasus wajar untuk bot hosting.
  const ip = String(address || '')
  if (/^10\.|^127\.|^169\.254\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true
  if (/^::1$|^fe80:|^fc|^fd/i.test(ip)) return true
  return false
}

function buildArgs(host, { count, timeoutSec, ipv6 }) {
  if (process.platform === 'win32') {
    return ['-n', String(count), '-w', String(Math.round(timeoutSec * 1000)), host]
  }
  const args = ['-c', String(count), '-W', String(Math.max(1, Math.round(timeoutSec)))]
  if (ipv6) args.push('-6')
  return [...args, host]
}

/** Baca output `ping` lintas bahasa/platform: ambil angka `time=..ms`/`waktu=..ms`. */
function parseIcmpOutput(stdout) {
  const out = String(stdout || '')
  const samples = []
  // `time=3.2 ms` (Linux) | `waktu=8ms` (Windows id) | `time<1ms` (< 1 ms).
  // Angka hasil `time<1ms` TIDAK dihitung 1 ms: dipisah lewat pemisah `<`.
  const re = /(?:time|waktu|rtt)\s*([=<])\s*([0-9]+(?:[.,][0-9]+)?)\s*ms/gi
  let mm
  while ((mm = re.exec(out))) {
    if (mm[1] === '<') {
      samples.push(0.5)
      continue
    }
    const v = Number(mm[2].replace(',', '.'))
    if (Number.isFinite(v)) samples.push(v)
  }

  const transmitted = firstNumber(/(\d+)\s+(?:packets?\s+)?(?:transmitted|dikirim|paket\s+dikirim)/i, out)
  const received = firstNumber(/(\d+)\s+(?:received|diterima)/i, out)
  const lossPct = firstNumber(/(\d+(?:[.,]\d+)?)\s*%\s*(?:packet\s+loss|kehilangan)/i, out)
  const ttl = firstNumber(/(?:ttl|hop\s*limit)\s*=\s*(\d+)/i, out)
  const unreachable = /destination host unreachable|host unreachable|no answer|network is unreachable|unreachable| unreachable/i.test(out)
  const unknownHost = /unknown host|name or service not known|nodename nor servname|Temporary failure in name resolution|tidak dikenal|unspecified error|Ping request could not find host/i.test(out)
  const permission = /operation not permitted|perm denied|cannot create raw socket|sendto: operation not permitted|socket: /i.test(out)
  return {
    samples: samples.sort((a, b) => a - b),
    transmitted,
    received: received === null ? samples.length : received,
    lossPct,
    ttl,
    unreachable,
    unknownHost,
    permissionDenied: permission,
  }
}

function firstNumber(re, text) {
  const m = text.match(re)
  if (!m) return null
  const v = Number(String(m[1]).replace(',', '.'))
  return Number.isFinite(v) ? v : null
}

function stats(samples) {
  if (!samples.length) return { min: null, avg: null, max: null, jitter: null, n: 0 }
  const sum = samples.reduce((a, b) => a + b, 0)
  const avg = sum / samples.length
  const variance = samples.reduce((a, b) => a + (b - avg) ** 2, 0) / samples.length
  return {
    min: Number(samples[0].toFixed(2)),
    avg: Number(avg.toFixed(2)),
    max: Number(samples[samples.length - 1].toFixed(2)),
    jitter: Number(Math.sqrt(variance).toFixed(2)),
    n: samples.length,
  }
}

function lookup(host) {
  return new Promise((resolve) => {
    if (/^[0-9.]+$/.test(host) || IPV6_RE.test(host)) {
      return resolve({ ok: true, addresses: [{ address: host, family: host.includes(':') ? 6 : 4 }] })
    }
    dns.lookup(host, { all: true, verbatim: true }, (err, records) => {
      if (err) return resolve({ ok: false, error: err.code || err.message })
      resolve({ ok: true, addresses: records || [] })
    })
  })
}

function pingBin() {
  const custom = String(process.env.PING_BIN || '').trim()
  if (custom) return custom
  return process.platform === 'win32' ? 'ping' : 'ping'
}

/** Jalankan binary ping sistem tanpa shell. */
function pingIcmp(host, opts = {}) {
  const count = opts.count || 4
  const timeoutSec = clamp(opts.timeoutSec, LIMITS.timeout.min, LIMITS.timeout.max, LIMITS.timeout.default)
  const args = buildArgs(host, { count, timeoutSec, ipv6: !!opts.ipv6 })
  const bin = opts.bin || pingBin()
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      resolve({ ok: false, unavailable: true, error: e.message, args, stdout: '', stderr: e.message })
      return
    }
    let stdout = ''
    let stderr = ''
    let killed = null
    const killer = setTimeout(() => {
      killed = 'timeout'
      try {
        child.kill('SIGKILL')
      } catch (_) {}
    }, count * (timeoutSec + 1) * 1000 + 4000)
    killer.unref?.()

    child.stdout.on('data', (c) => (stdout += c.toString()))
    child.stderr.on('data', (c) => (stderr += c.toString()))
    child.on('error', (e) => {
      clearTimeout(killer)
      const unavailable = /ENOENT|EACCES|EPERM/.test(String(e.code || ''))
      resolve({ ok: false, unavailable, error: e.code || e.message, args, stdout, stderr: stderr || e.message })
    })
    child.on('close', (code) => {
      clearTimeout(killer)
      const parsed = parseIcmpOutput(`${stdout}\n${stderr}`)
      const st = stats(parsed.samples)
      const total = parsed.transmitted || count
      const recv = parsed.received === null ? st.n : parsed.received
      const loss = parsed.lossPct !== null ? parsed.lossPct : Math.round(((total - recv) / Math.max(1, total)) * 100)
      resolve({
        ok: st.n > 0,
        method: 'icmp',
        code,
        timedOut: killed === 'timeout',
        unavailable: parsed.permissionDenied && st.n === 0,
        args,
        stdout,
        stderr,
        samples: parsed.samples,
        sent: total,
        received: recv,
        loss,
        ttl: parsed.ttl,
        unknownHost: parsed.unknownHost,
        unreachable: parsed.unreachable,
        ...st,
      })
    })
  })
}

/** Latensi handshake TCP ke host:port (fallback & cek port terbuka). */
function tcpProbe(host, port, opts = {}) {
  const count = opts.count || 4
  const perTry = clamp(opts.timeoutMs, 500, 15000, opts.timeoutMs || 3000)
  return new Promise(async (resolve) => {
    const samples = []
    const errors = []
    for (let i = 0; i < count; i++) {
      const r = await connectOnce(host, port, perTry)
      if (r.ms !== null) samples.push(r.ms)
      else errors.push(r.error)
      if (i < count - 1) await new Promise((res) => setTimeout(res, 120))
    }
    const st = stats(samples.sort((a, b) => a - b))
    resolve({
      ok: samples.length > 0,
      method: 'tcp',
      port,
      samples,
      sent: count,
      received: samples.length,
      loss: Math.round(((count - samples.length) / count) * 100),
      errors: [...new Set(errors)],
      refused: errors.includes('ECONNREFUSED'),
      ...st,
    })
  })
}

function connectOnce(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const t0 = Date.now()
    let done = false
    let socket
    try {
      socket = net.connect({ host, port, family: host.includes(':') ? 6 : 4 })
    } catch (e) {
      resolve({ ms: null, error: e.code || e.message })
      return
    }
    const finish = (result) => {
      if (done) return
      done = true
      clearTimeout(timer)
      socket.destroy()
      resolve(result)
    }
    const timer = setTimeout(() => finish({ ms: null, error: 'timeout' }), timeoutMs)
    timer.unref?.()
    socket.once('connect', () => finish({ ms: Date.now() - t0, error: null }))
    socket.once('error', (e) => finish({ ms: null, error: e.code || e.message }))
  })
}

/**
 * Satu pintu masuk. mode:
 *   auto  -> ICMP, lalu TCP bila ICMP tidak bisa dijalankan (dan port diketahui/diminta)
 *   icmp  -> ICMP saja
 *   tcp   -> TCP saja (pakai port eksplisit, default 443 lalu 80)
 */
async function probe(input, opts = {}) {
  const parsed = parseTarget(input, opts)
  if (!parsed.ok) {
    return { ok: false, invalid: true, error: parsed.error, host: '', dns: [], method: 'none', mode: opts.mode || 'auto' }
  }
  const { host, count, ipv6 } = parsed
  const timeoutSec = clamp(opts.timeoutSec, LIMITS.timeout.min, LIMITS.timeout.max, LIMITS.timeout.default)
  const dnsInfo = await lookup(host)
  const base = {
    host,
    port: parsed.port,
    count,
    ipv6,
    dns: dnsInfo.ok ? dnsInfo.addresses.map((a) => ({ ...a, private: isPrivateAddress(a.address) })) : [],
    dnsError: dnsInfo.ok ? '' : dnsInfo.error,
  }
  const mode = String(opts.mode || 'auto').toLowerCase()

  if (mode !== 'tcp') {
    const icmp = await pingIcmp(host, { count, timeoutSec, ipv6, bin: opts.bin })
    if (icmp.ok || mode === 'icmp' || !dnsInfo.ok || icmp.unknownHost) {
      return { ...base, ...icmp, mode }
    }
  }
  // Fallback / permintaan TCP
  if (!dnsInfo.ok) {
    return { ...base, ok: false, method: 'none', error: `DNS gagal (${dnsInfo.dnsError || dnsInfo.error || 'tidak dikenal'})`, samples: [], mode }
  }
  const ports = parsed.port ? [parsed.port] : [443, 80]
  let last = null
  for (const port of ports) {
    const tcp = await tcpProbe(host, port, { count, timeoutMs: (timeoutSec + 1) * 1000 })
    last = { ...base, ...tcp, mode }
    if (tcp.ok || tcp.refused) break // refused = host hidup, port tertutup -> sudah cukup informatif
  }
  return { ...last, icmpNote: mode === 'auto' ? 'icmp-unavailable' : '' }
}

function verdict(result) {
  if (!result.ok) return { icon: '🔴', label: 'Tidak tercapai' }
  const loss = Number(result.loss || 0)
  const avg = Number(result.avg || 0)
  if (loss >= 100) return { icon: '🔴', label: 'Semua paket hilang (timeout)' }
  if (loss > 0) return { icon: '🟡', label: `Ada ${loss}% packet loss` }
  if (avg < 30) return { icon: '🟢', label: 'Sangat lancar' }
  if (avg < 100) return { icon: '🟢', label: 'Lancar' }
  if (avg < 250) return { icon: '🟡', label: 'Agak lambat' }
  return { icon: '🔴', label: 'Sangat lambat' }
}

/** Teks laporan ringkas untuk chat WhatsApp. */
function format(result, opts = {}) {
  const P = opts.prefix || '.'
  const v = verdict(result)
  const hostLabel = String(result.host || '').trim() || String(result.raw || '').slice(0, 60) || '-'
  const shown = result.port ? `${hostLabel}:${result.port}` : hostLabel
  let t = `${v.icon} *PING ${shown.toUpperCase()}*\n`
  const ips = (result.dns || []).map((a) => a.address + (a.private ? ' (internal)' : '')).join(', ')
  if (result.invalid) return `⚠️ Alamat tujuan ditolak\n\n${result.error}`
  if (result.dns && result.dns.length && result.host !== result.dns[0].address) {
    t += `Resolve  : ${ips}\n`
  } else if (result.dnsError) {
    t += `Resolve  : 🔴 gagal — ${result.dnsError}\n`
  }
  const method = result.method === 'tcp' ? 'TCP connect' : result.method === 'icmp' ? 'ICMP ping' : '—'
  t += `Metode   : ${method}${result.mode === 'auto' && result.icmpNote ? ' (ICMP tidak tersedia di host ini)' : ''}\n`

  if (!result.ok) {
    const why = result.error || (result.unknownHost ? 'nama host tidak dikenal' : result.unreachable ? 'destination unreachable' : result.refused ? 'port tertutup (connection refused)' : 'tidak ada balasan')
    t += `\nHasil    : 🔴 ${why}\n`
    if (result.sent) t += `Paket    : ${result.received}/${result.sent} diterima (${result.loss}% loss)\n`
    if (result.refused) t += `\nℹ️ Host hidup, tapi port ${result.port} tertutup.\n`
    if (opts.hint !== false && result.method !== 'tcp') t += `Coba lagi dengan mode port: \`${P}pingl ${result.host}:443\``
    return t.trim()
  }
  t += `Paket    : ${result.received}/${result.sent} diterima, loss ${result.loss}%\n`
  t += `Latensi  : min *${result.min} ms* · avg *${result.avg} ms* · max ${result.max} ms\n`
  if (result.jitter !== null && result.jitter !== undefined) t += `Jitter   : ±${result.jitter} ms\n`
  if (result.ttl) t += `TTL      : ${result.ttl}\n`
  if (result.samples && result.samples.length <= 10) t += `Sampel   : ${result.samples.map((x) => `${x}ms`).join(' · ')}\n`
  if (result.method === 'tcp') t += `Port     : ${result.port} — 🟢 terbuka\n`
  t += `Status   : ${v.label}`
  return t.trim()
}

module.exports = {
  HOST_RE,
  LIMITS,
  MAX_LEN,
  parseTarget,
  buildArgs,
  parseIcmpOutput,
  stats,
  lookup,
  isPrivateAddress,
  pingIcmp,
  tcpProbe,
  connectOnce,
  probe,
  verdict,
  format,
  pingBin,
}
