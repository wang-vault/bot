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
  assistant: { title: 'Personal Agent', emoji: '🧭' },
}

function loadCommands() {
  const commands = []
  const byName = {}
  const byAlias = {}
  const diagnostics = []
  const dir = __dirname
  const folders = fs
    .readdirSync(dir)
    .filter((f) => fs.statSync(path.join(dir, f)).isDirectory())
    .sort()

  for (const folder of folders) {
    const files = fs.readdirSync(path.join(dir, folder)).filter((f) => f.endsWith('.js')).sort()
    for (const file of files) {
      const shownFile = `src/commands/${folder}/${file}`
      try {
        const mod = require(path.join(dir, folder, file))
        if (!mod || !mod.name || typeof mod.run !== 'function') {
          diagnostics.push({
            type: 'load-error',
            file: shownFile,
            message: 'Modul tidak mengekspor name dan fungsi run yang valid.',
          })
          continue
        }
        mod.category = mod.category || folder
        mod.file = shownFile
        const name = String(mod.name).toLowerCase()

        const nameConflict = byName[name] || byAlias[name]
        if (nameConflict && nameConflict !== mod) {
          diagnostics.push({
            type: 'collision',
            file: shownFile,
            name,
            message: `Nama "${name}" bentrok dengan command ${nameConflict.name}.`,
          })
        }

        commands.push(mod)
        // Pertahankan perilaku resolver lama (command terakhir menang), tetapi
        // konflik sekarang terlihat oleh Guardian, bukan tertutup diam-diam.
        byName[name] = mod
        for (const rawAlias of mod.aliases || []) {
          const alias = String(rawAlias || '').toLowerCase().trim()
          if (!alias) continue
          const conflict = byName[alias] || byAlias[alias]
          if (conflict && conflict !== mod) {
            diagnostics.push({
              type: 'collision',
              file: shownFile,
              name: alias,
              message: `Alias "${alias}" milik ${mod.name} bentrok dengan command ${conflict.name}.`,
            })
          }
          byAlias[alias] = mod
        }
      } catch (e) {
        const item = { type: 'load-error', file: shownFile, message: e.message }
        diagnostics.push(item)
        console.error(`[CMD] gagal load ${folder}/${file}:`, e.message)
      }
    }
  }
  const resolve = (name) => byName[String(name || '').toLowerCase()] || byAlias[String(name || '').toLowerCase()]
  return { commands, byName, byAlias, resolve, diagnostics }
}

module.exports = { loadCommands, CATEGORY_META }
