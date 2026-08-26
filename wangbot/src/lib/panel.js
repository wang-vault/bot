const config = require('../config')
const logger = require('./logger')

const headers = () => ({
  Authorization: `Bearer ${config.panelApiToken}`,
  Accept: 'application/json',
  'Content-Type': 'application/json',
})

// Terjemahkan kode HTTP panel jadi pesan yang bisa ditindaklanjuti
function friendlyError(status) {
  if (status === 401 || status === 403)
    return `Token ditolak (HTTP ${status}). Gunakan *Application API key* (menu Admin → Application API), BUKAN Client API (Account → API Credentials). Saat membuat key, centang permission: Locations, Nodes, Servers (Read).`
  if (status === 404) return `Endpoint tidak ditemukan (HTTP 404). Cek PANEL_API_URL benar & tanpa slash akhir.`
  if (status >= 500) return `Panel bermasalah (HTTP ${status}). Coba lagi nanti.`
  return `HTTP ${status}`
}

// Format megabyte jadi mudah dibaca (MB -> GB -> TB)
function humanMB(mb) {
  const n = Number(mb) || 0
  if (n <= 0) return '-'
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(2).replace(/\.00$/, '') + ' TB'
  if (n >= 1024) return (n / 1024).toFixed(n % 1024 === 0 ? 0 : 1).replace(/\.0$/, '') + ' GB'
  return Math.round(n) + ' MB'
}

async function _fetch(urlPath) {
  if (!config.panelApiUrl || !config.panelApiToken) return null
  const url = `${config.panelApiUrl}${urlPath}`
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 15000)
  try {
    const res = await fetch(url, { headers: headers(), signal: ctrl.signal })
    if (!res.ok) return { error: friendlyError(res.status), status: res.status }
    return await res.json()
  } catch (e) {
    return { error: e.name === 'AbortError' ? 'timeout' : e.message }
  } finally {
    clearTimeout(t)
  }
}

