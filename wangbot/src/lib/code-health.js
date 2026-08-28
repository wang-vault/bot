const fs = require('fs')
const path = require('path')
const vm = require('vm')
const crypto = require('crypto')
const { spawn } = require('child_process')

const SOURCE_DIRS = ['src']
const ROOT_FILES = ['index.js', 'ecosystem.config.js']
const SKIP_DIRS = new Set(['.git', 'node_modules', 'data', 'coverage', 'dist', 'build'])

function walkJs(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walkJs(full, out)
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full)
  }
  return out
}

function sourceFiles(root) {
  const files = []
  for (const file of ROOT_FILES) {
    const full = path.join(root, file)
    if (fs.existsSync(full)) files.push(full)
  }
  for (const dir of SOURCE_DIRS) walkJs(path.join(root, dir), files)
  return [...new Set(files)].sort()
}

function rel(root, file) {
  return path.relative(root, file).replace(/\\/g, '/') || path.basename(file)
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length
}

function parseSyntax(file, code) {
  try {
    const clean = code.replace(/^#![^\n]*\n/, '\n')
    // CommonJS membungkus setiap modul dalam fungsi. Meniru wrapper tersebut
    // mencegah false-positive untuk syntax yang sah di modul CommonJS.
    new vm.Script(`(function (exports, require, module, __filename, __dirname) {\n${clean}\n})`, {
      filename: file,
      displayErrors: true,
    })
    return null
  } catch (e) {
    const stack = String(e && e.stack || '')
    const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const hit = stack.match(new RegExp(`${escaped}:(\\d+)(?::(\\d+))?`))
    const wrappedLine = hit ? Number(hit[1]) : Number(e && e.lineNumber || 0)
    return {
      line: wrappedLine > 1 ? wrappedLine - 1 : wrappedLine || undefined,
      detail: String(e && e.message || e),
    }
  }
}

function localTargetExists(fromFile, request) {
  const base = path.resolve(path.dirname(fromFile), request)
  const candidates = [base, `${base}.js`, `${base}.json`, path.join(base, 'index.js'), path.join(base, 'package.json')]
  return candidates.some((candidate) => {
    try {
      return fs.statSync(candidate).isFile()
    } catch (_) {
      return false
    }
  })
}

// Masker kecil untuk light-lint. Newline dipertahankan agar nomor baris tetap
// benar. Ini bukan parser JS penuh, tetapi mencegah kata "logger.error" di
// komentar/string dianggap sebagai pemanggilan sungguhan.
function maskCommentsAndStrings(code) {
  const chars = [...String(code)]
  let state = 'code'
  let escaped = false
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    const next = chars[i + 1]
    if (state === 'line') {
      if (ch === '\n') state = 'code'
      else chars[i] = ' '
      continue
    }
    if (state === 'block') {
      if (ch === '*' && next === '/') {
        chars[i] = chars[i + 1] = ' '
        i++
        state = 'code'
      } else if (ch !== '\n') chars[i] = ' '
      continue
    }
    if (state === 'single' || state === 'double' || state === 'template') {
      if (ch === '\n' && state !== 'template') state = 'code'
      if (escaped) {
        escaped = false
        if (ch !== '\n') chars[i] = ' '
        continue
      }
      if (ch === '\\') {
        escaped = true
        chars[i] = ' '
        continue
      }
      const end = state === 'single' ? "'" : state === 'double' ? '"' : '`'
      chars[i] = ch === '\n' ? '\n' : ' '
      if (ch === end) state = 'code'
      continue
    }
    if (ch === '/' && next === '/') {
      chars[i] = chars[i + 1] = ' '
      i++
      state = 'line'
    } else if (ch === '/' && next === '*') {
      chars[i] = chars[i + 1] = ' '
      i++
      state = 'block'
    } else if (ch === "'") {
      chars[i] = ' '
      state = 'single'
    } else if (ch === '"') {
      chars[i] = ' '
      state = 'double'
    } else if (ch === '`') {
      chars[i] = ' '
      state = 'template'
    }
  }
  return chars.join('')
}

