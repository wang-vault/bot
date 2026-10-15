'use strict'

const fs = require('fs')
const path = require('path')
const logger = require('./logger')

// ---------------------------------------------------------------------------
// Konstanta pengaman sesi Signal (Baileys + libsignal)
// ---------------------------------------------------------------------------
// libsignal bawaan melempar `SessionError: Over 2000 messages into the future!`
// secara rekursif saat `counter - chainKey.counter > 2000`, memutasi objek
// sesi secara in-place sebelum verifikasi MAC, serta menulis `console.error`
// untuk setiap sesi tertutup (hingga 40x per pesan) ke PM2 error log.
const DEFAULT_MAX_MESSAGE_GAP = Math.max(
  2000,
  parseInt(process.env.SIGNAL_MAX_MESSAGE_GAP || '25000', 10) || 25000
)
const DEFAULT_MAX_RETAINED_KEYS = Math.max(
  50,
  parseInt(process.env.SIGNAL_MAX_RETAINED_KEYS || '400', 10) || 400
)
const DEFAULT_MAX_CLOSED_SESSIONS = Math.max(
  1,
  parseInt(process.env.SIGNAL_MAX_CLOSED_SESSIONS || '5', 10) || 5
)
const RESET_LOG_COOLDOWN_MS = 60 * 1000

const MSG_KEY_SEED = Buffer.from([1])
const CHAIN_KEY_SEED = Buffer.from([2])

// Pesan duplikat yang sudah pernah didekripsi: JANGAN reset sesi untuk ini.
const DUPLICATE_KEY_ERROR = 'Key used already or never filled'

const SESSION_DESYNC_PATTERNS = [
  /Over \d+ messages into the future/i,
  /No matching sessions found for message/i,
  /No session record/i,
  /No open session/i,
  /No sessions available/i,
  /\bNo sessions\b/i,
  /Bad MAC/i,
  /Invalid PreKey ID/i,
  /Missing SignedPreKey/i,
  /Chain closed/i,
  /Tried to decrypt on a sending chain/i,
  /Untrusted identity/i,
  /Incompatible version number/i,
  /Corrupt sessions object/i,
]

const GROUP_DESYNC_PATTERNS = [
  /Over \d+ messages into the future/i,
  /No session found to decrypt message/i,
  /No SenderKeyRecord found for decryption/i,
  /InvalidMessageException/i,
  /Invalid signature/i,
  /No sender message key found/i,
]

/**
 * Ambil teks alasan utama dari error dekripsi Signal/libsignal.
 */
function extractReason(err) {
  if (!err) return 'unknown'
  if (typeof err.primaryReason === 'string' && err.primaryReason) {
    return err.primaryReason
  }
  if (Array.isArray(err.sessionErrors) && err.sessionErrors.length) {
    const first = err.sessionErrors[0]
    if (first && first.message) return String(first.message)
  }
  return String(err.message || err.name || err)
}

/**
 * Apakah error menandakan sesi Signal 1:1 rusak / tidak sinkron dan perlu
 * direset agar negosiasi ulang (prekey bundle) dapat berjalan bersih?
 */
function isSessionDesyncError(err) {
  if (!err) return false
  const msg = String(err.message || '')
  const reason = extractReason(err)
  const combined = `${msg} | ${reason}`
  if (combined.includes(DUPLICATE_KEY_ERROR)) return false
  if (
    err.name === 'SessionError' ||
    err.name === 'PreKeyError' ||
    err.name === 'UntrustedIdentityKeyError'
  ) {
    return true
  }
  return SESSION_DESYNC_PATTERNS.some((re) => re.test(combined))
}

/**
 * Apakah error menandakan sender-key grup (`skmsg`) rusak / tidak sinkron?
 */
function isGroupKeyDesyncError(err) {
  if (!err) return false
  const combined = `${String(err.message || '')} | ${extractReason(err)}`
  if (combined.includes(DUPLICATE_KEY_ERROR)) return false
  return GROUP_DESYNC_PATTERNS.some((re) => re.test(combined))
}

