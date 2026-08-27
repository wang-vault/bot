// Fake AI provider: mendukung dua gaya API sekaligus.
//   openai  -> POST /v1/chat/completions            (Authorization: Bearer <key>)
//   gemini  -> POST /v1beta/models/<model>:generateContent?key=<key>
//
// Dipakai test/ai.test.js (in-process) dan bisa dijalankan manual:
//   node test/fake-ai.js          -> http://127.0.0.1:8793
//   AI_API_URL=http://127.0.0.1:8793/v1 AI_API_KEY=test-key AI_MODEL=echo npm start
const http = require('http')

const VALID_KEY = 'test-key'

// Nama model "ajaib" untuk mensimulasikan error provider.
const SPECIAL = {
  err401: (res) => send(res, 401, { error: { message: 'Incorrect API key provided', type: 'invalid_request_error' } }),
  err404: (res) => send(res, 404, { error: { message: 'The model `x` does not exist' } }),
  err429: (res) => send(res, 429, { error: { message: 'Rate limit reached' } }),
  err500: (res) => send(res, 500, { error: { message: 'Internal server error' } }),
  err400: (res) => send(res, 400, { error: { message: 'temperature must be <= 2' } }),
  empty: (res) => send(res, 200, { choices: [{ message: { role: 'assistant', content: '' } }] }),
}

// Model "ketat" ala OpenAI generasi baru: menolak max_tokens lalu temperature,
// dan baru mau menjawab kalau keduanya sudah dibuang/diganti.
function strictHandler(res, body) {
  if (body && body.max_tokens !== undefined) {
    return send(res, 400, {
      error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.", type: 'invalid_request_error' },
    })
  }
  if (body && body.temperature !== undefined) {
    return send(res, 400, { error: { message: "Unsupported value: 'temperature' does not support 0.7", type: 'invalid_request_error' } })
  }
  return send(res, 200, {
    choices: [{ index: 0, message: { role: 'assistant', content: `strict:${lastUserTextOpenAI(body)}:${body.max_completion_tokens}` }, finish_reason: 'stop' }],
  })
}

function send(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(obj))
}

function lastUserTextOpenAI(body) {
  const users = (body.messages || []).filter((x) => x.role === 'user')
  return users.length ? String(users[users.length - 1].content) : ''
}

function lastUserTextGemini(body) {
  const users = (body.contents || []).filter((x) => x.role === 'user')
  const last = users[users.length - 1]
  return last ? (last.parts || []).map((p) => p.text).join('') : ''
}

function createServer(state) {
  return http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const path = req.url.split('?')[0]

      // Endpoint introspeksi untuk test (tidak ikut tercatat sebagai request AI).
      if (path === '/__requests') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify(state.requests))
      }
      if (path === '/__reset') {
        state.requests.length = 0
        res.writeHead(200)
        return res.end('ok')
      }

      let body = null
      try {
        body = JSON.parse(raw)
      } catch (_) {}
      const rec = { method: req.method, url: req.url, headers: req.headers, body, raw }
      state.requests.push(rec)

      // ---- Google Gemini ----
      const gm = path.match(/^\/v1beta\/models\/([^/]+):generateContent$/)
      if (gm) {
        const query = new URL('http://x' + req.url).searchParams
        const model = decodeURIComponent(gm[1])
        if (SPECIAL[model]) return SPECIAL[model](res)
        if (query.get('key') !== VALID_KEY) {
          return send(res, 401, { error: { code: 401, message: 'API key not valid', status: 'UNAUTHENTICATED' } })
        }
        const text = `gemini:${model}:${lastUserTextGemini(body)}`
        return send(res, 200, { candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }] })
      }

      // ---- OpenAI compatible ----
      if (path === '/v1/chat/completions' || path === '/chat/completions') {
        const auth = req.headers.authorization || ''
        if (!/^Bearer .+/.test(auth)) return send(res, 401, { error: { message: 'Missing API key' } })
        if (auth.replace(/^Bearer\s+/, '') !== VALID_KEY) {
          return send(res, 401, { error: { message: 'Incorrect API key provided' } })
        }
        const model = body && body.model
        if (model === 'strict') return strictHandler(res, body)
        if (SPECIAL[model]) return SPECIAL[model](res)
        const text = `echo:${model}:${lastUserTextOpenAI(body)}`
        return send(res, 200, {
          id: 'chatcmpl-fake',
          object: 'chat.completion',
          model,
          choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        })
      }

      if (path === '/models' || path === '/v1/models') {
        return send(res, 200, { data: [{ id: 'echo' }, { id: 'err401' }] })
      }

      return send(res, 404, { error: { message: 'Not found: ' + path } })
    })
  })
}

/** Mulai server di port acak. Mengembalikan { url, port, requests, stop() }. */
function start(port = 0) {
  const state = { requests: [] }
  const server = createServer(state)
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const { port: p } = server.address()
      resolve({
        url: `http://127.0.0.1:${p}`,
        port: p,
        requests: state.requests,
        stop: () => new Promise((r) => server.close(() => r())),
      })
    })
  })
}

module.exports = { start, createServer, VALID_KEY }

if (require.main === module) {
  const PORT = Number(process.env.PORT || 8793)
  start(PORT).then((s) => {
    console.log(`[fake-ai] mendengarkan ${s.url}`)
    console.log(`  openai : ${s.url}/v1/chat/completions   (key: ${VALID_KEY}, model: apa saja)`)
    console.log(`  gemini : ${s.url}/v1beta/models/<model>:generateContent?key=${VALID_KEY}`)
    console.log(`  model khusus untuk simulasi error: ${Object.keys(SPECIAL).join(', ')}, strict`)
  })
}