// Temukan hanya require('literal') yang benar-benar berada di code, bukan teks
// contoh di dalam komentar/string lain.
function staticRequires(code) {
  const found = []
  const raw = String(code)
  const masked = maskCommentsAndStrings(raw)
  const token = /\brequire\s*\(/g
  let hit
  while ((hit = token.exec(masked))) {
    let i = hit.index + hit[0].length
    while (/\s/.test(raw[i] || '')) i++
    const quote = raw[i]
    if (quote !== "'" && quote !== '"') continue
    const start = i
    i++
    let value = ''
    let escaped = false
    for (; i < raw.length; i++) {
      const ch = raw[i]
      if (escaped) {
        value += ch
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === quote) {
        found.push({ request: value, index: hit.index, literalIndex: start })
        break
      } else {
        value += ch
      }
    }
  }
  return found
}

function scanSource(root) {
  const files = sourceFiles(root)
  const issues = []
  for (const file of files) {
    let code
    try {
      code = fs.readFileSync(file, 'utf8')
    } catch (e) {
      issues.push({
        id: `read:${rel(root, file)}`,
        severity: 'error',
        title: 'Source tidak dapat dibaca',
        file: rel(root, file),
        detail: e.message,
      })
      continue
    }

    const syntax = parseSyntax(file, code)
    if (syntax) {
      issues.push({
        id: `syntax:${rel(root, file)}:${syntax.line || 0}`,
        severity: 'error',
        title: 'Syntax JavaScript tidak valid',
        file: rel(root, file),
        line: syntax.line,
        detail: syntax.detail,
        hint: `Jalankan: node --check ${rel(root, file)}`,
      })
      // Tetap lanjut mencari require rusak agar laporan sekali jalan lengkap.
    }

    for (const required of staticRequires(code)) {
      if (!required.request.startsWith('.')) continue
      if (!localTargetExists(file, required.request)) {
        issues.push({
          id: `require:${rel(root, file)}:${required.request}`,
          severity: 'error',
          title: 'Target require lokal tidak ditemukan',
          file: rel(root, file),
          line: lineOf(code, required.index),
          detail: `require('${required.request}') tidak mengarah ke file yang ada.`,
        })
      }
    }

    // Pemeriksaan ringan untuk bug umum yang pernah terjadi di project ini:
    // logger.error dipanggil di callback, tetapi modul logger lupa di-import.
    const executable = maskCommentsAndStrings(code)
    if (/\blogger\s*\./.test(executable)) {
      const declared =
        /\b(?:const|let|var)\s+logger\b/.test(executable) ||
        /\bfunction\s+logger\b/.test(executable) ||
        /\bfunction\b[^()]*\([^)]*\blogger\b[^)]*\)/.test(executable) ||
        /\([^)]*\blogger\b[^)]*\)\s*=>/.test(executable)
      if (!declared) {
        const idx = executable.search(/\blogger\s*\./)
        issues.push({
          id: `undefined-logger:${rel(root, file)}`,
          severity: 'error',
          title: 'logger dipakai tanpa deklarasi/import',
          file: rel(root, file),
          line: lineOf(code, idx),
          detail: 'Pemanggilan logger.* akan menghasilkan ReferenceError saat jalur ini dieksekusi.',
          hint: "Tambahkan: const logger = require('../../lib/logger') (sesuaikan path).",
        })
      }
    }
  }
  return { files, issues }
}

function commandFiles(root) {
  return walkJs(path.join(root, 'src', 'commands')).filter((file) => path.basename(file) !== 'index.js')
}

