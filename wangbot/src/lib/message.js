const { downloadContentFromMessage } = require('@whiskeysockets/baileys')

// Ekstrak isi pesan (text) dari berbagai tipe pesan Baileys
function getBody(message) {
  if (!message) return ''
  const m = message
  // WhatsApp versi baru membungkus gambar/dokumen ber-caption ke dalam
  // documentWithCaptionMessage -> tanpa ini caption ".sticker" tidak terbaca
  const dwc = m.documentWithCaptionMessage?.message
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    dwc?.imageMessage?.caption ||
    dwc?.documentMessage?.caption ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.listResponseMessage?.singleSelectReply?.selectedRowId ||
    m.buttonsResponseMessage?.selectedButtonId ||
    m.templateButtonReplyMessage?.selectedId ||
    m.pollCreationMessage?.name ||
    ''
  )
}

// Deteksi tipe media utama pada pesan (termasuk wrapper viewOnce)
function getMediaType(message) {
  if (!message) return null
  if (message.imageMessage) return { type: 'image', msg: message.imageMessage, isViewOnce: false }
  if (message.videoMessage) return { type: 'video', msg: message.videoMessage, isViewOnce: false }
  if (message.stickerMessage) return { type: 'sticker', msg: message.stickerMessage, isViewOnce: false }
  if (message.audioMessage) return { type: 'audio', msg: message.audioMessage, isViewOnce: false }
  if (message.documentMessage) return { type: 'document', msg: message.documentMessage, isViewOnce: false }
  if (message.ptvMessage) return { type: 'video', msg: message.ptvMessage, isViewOnce: false }

  // gambar/dokumen ber-caption (wrapper baru WhatsApp)
  const dwc = message.documentWithCaptionMessage?.message
  if (dwc) {
    if (dwc.imageMessage) return { type: 'image', msg: dwc.imageMessage, isViewOnce: false }
    if (dwc.documentMessage) return { type: 'document', msg: dwc.documentMessage, isViewOnce: false }
  }

  // viewOnce wrappers
  const vo =
    message.viewOnceMessage?.message ||
    message.viewOnceMessageV2?.message ||
    message.viewOnceMessageV2Extension?.message
  if (vo) {
    if (vo.imageMessage) return { type: 'image', msg: vo.imageMessage, isViewOnce: true }
    if (vo.videoMessage) return { type: 'video', msg: vo.videoMessage, isViewOnce: true }
    if (vo.audioMessage) return { type: 'audio', msg: vo.audioMessage, isViewOnce: true }
  }

  return null
}

async function downloadMedia(media, logger) {
  if (!media) return null
  try {
    const type = media.type === 'document' ? 'document' : media.type
    const stream = await downloadContentFromMessage(media.msg, type)
    let buffer = Buffer.from([])
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk])
    return buffer
  } catch (e) {
    if (logger) logger.error('downloadMedia', e)
    return null
  }
}

module.exports = { getBody, getMediaType, downloadMedia }