/**
 * Pangkas `chain.messageKeys` agar hanya menyimpan maksimal `maxRetainedKeys`
 * kunci dengan counter tertinggi (mencegah pembengkakan file `session-*.json`).
 */
function pruneChainMessageKeys(messageKeys, maxRetainedKeys = DEFAULT_MAX_RETAINED_KEYS) {
  if (!messageKeys || typeof messageKeys !== 'object') return 0
  const keys = Object.keys(messageKeys)
  if (keys.length <= maxRetainedKeys) return 0
  const sorted = keys
    .map((k) => ({ raw: k, num: Number(k) }))
    .sort((a, b) => (a.num || 0) - (b.num || 0))
  const toDelete = sorted.length - maxRetainedKeys
  for (let i = 0; i < toDelete; i++) {
    delete messageKeys[sorted[i].raw]
  }
  return toDelete
}

/**
 * Salin state `SessionEntry` yang sudah diserialisasi kembali ke instance asli
 * bila percobaan dekripsi gagal di tengah jalan (mencegah korupsi in-place).
 */
function restoreSessionEntry(target, snapshot, SessionRecord) {
  if (!target || !snapshot || !SessionRecord) return
  try {
    const EntryClass =
      (typeof SessionRecord.createEntry === 'function' &&
        SessionRecord.createEntry().constructor) ||
      target.constructor
    if (!EntryClass || typeof EntryClass.deserialize !== 'function') return
    const fresh = EntryClass.deserialize(snapshot)
    target.registrationId = fresh.registrationId
    target.currentRatchet = fresh.currentRatchet
    target.indexInfo = fresh.indexInfo
    target._chains = fresh._chains
    if (fresh.pendingPreKey) {
      target.pendingPreKey = fresh.pendingPreKey
    } else {
      delete target.pendingPreKey
    }
  } catch (_) {}
}

function summarizeSessionErrors(errs) {
  if (!Array.isArray(errs) || !errs.length) return 'No matching sessions found for message'
  const counts = new Map()
  for (const e of errs) {
    const m = String((e && e.message) || e || 'unknown')
    counts.set(m, (counts.get(m) || 0) + 1)
  }
  const parts = []
  for (const [m, c] of counts.entries()) {
    parts.push(c > 1 ? `${m} (${c}x)` : m)
  }
  return parts.join('; ')
}

/**
 * Perbaiki kelemahan internal `libsignal` & `GroupCipher` secara runtime:
 *   1. `fillMessageKeys` diubah dari rekursif (batas 2000) menjadi iteratif
 *      hingga `maxMessageGap` (default 25.000) dan hanya menyimpan maksimal
 *      `maxRetainedKeys` (default 400) message key terakhir.
 *   2. `decryptWithSessions` menyimpan snapshot sebelum `doDecryptWhisperMessage`
 *      dan memulihkan state sesi bila percobaan gagal (mencegah mutasi in-place
 *      merusak sesi terbuka saat mencoba pesan out-of-order), serta menghentikan
 *      spam `console.error` berulang ke log PM2.
 *   3. `decryptPreKeyWhisperMessage` otomatis membangun ulang sesi bila `record`
 *      menyimpan sesi lama dengan `baseKey` sama yang sudah tidak sinkron.
 *   4. `SessionRecord.removeOldSessions` membatasi sesi tertutup maksimal
 *      `maxClosedSessions` (default 5, bukan 40).
 */