function scanCommands(root, loader) {
  const issues = []
  const expected = commandFiles(root)
  const commands = loader && Array.isArray(loader.commands) ? loader.commands : []
  const diagnostics = loader && Array.isArray(loader.diagnostics) ? loader.diagnostics : []

  for (const item of diagnostics) {
    // Konflik dihitung ulang di bawah dengan informasi kedua pemilik token,
    // sehingga di sini cukup masukkan load-error dan jangan laporkan duplikat.
    if (item.type !== 'load-error') continue
    const detailHash = crypto.createHash('sha256').update(String(item.message || '')).digest('hex').slice(0, 8)
    issues.push({
      id: `loader:load-error:${item.file || item.name || 'unknown'}:${detailHash}`,
      severity: 'error',
      title: 'Command gagal dimuat',
      file: item.file,
      detail: item.message || JSON.stringify(item),
    })
  }

  if (expected.length !== commands.length) {
    issues.push({
      id: `command-count:${expected.length}:${commands.length}`,
      severity: 'error',
      title: 'Jumlah command termuat tidak sesuai file',
      detail: `Ditemukan ${expected.length} file command, tetapi hanya ${commands.length} command berhasil dimuat.`,
      hint: 'Periksa load-error dan dependency yang belum terpasang.',
    })
  }

  const tokenOwner = new Map()
  for (const cmd of commands) {
    const file = cmd.file || `src/commands/${cmd.category || '?'}/${cmd.name || '?'}.js`
    if (!cmd.name || typeof cmd.run !== 'function') {
      issues.push({
        id: `command-shape:${file}`,
        severity: 'error',
        title: 'Struktur command tidak valid',
        file,
        detail: 'Command wajib memiliki name dan fungsi run.',
      })
      continue
    }
    if (!cmd.desc) {
      issues.push({
        id: `command-desc:${cmd.name}`,
        severity: 'warning',
        title: 'Command tidak mempunyai deskripsi',
        file,
        detail: `Command ${cmd.name} tidak akan jelas di menu.`,
      })
    }
    const tokens = [{ value: cmd.name, kind: 'name' }, ...(cmd.aliases || []).map((value) => ({ value, kind: 'alias' }))]
    const local = new Set()
    for (const token of tokens) {
      const value = String(token.value || '').toLowerCase().trim()
      if (!value) continue
      if (local.has(value)) {
        issues.push({
          id: `command-local-dupe:${cmd.name}:${value}`,
          severity: 'warning',
          title: 'Alias command berulang',
          file,
          detail: `${cmd.name} mendaftarkan "${value}" lebih dari sekali.`,
        })
        continue
      }
      local.add(value)
      const previous = tokenOwner.get(value)
      if (previous && (previous.name !== cmd.name || previous.file !== file)) {
        issues.push({
          id: `command-dupe:${value}:${previous.file}:${file}`,
          severity: 'error',
          title: 'Nama/alias command bentrok',
          file,
          detail: `"${value}" dimiliki ${previous.name} (${previous.kind}) dan ${cmd.name} (${token.kind}).`,
        })
      } else if (!previous) {
        tokenOwner.set(value, { name: cmd.name, kind: token.kind, file })
      }
    }
  }

  return { expected: expected.length, loaded: commands.length, issues }
}

