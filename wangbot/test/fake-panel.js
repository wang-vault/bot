// Fake Pterodactyl Application API + fake website, untuk menguji command monitoring
const http = require('http')

const NODES = {
  data: [
    {
      object: 'node',
      attributes: {
        id: 1, name: 'NODE-JKT-01', fqdn: 'node1.wangstore.id', location_id: 1,
        memory: 32768, memory_overallocate: 0, disk: 512000, disk_overallocate: 0,
        cpu: 800, cpu_overallocate: 0, maintenance_mode: false,
        allocated_resources: { memory: 16384, disk: 204800, cpu: 400 },
        relationships: { servers: { data: [{}, {}] } },
      },
    },
    {
      object: 'node',
      attributes: {
        id: 2, name: 'NODE-SGP-02', fqdn: 'node2.wangstore.id', location_id: 1,
        memory: 65536, memory_overallocate: 0, disk: 1024000, disk_overallocate: 0,
        cpu: 1600, cpu_overallocate: 0, maintenance_mode: true,
        allocated_resources: { memory: 62000, disk: 990000, cpu: 1500 },
        relationships: { servers: { data: [{}] } },
      },
    },
  ],
}

const SERVERS = {
  data: [
    { attributes: { id: 1, name: 'srv-a', suspended: false } },
    { attributes: { id: 2, name: 'srv-b', suspended: false } },
    { attributes: { id: 3, name: 'srv-c', suspended: true } },
  ],
}

const LOCATIONS = { data: [{ attributes: { id: 1, short: 'jkt' } }] }

const srv = http.createServer((req, res) => {
  const url = req.url.split('?')[0]
  res.setHeader('Content-Type', 'application/json')
  const url0 = req.url.split('?')[0]
  if (url0 === '/') { res.writeHead(200); return res.end('<html>ok</html>') } // website publik, tanpa auth
  if (!/^Bearer .+/.test(req.headers.authorization || '')) {
    res.writeHead(401); return res.end(JSON.stringify({ errors: [{ code: 'Unauthorized' }] }))
  }
  if (url === '/api/application/nodes' || /^\/api\/application\/nodes\/\d+$/.test(url)) {
    if (/^\/api\/application\/nodes\/\d+$/.test(url)) {
      const id = Number(url.split('/').pop())
      const n = NODES.data.find((x) => x.attributes.id === id)
      res.writeHead(200); return res.end(JSON.stringify(n || { errors: [{ code: 'NotFound' }] }))
    }
    res.writeHead(200); return res.end(JSON.stringify(NODES))
  }
  if (url === '/api/application/servers') { res.writeHead(200); return res.end(JSON.stringify(SERVERS)) }
  if (url === '/api/application/locations') { res.writeHead(200); return res.end(JSON.stringify(LOCATIONS)) }
  if (url === '/') { res.writeHead(200); return res.end('<html>ok</html>') }
  res.writeHead(404); res.end(JSON.stringify({ errors: [{ code: 'NotFound' }] }))
})

srv.listen(Number(process.env.PORT || 8791), '0.0.0.0', () => console.log('fake panel on ' + srv.address().port))