function patchLibsignal(customLibsignal, options = {}) {
  const maxGap = Number(options.maxMessageGap) > 0 ? Number(options.maxMessageGap) : DEFAULT_MAX_MESSAGE_GAP
  const maxRetainedKeys =
    Number(options.maxRetainedKeys) > 0 ? Number(options.maxRetainedKeys) : DEFAULT_MAX_RETAINED_KEYS
  const maxClosedSessions =
    Number(options.maxClosedSessions) > 0 ? Number(options.maxClosedSessions) : DEFAULT_MAX_CLOSED_SESSIONS

  let libsignal = customLibsignal
  if (!libsignal) {
    try {
      libsignal = require('libsignal')
    } catch (_) {
      return { patched: false, reason: 'libsignal-not-found' }
    }
  }

  let sigCrypto = options.crypto
  if (!sigCrypto) {
    try {
      sigCrypto = libsignal.crypto || require('libsignal/src/crypto')
    } catch (_) {}
  }
  let sigErrors = options.errors
  if (!sigErrors) {
    try {
      sigErrors = require('libsignal/src/errors')
    } catch (_) {
      sigErrors = libsignal
    }
  }
  let protobufs = options.protobufs
  if (!protobufs) {
    try {
      protobufs = require('libsignal/src/protobufs')
    } catch (_) {}
  }

  const SessionCipher = libsignal && libsignal.SessionCipher
  const SessionBuilder = libsignal && libsignal.SessionBuilder
  const SessionRecord = libsignal && libsignal.SessionRecord
  const SessionError = (sigErrors && sigErrors.SessionError) || (libsignal && libsignal.SessionError) || Error

  if (!SessionCipher || !SessionCipher.prototype) {
    return { patched: false, reason: 'invalid-session-cipher' }
  }

  // Simpan metode asli sekali saja supaya patch bersifat idempoten
  if (!SessionCipher.prototype.__wangbotOrigFillMessageKeys) {
    SessionCipher.prototype.__wangbotOrigFillMessageKeys = SessionCipher.prototype.fillMessageKeys
  }
  if (!SessionCipher.prototype.__wangbotOrigDecryptWithSessions) {
    SessionCipher.prototype.__wangbotOrigDecryptWithSessions = SessionCipher.prototype.decryptWithSessions
  }
  if (!SessionCipher.prototype.__wangbotOrigDecryptPreKeyWhisperMessage) {
    SessionCipher.prototype.__wangbotOrigDecryptPreKeyWhisperMessage =
      SessionCipher.prototype.decryptPreKeyWhisperMessage
  }

  // 1. Iterative fillMessageKeys dengan batas aman & pemangkasan memori
  if (sigCrypto && typeof sigCrypto.calculateMAC === 'function') {
    SessionCipher.prototype.fillMessageKeys = function fillMessageKeysPatched(chain, counter) {
      if (!chain || !chain.chainKey) return
      if (chain.chainKey.counter >= counter) return
      const gap = counter - chain.chainKey.counter
      if (gap > maxGap) {
        throw new SessionError('Over 2000 messages into the future!')
      }
      if (chain.chainKey.key === undefined || chain.chainKey.key === null) {
        throw new SessionError('Chain closed')
      }
      if (!chain.messageKeys || typeof chain.messageKeys !== 'object') {
        chain.messageKeys = {}
      }
      // Hanya simpan messageKey untuk `maxRetainedKeys` langkah terakhir menuju `counter`
      const keepFrom = counter - maxRetainedKeys
      while (chain.chainKey.counter < counter) {
        const key = chain.chainKey.key
        const nextCounter = chain.chainKey.counter + 1
        if (nextCounter > keepFrom) {
          chain.messageKeys[nextCounter] = sigCrypto.calculateMAC(key, MSG_KEY_SEED)
        }
        chain.chainKey.key = sigCrypto.calculateMAC(key, CHAIN_KEY_SEED)
        chain.chainKey.counter = nextCounter
      }
      pruneChainMessageKeys(chain.messageKeys, maxRetainedKeys)
    }
  }

  // 2. Non-mutating & quiet decryptWithSessions
  SessionCipher.prototype.decryptWithSessions = async function decryptWithSessionsPatched(data, sessions) {
    if (!Array.isArray(sessions) || !sessions.length) {
      throw new SessionError('No sessions available')
    }
    const errs = []
    for (const session of sessions) {
      const snapshot =
        session && typeof session.serialize === 'function' ? session.serialize() : null
      try {
        const plaintext = await this.doDecryptWhisperMessage(data, session)
        if (session && session.indexInfo) {
          session.indexInfo.used = Date.now()
        }
        return { session, plaintext }
      } catch (e) {
        if (snapshot) {
          restoreSessionEntry(session, snapshot, SessionRecord)
        }
        errs.push(e)
      }
    }
    // Bila salah satu sesi yang cocok menyatakan kunci counter ini sudah pernah
    // dipakai (pesan duplikat), teruskan MessageCounterError tersebut supaya
    // Baileys mengirim ACK dan kita tidak mereset sesi yang sebenarnya sehat.
    const dupErr = errs.find(
      (e) => e && (e.name === 'MessageCounterError' || String(e.message || '').includes(DUPLICATE_KEY_ERROR))
    )
    if (dupErr) {
      throw dupErr
    }
    const summary = summarizeSessionErrors(errs)
    const finalErr = new SessionError(`No matching sessions found for message (${summary})`)
    finalErr.sessionErrors = errs
    finalErr.primaryReason = summary
    throw finalErr
  }

  // 3. Self-healing decryptPreKeyWhisperMessage & quiet decryptWhisperMessage / initIncoming
  SessionCipher.prototype.decryptWhisperMessage = async function decryptWhisperPatched(data) {
    if (!Buffer.isBuffer(data)) {
      data = Buffer.from(data)
    }
    return await this.queueJob(async () => {
      const record = await this.getRecord()
      if (!record) {
        throw new SessionError('No session record')
      }
      const result = await this.decryptWithSessions(data, record.getSessions())
      const remoteIdentityKey = result.session.indexInfo.remoteIdentityKey
      if (!(await this.storage.isTrustedIdentity(this.addr.id, remoteIdentityKey))) {
        const UntrustedErr =
          (sigErrors && sigErrors.UntrustedIdentityKeyError) || SessionError
        throw new UntrustedErr(this.addr.id, remoteIdentityKey)
      }
      await this.storeRecord(record)
      return result.plaintext
    })
  }

  if (SessionBuilder && SessionBuilder.prototype) {
    const PreKeyError = (sigErrors && sigErrors.PreKeyError) || SessionError
    const UntrustedErr =
      (sigErrors && sigErrors.UntrustedIdentityKeyError) || SessionError
    SessionBuilder.prototype.initIncoming = async function initIncomingPatched(record, message) {
      const fqAddr = this.addr.toString()
      if (!(await this.storage.isTrustedIdentity(fqAddr, message.identityKey))) {
        throw new UntrustedErr(this.addr.id, message.identityKey)
      }
      if (record.getSession(message.baseKey)) {
        return
      }
      const preKeyPair = await this.storage.loadPreKey(message.preKeyId)
      if (message.preKeyId && !preKeyPair) {
        throw new PreKeyError('Invalid PreKey ID')
      }
      const signedPreKeyPair = await this.storage.loadSignedPreKey(message.signedPreKeyId)
      if (!signedPreKeyPair) {
        throw new PreKeyError('Missing SignedPreKey')
      }
      const existingOpenSession = record.getOpenSession()
      if (existingOpenSession) {
        record.closeSession(existingOpenSession)
      }
      record.setSession(
        await this.initSession(
          false,
          preKeyPair,
          signedPreKeyPair,
          message.identityKey,
          message.baseKey,
          undefined,
          message.registrationId
        )
      )
      return message.preKeyId
    }
  }

  if (SessionBuilder && SessionRecord && protobufs && protobufs.PreKeyWhisperMessage) {
    SessionCipher.prototype.decryptPreKeyWhisperMessage = async function decryptPreKeyPatched(data) {
      if (!Buffer.isBuffer(data)) {
        data = Buffer.from(data)
      }
      const versions = this._decodeTupleByte(data[0])
      if (versions[1] > 3 || versions[0] < 3) {
        throw new Error('Incompatible version number on PreKeyWhisperMessage')
      }
      return await this.queueJob(async () => {
        let record = await this.getRecord()
        const preKeyProto = protobufs.PreKeyWhisperMessage.decode(data.slice(1))
        if (!record) {
          if (preKeyProto.registrationId == null) {
            throw new Error('No registrationId')
          }
          record = new SessionRecord()
        }
        const baseKeyB64 =
          preKeyProto.baseKey && Buffer.isBuffer(preKeyProto.baseKey)
            ? preKeyProto.baseKey.toString('base64')
            : Buffer.from(preKeyProto.baseKey || []).toString('base64')
        const hadExistingBaseKey = Boolean(baseKeyB64 && record.sessions && record.sessions[baseKeyB64])
        const builder = new SessionBuilder(this.storage, this.addr)
        let preKeyId = await builder.initIncoming(record, preKeyProto)
        let session = record.getSession(preKeyProto.baseKey)
        let plaintext
        try {
          plaintext = await this.doDecryptWhisperMessage(preKeyProto.message, session)
        } catch (err) {
          // Bila `initIncoming` melewati inisialisasi karena `baseKey` lama masih
          // tersimpan di `record` tetapi rantai kuncinya sudah rusak/tertinggal,
          // buang entri `baseKey` lama tersebut lalu bangun ulang dari `preKeyProto`.
          if (hadExistingBaseKey && isSessionDesyncError(err)) {
            delete record.sessions[baseKeyB64]
            preKeyId = await builder.initIncoming(record, preKeyProto)
            session = record.getSession(preKeyProto.baseKey)
            plaintext = await this.doDecryptWhisperMessage(preKeyProto.message, session)
          } else {
            throw err
          }
        }
        await this.storeRecord(record)
        if (preKeyId) {
          await this.storage.removePreKey(preKeyId)
        }
        return plaintext
      })
    }
  }

  // 4. Batasi jumlah closed sessions di SessionRecord & hilangkan dump Buffer ke console
  if (SessionRecord && SessionRecord.prototype) {
    SessionRecord.prototype.closeSession = function closeSessionPatched(session) {
      if (!session || !session.indexInfo || this.isClosed(session)) return
      session.indexInfo.closed = Date.now()
    }
    SessionRecord.prototype.openSession = function openSessionPatched(session) {
      if (!session || !session.indexInfo) return
      session.indexInfo.closed = -1
    }
    SessionRecord.prototype.removeOldSessions = function removeOldSessionsPatched() {
      if (!this.sessions || typeof this.sessions !== 'object') return
      while (Object.keys(this.sessions).length > maxClosedSessions) {
        let oldestKey = null
        let oldestSession = null
        for (const [key, session] of Object.entries(this.sessions)) {
          if (
            session &&
            session.indexInfo &&
            session.indexInfo.closed !== -1 &&
            (!oldestSession || session.indexInfo.closed < oldestSession.indexInfo.closed)
          ) {
            oldestKey = key
            oldestSession = session
          }
        }
        if (oldestKey) {
          delete this.sessions[oldestKey]
        } else {
          // Semua sesi berstatus open (tidak normal); tutup yang paling lama dipakai
          let fallbackKey = null
          let fallbackUsed = Infinity
          for (const [key, session] of Object.entries(this.sessions)) {
            const used = Number(session && session.indexInfo && session.indexInfo.used) || 0
            if (used < fallbackUsed) {
              fallbackUsed = used
              fallbackKey = key
            }
          }
          if (fallbackKey) delete this.sessions[fallbackKey]
          else break
        }
      }
    }
  }

  // 5. Patch GroupCipher (sender-key grup) bila tersedia
  try {
    require('@whiskeysockets/baileys')
    const gcMod = require('@whiskeysockets/baileys/lib/Signal/Group/group_cipher.js')
    const GroupCipher = gcMod && gcMod.GroupCipher
    if (GroupCipher && GroupCipher.prototype && !GroupCipher.prototype.__wangbotPatched) {
      GroupCipher.prototype.__wangbotPatched = true
      GroupCipher.prototype.getSenderKey = function getSenderKeyPatched(senderKeyState, iteration) {
        let senderChainKey = senderKeyState.getSenderChainKey()
        if (senderChainKey.getIteration() > iteration) {
          if (senderKeyState.hasSenderMessageKey(iteration)) {
            const messageKey = senderKeyState.removeSenderMessageKey(iteration)
            if (!messageKey) {
              throw new Error('No sender message key found for iteration')
            }
            return messageKey
          }
          throw new Error(
            `Received message with old counter: ${senderChainKey.getIteration()}, ${iteration}`
          )
        }
        if (iteration - senderChainKey.getIteration() > maxGap) {
          throw new Error('Over 2000 messages into the future!')
        }
        const keepFrom = iteration - maxRetainedKeys
        while (senderChainKey.getIteration() < iteration) {
          if (senderChainKey.getIteration() >= keepFrom) {
            senderKeyState.addSenderMessageKey(senderChainKey.getSenderMessageKey())
          }
          senderChainKey = senderChainKey.getNext()
        }
        senderKeyState.setSenderChainKey(senderChainKey.getNext())
        return senderChainKey.getSenderMessageKey()
      }
    }
  } catch (_) {}

  SessionCipher.prototype.__wangbotPatched = true
  return {
    patched: true,
    maxGap,
    maxRetainedKeys,
    maxClosedSessions,
  }
}

