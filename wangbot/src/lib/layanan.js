const config = require('../config')

// Teks default informasi layanan. Bisa diubah owner lewat command .setinfo <key>
const DEFAULT_LAYANAN = {
  paket:
    '📦 *PAKET HOSTING WANGSTORE*\n\n' +
    '1. *SHARED HOSTING* — mulai Rp 10.000/bln\n' +
    '   • SSD NVMe, cPanel, SSL gratis\n\n' +
    '2. *GAME HOSTING* — mulai Rp 15.000/bln\n' +
    '   • Anti lag, DDoS protection\n\n' +
    '3. *DOMAIN* — mulai Rp 15.000/thn\n\n' +
    `🌐 Order: ${config.website}\n💬 Admin: wa.me/${(config.waAdmin || '').split('@')[0]}`,

  vps:
    '🖥️ *VPS WANGSTORE*\n\n' +
    '• KVM Virtualization\n• SSD NVMe / NVMe Enterprise\n• Full Root Access\n• IPv4 Dedicated\n• Anti DDoS\n\n' +
    'Spesifikasi mulai:\n- 1 vCPU / 1GB RAM / 20GB SSD\n- 2 vCPU / 2GB RAM / 40GB SSD\n- 4 vCPU / 4GB RAM / 80GB SSD\n\n' +
    `🌐 Order: ${config.website}`,

  dedicated:
    '🏢 *DEDICATED SERVER*\n\n' +
    '• Hardware eksklusif (bukan share)\n• Prosesor Intel XEON / AMD EPYC\n• RAM ECC 64GB - 512GB\n• Storage NVMe besar\n• Bandwidth premium\n\n' +
    'Cocok untuk: game server skala besar, website high traffic, mining.\n\n' +
    `🌐 Detail: ${config.website}`,

  publicip:
    '🌍 *PUBLIC IP / IPv4 ADDON*\n\n' +
    '• IPv4 Dedicated\n• Cocok untuk proxy, game, VPN\n• Anti DDoS\n\n' +
    `🌐 Order: ${config.website}`,

  website:
    `🌐 *WEBSITE WANGSTORE*\n\n${config.website}\n\nKunjungi untuk lihat semua layanan, harga, dan promo terbaru!`,

  group:
    `👥 *GRUP KOMUNITAS WANGSTORE*\n\n${config.communityGroup || '(belum diatur)'}\n\nGabung untuk info, update, dan diskusi!`,
}

const LAYANAN_KEYS = Object.keys(DEFAULT_LAYANAN)

function get(db, key) {
  if (!db.data.layanan) db.data.layanan = {}
  return db.data.layanan[key] || DEFAULT_LAYANAN[key]
}

function set(db, key, value) {
  if (!db.data.layanan) db.data.layanan = {}
  db.data.layanan[key] = value
  db.save()
}

function listKeys() {
  return LAYANAN_KEYS
}

module.exports = { get, set, listKeys, DEFAULT_LAYANAN }
