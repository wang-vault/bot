const fs = require('fs')
const path = require('path')

// Meta kategori (urutan tampil di menu)
const CATEGORY_META = {
  main: { title: 'Main Menu', emoji: '🤖' },
  utility: { title: 'Utility', emoji: '📋' },
  owner: { title: 'Owner', emoji: '👑' },
  info: { title: 'Informasi Layanan', emoji: '📦' },
  community: { title: 'Community', emoji: '👋' },
  moderation: { title: 'Moderasi', emoji: '🛡️' },
  admin: { title: 'Admin Grup', emoji: '👮' },
  media: { title: 'Media', emoji: '🖼️' },
  viewonce: { title: 'View Once', emoji: '👁️' },
  monitoring: { title: 'Monitoring Hosting', emoji: '📊' },
  mc: { title: 'Server Minecraft', emoji: '🎮' },
  marketing: { title: 'Marketing', emoji: '📢' },
  broadcast: { title: 'Broadcast', emoji: '📡' },
  cs: { title: 'Customer Service', emoji: '🎫' },
  stats: { title: 'Statistik', emoji: '📈' },
  games: { title: 'Games', emoji: '🎮' },
  ai: { title: 'AI Assistant', emoji: '🧠' },
}

function loadCommands() {
  const commands = []
  const byName = {}
  const byAlias = {}
  const dir = __dirname
  const folders = fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isDirectory())
  for (const folder of folders) {
    const files = fs.readdirSync(path.join(dir, folder)).filter((f) => f.endsWith('.js'))
    for (const file of files) {
      try {
        const mod = require(path.join(dir, folder, file))
        if (!mod || !mod.name || typeof mod.run !== 'function') continue
        mod.category = mod.category || folder
        commands.push(mod)
        byName[mod.name.toLowerCase()] = mod
        for (const a of mod.aliases || []) byAlias[a.toLowerCase()] = mod
      } catch (e) {
        console.error(`[CMD] gagal load ${folder}/${file}:`, e.message)
      }
    }
  }
  const resolve = (name) => byName[name] || byAlias[name]
  return { commands, byName, byAlias, resolve }
}

module.exports = { loadCommands, CATEGORY_META }