/**
 * Bersihkan struktur objek JSON `session-*.json` (membuang sesi tertutup
 * berlebih, memangkas messageKeys yang membengkak, dan membuang entri rusak).
 */
function sanitizeSessionData(data, options = {}) {
  const maxRetainedKeys =
    Number(options.maxRetainedKeys) > 0 ? Number(options.maxRetainedKeys) : DEFAULT_MAX_RETAINED_KEYS
  const maxClosedSessions =
    Number(options.maxClosedSessions) > 0 ? Number(options.maxClosedSessions) : DEFAULT_MAX_CLOSED_SESSIONS

  if (!data || typeof data !== 'object' || !data._sessions || typeof data._sessions !== 'object') {
    return { valid: false, modified: false, empty: true, prunedClosed: 0, prunedKeys: 0 }
  }

  let modified = false
  let prunedClosed = 0
  let prunedKeys = 0
  const sessions = data._sessions

  for (const [key, entry] of Object.entries(sessions)) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      !entry.currentRatchet ||
      !entry.indexInfo ||
      !entry._chains ||
      typeof entry._chains !== 'object'
    ) {
      delete sessions[key]
      modified = true
      continue
    }
    for (const [chainKey, chain] of Object.entries(entry._chains)) {
      if (!chain || typeof chain !== 'object' || !chain.chainKey) {
        delete entry._chains[chainKey]
        modified = true
        continue
      }
      if (chain.messageKeys && typeof chain.messageKeys === 'object') {
        const cut = pruneChainMessageKeys(chain.messageKeys, maxRetainedKeys)
        if (cut > 0) {
          prunedKeys += cut
          modified = true
        }
      }
    }
  }

  // Pisahkan open session dan closed session; simpan maksimal `maxClosedSessions`
  const closedEntries = Object.entries(sessions)
    .filter(([, s]) => s && s.indexInfo && s.indexInfo.closed !== -1)
    .sort((a, b) => {
      const aTime = Number(a[1].indexInfo.used || a[1].indexInfo.closed || 0)
      const bTime = Number(b[1].indexInfo.used || b[1].indexInfo.closed || 0)
      return bTime - aTime
    })

  if (closedEntries.length > maxClosedSessions) {
    for (let i = maxClosedSessions; i < closedEntries.length; i++) {
      delete sessions[closedEntries[i][0]]
      prunedClosed++
      modified = true
    }
  }

  const remaining = Object.keys(sessions).length
  return {
    valid: true,
    modified,
    empty: remaining === 0,
    prunedClosed,
    prunedKeys,
  }
}

