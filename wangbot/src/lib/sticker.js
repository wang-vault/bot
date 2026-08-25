const { Sticker, StickerTypes } = require('wa-sticker-formatter')

function loadSharp() {
  try {
    return require('sharp')
  } catch (_) {
    return null
  }
}

/** Bungkus buffer gambar/video jadi sticker */
async function makeSticker(buffer, opts = {}) {
  const sticker = new Sticker(buffer, {
    pack: opts.pack || 'WangBot',
    author: opts.author || 'WangStore',
    type: opts.type || StickerTypes.FULL,
    categories: ['🤩', '🎉'],
    quality: opts.quality || 60,
    background: opts.background || undefined,
  })
  return sticker.toBuffer()
}

/** Wrap teks ke beberapa baris berdasarkan lebar (perkiraan) */
function wrapText(text, maxCharsPerLine, maxLines = 8) {
  const words = text.split(/\s+/)
  const lines = []
  let line = ''
  for (const w of words) {
    if ((line + ' ' + w).trim().length <= maxCharsPerLine) {
      line = (line + ' ' + w).trim()
    } else {
      if (line) lines.push(line)
      line = w
      if (lines.length >= maxLines) break
    }
  }
  if (line && lines.length < maxLines) lines.push(line)
  if (lines.length > maxLines) lines.length = maxLines
  return lines
}

/** Escape teks untuk XML/SVG */
function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Render teks menjadi gambar PNG (untuk sticker teks) */
async function textToImage(text) {
  const sharp = loadSharp()
  if (!sharp) throw new Error('sharp belum terinstall (npm i sharp)')
  const W = 512
  const H = 512
  const lines = wrapText(text || 'Halo', 18)
  const fontSize = 38
  const lineHeight = fontSize + 14
  const totalHeight = lines.length * lineHeight
  const startY = (H - totalHeight) / 2 + fontSize

  const tspans = lines
    .map((l, i) => `<text x="50%" y="${startY + i * lineHeight}" font-size="${fontSize}" fill="#ffffff" stroke="#000000" stroke-width="2" font-family="Arial, sans-serif" font-weight="bold" text-anchor="middle" dominant-baseline="middle">${escapeXml(l)}</text>`)
    .join('')

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1e3c72"/>
      <stop offset="100%" stop-color="#2a5298"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  ${tspans}
</svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

/** Overlay teks meme (atas/bawah) di atas gambar */
async function memeImage(baseBuffer, top, bottom) {
  const sharp = loadSharp()
  if (!sharp) throw new Error('sharp belum terinstall (npm i sharp)')
  const meta = await sharp(baseBuffer).metadata()
  const W = meta.width || 512
  const H = meta.height || 512
  const fontSize = Math.round(W / 12)
  const stroke = Math.max(2, Math.round(fontSize / 12))

  const t = top ? `<text x="50%" y="${fontSize}" font-size="${fontSize}" fill="#fff" stroke="#000" stroke-width="${stroke}" font-family="Impact, Arial, sans-serif" font-weight="bold" text-anchor="middle">${escapeXml(top.toUpperCase())}</text>` : ''
  const b = bottom ? `<text x="50%" y="${H - 12}" font-size="${fontSize}" fill="#fff" stroke="#000" stroke-width="${stroke}" font-family="Impact, Arial, sans-serif" font-weight="bold" text-anchor="middle">${escapeXml(bottom.toUpperCase())}</text>` : ''

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${t}${b}</svg>`

  return sharp(baseBuffer)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer()
}

module.exports = { makeSticker, textToImage, memeImage, wrapText, escapeXml }