function scanRuntime(root, db) {
  const issues = []
  const mem = process.memoryUsage()
  const rssMB = Math.round(mem.rss / 1024 / 1024)
  const heapMB = Math.round(mem.heapUsed / 1024 / 1024)
  const configuredRss = Number(process.env.ASSISTANT_MEMORY_WARN_MB || 350)
  const maxRss = Math.max(128, Number.isFinite(configuredRss) ? configuredRss : 350)
  if (rssMB >= maxRss) {
    issues.push({
      id: `runtime-memory-high:${Math.floor(rssMB / 50)}`,
      severity: 'warning',
      title: 'Pemakaian memori bot tinggi',
      detail: `RSS ${rssMB} MB melewati ambang ${maxRss} MB.`,
      hint: 'Periksa kebocoran cache/listener atau naikkan ASSISTANT_MEMORY_WARN_MB jika memang normal.',
    })
  }

  let dbBytes = 0
  if (db && db.data) {
    try {
      const serialized = JSON.stringify(db.data)
      dbBytes = Buffer.byteLength(serialized)
      if (dbBytes > 10 * 1024 * 1024) {
        issues.push({
          id: `database-large:${Math.floor(dbBytes / 1024 / 1024)}`,
          severity: 'warning',
          title: 'Database JSON mulai terlalu besar',
          detail: `Ukuran data sekitar ${(dbBytes / 1024 / 1024).toFixed(1)} MB.`,
          hint: 'Arsipkan data lama dan periksa koleksi yang tumbuh tanpa batas.',
        })
      }
    } catch (e) {
      issues.push({
        id: 'database-not-serializable',
        severity: 'error',
        title: 'Database tidak dapat diserialisasi',
        detail: e.message,
      })
    }

    const owners = new Set([
      ...((require('../config').envOwners) || []),
      ...((db.data.owners) || []),
    ])
    if (!owners.size) {
      issues.push({
        id: 'security-no-owner',
        severity: 'error',
        title: 'Bot tidak mempunyai owner',
        detail: 'OWNER_NUMBER kosong dan database tidak memiliki owner tambahan.',
        hint: 'Isi OWNER_NUMBER di .env sebelum mengekspos bot.',
      })
    }
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    const wanted = String(pkg.engines && pkg.engines.node || '')
    const min = Number((wanted.match(/(\d+)/) || [])[1] || 0)
    const current = Number(process.versions.node.split('.')[0])
    if (min && current < min) {
      issues.push({
        id: `node-version:${current}:${min}`,
        severity: 'error',
        title: 'Versi Node.js terlalu lama',
        detail: `Berjalan di Node ${process.version}, sedangkan package membutuhkan ${wanted}.`,
      })
    }
  } catch (e) {
    issues.push({ id: 'package-json', severity: 'error', title: 'package.json tidak valid/terbaca', detail: e.message })
  }

  return { rssMB, heapMB, dbBytes, issues }
}

function redact(text) {
  return String(text || '')
    .replace(/\b(sk-[a-z0-9_-]{8,}|gsk_[a-z0-9_-]{8,}|AIza[a-z0-9_-]{8,})\b/gi, '[SECRET]')
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s]+/gi, '$1[SECRET]')
    .replace(/(api[_-]?key|token|password)(\s*[:=]\s*)[^\s]+/gi, '$1$2[SECRET]')
}

function runTests(root, timeoutMs = 180000) {
  return new Promise((resolve) => {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    const child = spawn(npm, ['test'], {
      cwd: root,
      env: { ...process.env, NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    let killed = false
    const append = (chunk) => {
      // Simpan bagian paling akhir—di sanalah test runner biasanya menaruh
      // stack trace/ringkasan kegagalan—tanpa membiarkan buffer tumbuh liar.
      output = (output + chunk.toString()).slice(-240000)
    }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.on('error', (e) => resolve({ ok: false, code: null, durationMs: 0, output: redact(e.message), error: e.message }))
    const started = Date.now()
    const timer = setTimeout(() => {
      killed = true
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 3000).unref()
    }, timeoutMs)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        ok: code === 0 && !killed,
        code,
        timedOut: killed,
        durationMs: Date.now() - started,
        output: redact(output).slice(-12000),
      })
    })
  })
}

function fingerprint(issues) {
  const stable = issues
    .filter((issue) => issue.severity === 'error' || issue.severity === 'warning')
    .map((issue) => issue.id)
    .sort()
    .join('|')
  return stable ? crypto.createHash('sha256').update(stable).digest('hex').slice(0, 16) : 'healthy'
}