/**
 * Pindai dan rapikan seluruh file `session-*.json` di folder auth saat startup.
 * Tidak pernah menyentuh `creds.json` agar login utama tetap aman.
 */
function sanitizeAuthFolder(authPath, options = {}) {
  const stats = {
    scanned: 0,
    cleaned: 0,
    removed: 0,
    prunedClosed: 0,
    prunedKeys: 0,
  }
  const dir = path.resolve(authPath || '')
  if (!dir || !fs.existsSync(dir)) return stats

  let files = []
  try {
    files = fs.readdirSync(dir)
  } catch (_) {
    return stats
  }

  for (const file of files) {
    if (!file.startsWith('session-') || !file.endsWith('.json')) continue
    stats.scanned++
    const fullPath = path.join(dir, file)
    let raw
    let parsed
    try {
      raw = fs.readFileSync(fullPath, 'utf8')
      parsed = JSON.parse(raw)
    } catch (_) {
      try {
        fs.unlinkSync(fullPath)
        stats.removed++
      } catch (_) {}
      continue
    }

    const res = sanitizeSessionData(parsed, options)
    if (!res.valid || res.empty) {
      try {
        fs.unlinkSync(fullPath)
        stats.removed++
      } catch (_) {}
      continue
    }
    stats.prunedClosed += res.prunedClosed
    stats.prunedKeys += res.prunedKeys
    if (res.modified) {
      try {
        const tmp = `${fullPath}.tmp`
        fs.writeFileSync(tmp, JSON.stringify(parsed))
        fs.renameSync(tmp, fullPath)
        stats.cleaned++
      } catch (_) {}
    }
  }

  return stats
}