const Panel = {
  configured() {
    return !!(config.panelApiUrl && config.panelApiToken)
  },

  // Cek kesehatan panel lewat endpoint Application API (kompatibel dgn app token)
  async panelStatus() {
    if (!config.panelApiUrl || !config.panelApiToken) {
      return { ok: false, error: 'PANEL_API_URL / PANEL_API_TOKEN belum diisi di .env' }
    }
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 10000)
    try {
      const res = await fetch(`${config.panelApiUrl}/api/application/locations?per_page=1`, {
        headers: headers(),
        signal: ctrl.signal,
      })
      return { ok: res.ok, status: res.status, error: res.ok ? null : friendlyError(res.status) }
    } catch (e) {
      return { ok: false, error: e.name === 'AbortError' ? 'timeout' : e.message }
    } finally {
      clearTimeout(t)
    }
  },

  async websiteStatus() {
    if (!config.website) return { ok: false, error: 'url website kosong' }
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 10000)
    try {
      const res = await fetch(config.website, { signal: ctrl.signal, redirect: 'follow' })
      return { ok: res.ok, status: res.status }
    } catch (e) {
      return { ok: false, error: e.name === 'AbortError' ? 'timeout' : e.message }
    } finally {
      clearTimeout(t)
    }
  },

  async getNodes() {
    const data = await _fetch('/api/application/nodes?include=servers,allocations,location')
    if (!data || data.error) return { error: data ? data.error : 'gagal' }
    return data.data || []
  },

  async getLocations() {
    const data = await _fetch('/api/application/locations')
    if (!data || data.error) return { error: data ? data.error : 'gagal' }
    return data.data || []
  },

  async getServers() {
    const data = await _fetch('/api/application/servers?per_page=100')
    if (!data || data.error) return { error: data ? data.error : 'gagal' }
    return data.data || []
  },

  async getNode(id) {
    const data = await _fetch(`/api/application/nodes/${id}?include=servers`)
    if (!data || data.error) return { error: data ? data.error : 'gagal' }
    return data.attributes || null
  },

  // Ringkasan lengkap untuk command monitoring
  async summary() {
    if (!this.configured()) return { configured: false }
    const [nodes, servers, panel] = await Promise.all([
      this.getNodes(),
      this.getServers(),
      this.panelStatus(),
    ])
    if (nodes.error) return { configured: true, error: nodes.error }

    const totalServers = Array.isArray(servers) ? servers.length : '?'
    const activeServers = Array.isArray(servers)
      ? servers.filter((s) => s.attributes?.suspended === false).length
      : '?'

    const nodeSummary = nodes.map((n) => {
      const a = n.attributes || {}
      const res = a.allocated_resources || {}
      // Pterodactyl mengirim memory & disk node dalam SATUAN MB, baik di
      // allocated_resources maupun di limit node. Versi lama membaginya
      // 1024x lagi sehingga RAM 16 GB tampil jadi "0 MB"/"-" dan total
      // resource di .servers selalu 0.
      const ramMB = res.memory ? Math.round(res.memory) : 0
      const diskMB = res.disk ? Math.round(res.disk) : 0
      const maxMemMB = a.memory ? Math.round(a.memory) : 0
      return {
        id: a.id,
        name: a.name,
        location: a.location_id,
        online: !a.maintenance_mode,
        maintenance: !!a.maintenance_mode,
        cpu: res.cpu ? res.cpu + '%' : '-',
        ram: ramMB ? humanMB(ramMB) : '-',
        disk: diskMB ? humanMB(diskMB) : '-',
        maxMem: maxMemMB ? humanMB(maxMemMB) : '-',
        fqdn: a.fqdn,
        cpuLimit: a.cpu,
        diskLimit: a.disk,
        memoryLimit: a.memory,
        // angka mentah (MB / persen CPU) supaya bisa dijumlahkan command lain
        ramMB,
        diskMB,
        cpuAlloc: res.cpu || 0,
        servers: a.relationships?.servers?.data?.length || 0,
        ramPct: res.memory && a.memory ? Math.min(100, Math.round((res.memory / a.memory) * 100)) : null,
        diskPct: res.disk && a.disk ? Math.min(100, Math.round((res.disk / a.disk) * 100)) : null,
        cpuPct: res.cpu && a.cpu ? Math.min(100, Math.round((res.cpu / a.cpu) * 100)) : null,
      }
    })

    return {
      configured: true,
      panelOk: panel.ok,
      nodes: nodeSummary,
      totalNodes: nodes.length,
      totalServers,
      activeServers,
    }
  },

  // ==========================================================================
  // CLIENT API (/api/client) — dipakai untuk monitoring PER SERVER, misalnya
  // server Minecraft pelanggan. Butuh CLIENT API key (Account -> API
  // Credentials), berbeda dengan Application key yang dipakai di atas.
  //
  // Keuntungan keamanan: Client key hanya bisa melihat server milik akun itu
  // sendiri, jadi hak akses pelanggan dijamin oleh panel, bukan oleh bot.
  // ==========================================================================

  clientConfigured() {
    return !!(config.panelApiUrl && config.panelClientToken)
  },

  // Client API menerima short uuid (8 karakter, `identifier`). Kalau yang
  // diberikan uuid panjang, ambil 8 karakter pertamanya.
  toIdentifier(idOrUuid) {
    const s = String(idOrUuid || '').trim()
    return s.length > 8 ? s.slice(0, 8) : s
  },

  async clientFetch(urlPath, options = {}) {
    if (!config.panelApiUrl || !config.panelClientToken) return null
    const url = `${config.panelApiUrl}${urlPath}`
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 15000)
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${config.panelClientToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        signal: ctrl.signal,
        method: options.method || 'GET',
        body: options.body ? JSON.stringify(options.body) : undefined,
      })
      if (!res.ok) return { error: friendlyError(res.status), status: res.status }
      const text = await res.text()
      try {
        return text ? JSON.parse(text) : { ok: true }
      } catch (_) {
        return { ok: true }
      }
    } catch (e) {
      return { error: e.name === 'AbortError' ? 'timeout' : e.message }
    } finally {
      clearTimeout(t)
    }
  },

  // Daftar server yang bisa diakses pemilik token ini
  async clientListServers() {
    const data = await this.clientFetch('/api/client?include=allocations')
    if (!data) return { error: 'PANEL_CLIENT_TOKEN belum diisi di .env' }
    if (data.error) return { error: data.error }
    return (data.data || []).map((s) => normalizeClientServer(s.attributes, s))
  },

  async clientServer(idOrUuid) {
    const id = this.toIdentifier(idOrUuid)
    const data = await this.clientFetch(`/api/client/servers/${id}?include=allocations`)
    if (!data) return { error: 'PANEL_CLIENT_TOKEN belum diisi di .env' }
    if (data.error) return { error: data.error }
    return normalizeClientServer(data.attributes, data)
  },

  // CPU / RAM / disk / power state sebuah server (butuh Client key)
  async clientResources(idOrUuid) {
    const id = this.toIdentifier(idOrUuid)
    const data = await this.clientFetch(`/api/client/servers/${id}/resources`)
    if (!data) return { error: 'PANEL_CLIENT_TOKEN belum diisi di .env' }
    if (data.error) return { error: data.error }
    return clientResourceSummary(data.attributes)
  },

  // start | stop | restart | kill
  async clientPower(idOrUuid, signal) {
    const id = this.toIdentifier(idOrUuid)
    const allowed = ['start', 'stop', 'restart', 'kill']
    if (!allowed.includes(signal)) return { error: 'signal harus: ' + allowed.join(', ') }
    const res = await this.clientFetch(`/api/client/servers/${id}/power`, {
      method: 'POST',
      body: { signal },
    })
    if (!res) return { error: 'PANEL_CLIENT_TOKEN belum diisi di .env' }
    if (res.error) return { error: res.error }
    return { ok: true, signal }
  },

  // Kredensial websocket console (dipakai lib/mc.js untuk kirim command)
  async clientConsoleUrl(idOrUuid) {
    const id = this.toIdentifier(idOrUuid)
    const data = await this.clientFetch(`/api/client/servers/${id}/websocket`)
    if (!data) return { error: 'PANEL_CLIENT_TOKEN belum diisi di .env' }
    if (data.error) return { error: data.error }
    if (!data.data || !data.data.socket) return { error: 'panel tidak mengembalikan socket url' }
    return { socket: data.data.socket, token: data.data.token }
  },
}