async function run(options = {}) {
  const root = path.resolve(options.root || path.join(__dirname, '..', '..'))
  const started = Date.now()
  const source = scanSource(root)
  const commands = scanCommands(root, options.loader)
  const runtime = scanRuntime(root, options.db)
  const issues = [...source.issues, ...commands.issues, ...runtime.issues]
  let tests = null

  if (options.deep) {
    tests = await runTests(root, Math.max(10000, Number(options.timeoutMs || 180000)))
    if (!tests.ok) {
      const tail = tests.output.split('\n').filter(Boolean).slice(-8).join('\n').slice(0, 1600)
      const testSignature = crypto.createHash('sha256').update(tail || tests.error || '').digest('hex').slice(0, 10)
      issues.push({
        id: `tests-failed:${tests.timedOut ? 'timeout' : tests.code}:${testSignature}`,
        severity: 'error',
        title: tests.timedOut ? 'Test suite timeout' : 'Test suite gagal',
        detail: tail || tests.error || `npm test keluar dengan kode ${tests.code}`,
        hint: 'Jalankan npm test di server untuk melihat output lengkap.',
      })
    }
  }

  const errors = issues.filter((issue) => issue.severity === 'error').length
  const warnings = issues.filter((issue) => issue.severity === 'warning').length
  const report = {
    at: Date.now(),
    root,
    durationMs: Date.now() - started,
    deep: !!options.deep,
    ok: errors === 0 && warnings === 0,
    errors,
    warnings,
    issues,
    source: { files: source.files.length },
    commands: { expected: commands.expected, loaded: commands.loaded },
    runtime: { rssMB: runtime.rssMB, heapMB: runtime.heapMB, dbBytes: runtime.dbBytes },
    tests,
  }
  report.fingerprint = fingerprint(report.issues)
  return report
}

function icon(severity) {
  return severity === 'error' ? '🔴' : severity === 'warning' ? '🟡' : 'ℹ️'
}

function format(report, options = {}) {
  const title = options.title || 'SELF-CHECK WANGBOT'
  let text = `🛡️ *${title}*\n\n`
  text += `Status   : ${report.ok ? '✅ SEHAT' : report.errors ? '🔴 BERMASALAH' : '🟡 PERLU PERHATIAN'}\n`
  text += `Source   : ${report.source.files} file JavaScript\n`
  text += `Command  : ${report.commands.loaded}/${report.commands.expected} termuat\n`
  text += `Runtime  : RSS ${report.runtime.rssMB} MB | Heap ${report.runtime.heapMB} MB\n`
  text += `Database : ${(report.runtime.dbBytes / 1024).toFixed(1)} KB\n`
  text += `Durasi   : ${(report.durationMs / 1000).toFixed(2)} detik\n`
  if (report.deep) {
    text += `Test     : ${report.tests && report.tests.ok ? `✅ LULUS (${(report.tests.durationMs / 1000).toFixed(1)}s)` : '❌ GAGAL'}\n`
  } else {
    text += 'Test     : tidak dijalankan (pakai `selfcheck deep`)\n'
  }
  text += `Temuan   : ${report.errors} error, ${report.warnings} peringatan\n`

  if (!report.issues.length) {
    text += '\n✅ Tidak ditemukan syntax rusak, require lokal hilang, konflik command, atau masalah runtime utama.'
  } else {
    text += '\n*DETAIL TEMUAN*\n'
    for (const issue of report.issues.slice(0, options.maxIssues || 10)) {
      const location = issue.file ? ` — ${issue.file}${issue.line ? ':' + issue.line : ''}` : ''
      text += `\n${icon(issue.severity)} *${issue.title}*${location}\n`
      if (issue.detail) text += `${String(issue.detail).replace(/\s+/g, ' ').slice(0, 500)}\n`
      if (issue.hint) text += `Solusi: ${String(issue.hint).replace(/\s+/g, ' ').slice(0, 350)}\n`
    }
    if (report.issues.length > (options.maxIssues || 10)) {
      text += `\n… ${report.issues.length - (options.maxIssues || 10)} temuan lain tidak ditampilkan.`
    }
  }
  text += `\n\nID laporan: \`${report.fingerprint}\` | ${new Date(report.at).toLocaleString('id-ID')}`
  return text.slice(0, 3900)
}

module.exports = {
  sourceFiles,
  scanSource,
  scanCommands,
  scanRuntime,
  runTests,
  run,
  format,
  fingerprint,
  redact,
}