/**
 * Konversi alamat protokol Signal (`158184383758357.0`) ke format nama
 * `SenderKeyName` milik Baileys (`<group>::158184383758357::0`).
 */
function toSenderKeyName(group, protocolAddrStr) {
  const str = String(protocolAddrStr || '')
  const dot = str.lastIndexOf('.')
  if (dot > 0) {
    return `${group}::${str.slice(0, dot)}::${str.slice(dot + 1)}`
  }
  return `${group}::${str}::0`
}

/**
 * Bungkus SignalRepository Baileys dengan mekanisme self-healing otomatis:
 *   - Saat `decryptMessage` gagal karena sesi rusak / tidak sinkron
 *     (`Over 2000 messages into the future!`, `No matching sessions`, `Bad MAC`,
 *     dsb.), file `session-<addr>.json` langsung dihapus dari `auth.keys`
 *     sehingga paket retry `pkmsg` dari pengirim membuat sesi baru yang bersih.
 *   - Saat `decryptGroupMessage` gagal karena sender-key rusak, `sender-key`
 *     terkait dihapus agar distribusi kunci grup berikutnya diterima bersih.
 *   - Log peringatan di-rate-limit per alamat (maks 1x / 60 detik) supaya
 *     tidak membanjiri PM2 log.
 */
