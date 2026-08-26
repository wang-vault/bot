// Fake Pterodactyl CLIENT API (/api/client) — dipakai untuk menguji
// monitoring per-server Minecraft (resource, power, console) tanpa panel asli.
//
//   const fake = await require('./fake-client-panel')()
//   fake.state.resources.memory_bytes = ...   // ubah angka yang dikembalikan
//   fake.log.power                          // signal yang masuk
//   fake.server.close()
const http = require('http')

const ALLOCATIONS = {
  data: [
    { attributes: { id: 10, ip: '127.0.0.1', ip_alias: null, port: 25565, is_default: true } },
    { attributes: { id: 11, ip: '127.0.0.1', ip_alias: null, port: 25575, is_default: false } },
  ],
}

function makeState(mcPort) {
  return {
    token: 'ptlc_fakeclienttoken',
    servers: [
      {
        attributes: {
          identifier: 'abcd1234',
          uuid: 'abcd1234-0000-0000-0000-000000000000',
          name: 'Survival',
          description: 'Server survival pelanggan',
          node: 'node1.wangstore.id',
          status: null,
          is_suspended: false,
          owner: 'owner-uuid-1',
          sftp_details: { ip: '127.0.0.1', port: 2022 },
          limits: { memory: 4096, disk: 20480, cpu: 200 },
          relationships: {
            allocations: {
              data: [
                { attributes: { id: 10, ip: '127.0.0.1', ip_alias: null, port: mcPort, is_default: true } },
                { attributes: { id: 11, ip: '127.0.0.1', ip_alias: null, port: 25575, is_default: false } },
              ],
            },
          },
        },
      },
      {
        attributes: {
          identifier: 'efgh5678',
          uuid: 'efgh5678-0000-0000-0000-000000000000',
          name: 'Creative',
          description: '',
          node: 'node1.wangstore.id',
          status: null,
          is_suspended: false,
          owner: 'owner-uuid-1',
          limits: { memory: 2048, disk: 10240, cpu: 100 },
          relationships: { allocations: ALLOCATIONS },
        },
      },
    ],
    resources: {
      current_state: 'running',
      is_suspended: false,
      resources: {
        memory_bytes: 3221225472, // 3072 MB
        cpu_absolute: 45.6,
        disk_bytes: 5368709120, // 5120 MB
        uptime: 5400000, // 90 menit
        limits: { memory: 4096, disk: 20480, cpu: 200 },
      },
    },
  }
}

function start(opts = {}) {
  const state = makeState(opts.mcPort || 25565)
  const log = { power: [], requests: [] }

  const srv = http.createServer((req, res) => {
    const url = req.url.split('?')[0]
    log.requests.push(req.method + ' ' + url)
    res.setHeader('Content-Type', 'application/json')

    const auth = req.headers.authorization || ''
    if (auth !== 'Bearer ' + state.token) {
      res.writeHead(401)
      return res.end(JSON.stringify({ errors: [{ code: 'Unauthorized' }] }))
    }

    const send = (obj, code = 200) => {
      res.writeHead(code)
      res.end(obj == null ? '' : JSON.stringify(obj))
    }

    if (url === '/api/client') return send({ data: state.servers })

    let m = url.match(/^\/api\/client\/servers\/([^/]+)$/)
    if (m) {
      const s = state.servers.find((x) => x.attributes.identifier === m[1])
      return s ? send(s) : send({ errors: [{ code: 'NotFound' }] }, 404)
    }

    m = url.match(/^\/api\/client\/servers\/([^/]+)\/resources$/)
    if (m) return send({ attributes: state.resources })

    m = url.match(/^\/api\/client\/servers\/([^/]+)\/power$/)
    if (m) {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        try {
          log.power.push(JSON.parse(body || '{}').signal)
          if (JSON.parse(body || '{}').signal === 'start') state.resources.current_state = 'running'
          if (JSON.parse(body || '{}').signal === 'stop') state.resources.current_state = 'offline'
        } catch (_) {}
        send(null, 204)
      })
      return
    }

    m = url.match(/^\/api\/client\/servers\/([^/]+)\/websocket$/)
    if (m) return send({ data: { socket: 'ws://127.0.0.1:1/ws', token: 'wstok' } })

    res.writeHead(404)
    res.end(JSON.stringify({ errors: [{ code: 'NotFound' }] }))
  })

  return new Promise((resolve) => {
    srv.listen(opts.port || 0, '127.0.0.1', () => {
      resolve({ server: srv, port: srv.address().port, state, log })
    })
  })
}

module.exports = start

if (require.main === module) {
  start({ port: Number(process.env.PORT || 8792) }).then(({ port }) =>
    console.log('fake client panel on ' + port)
  )
}