// Panel mengirim memory/disk dalam MB dan cpu dalam persen (100 = 1 core).
// Nilai 0 berarti "unlimited", sehingga persentase tidak bisa dihitung.
function clientResourceSummary(attributes) {
  const res = (attributes && attributes.resources) || {}
  const lim = res.limits || {}
  const memoryMB = res.memory_bytes ? Math.round(res.memory_bytes / 1024 / 1024) : 0
  const diskMB = res.disk_bytes ? Math.round(res.disk_bytes / 1024 / 1024) : 0
  const memoryLimitMB = lim.memory || 0
  const diskLimitMB = lim.disk || 0
  const cpuLimit = lim.cpu || 0
  return {
    state: attributes ? attributes.current_state : null, // running / offline / starting
    memoryMB,
    diskMB,
    cpuPctRaw: res.cpu_absolute != null ? Math.round(res.cpu_absolute * 10) / 10 : 0,
    uptimeMs: res.uptime || 0,
    memoryLimitMB,
    diskLimitMB,
    cpuLimit,
    ramPct: memoryLimitMB ? Math.min(100, Math.round((memoryMB / memoryLimitMB) * 100)) : null,
    diskPct: diskLimitMB ? Math.min(100, Math.round((diskMB / diskLimitMB) * 100)) : null,
    cpuPct: cpuLimit ? Math.min(100, Math.round((res.cpu_absolute || 0) / cpuLimit * 100)) : null,
  }
}

function normalizeClientServer(a, wrapper) {
  const allocs =
    (a.relationships && a.relationships.allocations && a.relationships.allocations.data) ||
    (wrapper && wrapper.relationships && wrapper.relationships.allocations && wrapper.relationships.allocations.data) ||
    []
  const def = allocs.find((x) => x.attributes && x.attributes.is_default) || allocs[0]
  const da = def ? def.attributes : null
  const limits = a.limits || {}
  return {
    identifier: a.identifier,
    uuid: a.uuid,
    name: a.name,
    description: a.description || '',
    node: a.node || '',
    sftp: a.sftp_details || null,
    eggName: (a.egg_object && (a.egg_object.name || a.egg_object.description)) || '',
    ownerUuid: a.owner || a.user || '',
    state: a.status || null,
    suspended: !!a.is_suspended,
    memoryLimitMB: limits.memory || 0,
    diskLimitMB: limits.disk || 0,
    cpuLimit: limits.cpu || 0,
    // host untuk SLP ping: pakai allocation default (IP node + port game)
    mcHost: da ? da.ip || da.ip_alias || '' : '',
    mcPort: da ? da.port : null,
    allocations: allocs.map((x) => x.attributes).filter(Boolean),
  }
}

Panel.humanMB = humanMB
Panel.clientResourceSummary = clientResourceSummary
Panel.normalizeClientServer = normalizeClientServer

module.exports = Panel