function createSelfHealingSignalRepository(auth, options = {}) {
  patchLibsignal(options.libsignal, options)

  let baseMake = options.baseMakeRepository
  if (!baseMake) {
    const baileys = require('@whiskeysockets/baileys')
    baseMake =
      baileys.makeLibSignalRepository ||
      (baileys.DEFAULT_CONNECTION_CONFIG &&
        baileys.DEFAULT_CONNECTION_CONFIG.makeSignalRepository)
  }
  if (typeof baseMake !== 'function') {
    throw new Error('makeLibSignalRepository tidak ditemukan di @whiskeysockets/baileys')
  }

  const baseRepo = baseMake(auth)
  const log = options.logger || logger
  const cooldownMs =
    Number(options.logCooldownMs) >= 0 ? Number(options.logCooldownMs) : RESET_LOG_COOLDOWN_MS
  const lastLogAt = new Map()
  const stats = {
    sessionResets: 0,
    groupKeyResets: 0,
    lastResetAddr: '',
    lastResetReason: '',
  }

  function logResetOnce(key, message) {
    const now = Date.now()
    const prev = lastLogAt.get(key) || 0
    if (now - prev < cooldownMs) return
    lastLogAt.set(key, now)
    if (lastLogAt.size > 500) {
      lastLogAt.delete(lastLogAt.keys().next().value)
    }
    if (log && typeof log.warn === 'function') {
      log.warn(message)
    }
  }

  async function resetSessionForJid(jid, err, source = 'decrypt') {
    if (!auth || !auth.keys || typeof auth.keys.set !== 'function') return false
    const addr = baseRepo.jidToSignalProtocolAddress(jid)
    if (!addr) return false
    const reason = extractReason(err)
    try {
      await auth.keys.set({ session: { [addr]: null } })
      stats.sessionResets++
      stats.lastResetAddr = addr
      stats.lastResetReason = reason
      logResetOnce(
        `sess:${addr}`,
        `[SIGNAL] Sesi ${addr} tidak sinkron saat ${source} (${reason}) — sesi direset otomatis.`
      )
      return true
    } catch (_) {
      return false
    }
  }

  async function resetGroupSenderKey(group, authorJid, err) {
    if (!auth || !auth.keys || typeof auth.keys.set !== 'function') return false
    const addr = baseRepo.jidToSignalProtocolAddress(authorJid)
    if (!group || !addr) return false
    const senderKeyName = toSenderKeyName(group, addr)
    const reason = extractReason(err)
    try {
      await auth.keys.set({ 'sender-key': { [senderKeyName]: null } })
      stats.groupKeyResets++
      stats.lastResetAddr = senderKeyName
      stats.lastResetReason = reason
      logResetOnce(
        `grp:${senderKeyName}`,
        `[SIGNAL] Sender-key grup ${group} (${addr}) tidak sinkron (${reason}) — direset otomatis.`
      )
      return true
    } catch (_) {
      return false
    }
  }

  return {
    ...baseRepo,
    stats,
    async decryptMessage({ jid, type, ciphertext }) {
      try {
        return await baseRepo.decryptMessage({ jid, type, ciphertext })
      } catch (err) {
        if (isSessionDesyncError(err)) {
          await resetSessionForJid(jid, err, `decrypt:${type || 'msg'}`)
        }
        throw err
      }
    },
    async decryptGroupMessage({ group, authorJid, msg }) {
      try {
        return await baseRepo.decryptGroupMessage({ group, authorJid, msg })
      } catch (err) {
        if (isGroupKeyDesyncError(err)) {
          await resetGroupSenderKey(group, authorJid, err)
        }
        throw err
      }
    },
    async encryptMessage({ jid, data }) {
      try {
        return await baseRepo.encryptMessage({ jid, data })
      } catch (err) {
        if (isSessionDesyncError(err)) {
          await resetSessionForJid(jid, err, 'encrypt')
        }
        throw err
      }
    },
  }
}

/**
 * Cache placeholder resend no-op untuk `makeWASocket`.
 *
 * Di Baileys 6.7.24, saat `sendRetryRequest` dijalankan pada `retryCount === 1`,
 * Baileys memanggil `requestPlaceholderResend(msgKey)` yang:
 *   1. menahan `retryMutex` selama 5.000 ms (`await delay(5000)`), dan
 *   2. mengirim pesan PDO `PLACEHOLDER_MESSAGE_RESEND` ke HP utama yang memicu
 *      HP utama membalas dari `@lid` (`me.lid`) dengan `msgId` baru — sehingga
 *      bila sesi `@lid` sedang rusak (`Over 2000 messages into the future!`),
 *      terjadi siklus kegagalan dekripsi tanpa henti setiap 5 detik.
 *
 * Dengan `get()` mengembalikan `true`, `requestPlaceholderResend` langsung
 * keluar dalam 0 ms dan menyerahkan pemulihan ke mekanisme retry receipt
 * standar (`<receipt type="retry">` + `<keys>`).
 */
function createNoOpPlaceholderCache() {
  return {
    get: () => true,
    set: () => true,
    del: () => 0,
    flushAll: () => {},
  }
}

module.exports = {
  DEFAULT_MAX_MESSAGE_GAP,
  DEFAULT_MAX_RETAINED_KEYS,
  DEFAULT_MAX_CLOSED_SESSIONS,
  DUPLICATE_KEY_ERROR,
  extractReason,
  isSessionDesyncError,
  isGroupKeyDesyncError,
  pruneChainMessageKeys,
  patchLibsignal,
  sanitizeSessionData,
  sanitizeAuthFolder,
  toSenderKeyName,
  createSelfHealingSignalRepository,
  createNoOpPlaceholderCache,
}
