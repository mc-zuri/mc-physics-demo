'use strict'
// What the recorder's binary session log tells about a recorded case: which of its ticks ran while the client was
// paused, and every server packet the client handled before each tick.
//
// A session (PHYSREC2) is a magic, then frames of u32be length, u32be CRC32 and one definite-length CBOR map. PHYSREC3
// holds the same records in deflated blocks (see compactEvents); both read the same. Every client tick opens with a `client_tick_start` event whose `paused` says whether the game ran it (sessions recorded with
// the clientTickPaused capability); a case's row t follows its `tick_start` event { t } inside that client tick.
const fs = require('fs')
const zlib = require('zlib')
const crypto = require('crypto')

const MAGIC = Buffer.from('PHYSREC2')
const MAGIC3 = Buffer.from('PHYSREC3')
const TAGS = [6, 7, 8, 9]

const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1
  return n >>> 0
})
function crc32 (buffer) {
  let crc = 0xffffffff
  for (let i = 0; i < buffer.length; i++) crc = crcTable[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

// A CBOR tag around a value: PHYSREC3 tags a record's top-level values.
class Tagged { constructor (tag, value) { this.tag = tag; this.value = value } }

// The CBOR the recorder writes: unsigned and negative integers, byte and text strings, arrays, maps, false, true, null,
// single and double floats; with `tags`, PHYSREC3's tags on a record's values.
function decode (buffer, { tags = false } = {}) {
  let at = 0
  function read (depth = 0) {
    const head = buffer[at++]
    const major = head >>> 5
    const info = head & 31
    if (major === 7) {
      if (info === 20) return false
      if (info === 21) return true
      if (info === 22) return null
      if (info === 26) { at += 4; return buffer.readFloatBE(at - 4) }
      if (info === 27) { at += 8; return buffer.readDoubleBE(at - 8) }
      throw new Error(`unsupported CBOR simple value ${info}`)
    }
    let n
    if (info < 24) n = info
    else if (info === 24) n = buffer[at++]
    else if (info === 25) { n = buffer.readUInt16BE(at); at += 2 } else if (info === 26) { n = buffer.readUInt32BE(at); at += 4 } else if (info === 27) { n = Number(buffer.readBigUInt64BE(at)); at += 8 } else throw new Error('indefinite or reserved CBOR length')
    if (major === 0) return n
    if (major === 1) return -1 - n
    if (major === 6) {
      if (!tags || depth !== 1 || !TAGS.includes(n)) throw new Error(`unsupported CBOR tag ${n}`)
      return new Tagged(n, read(depth + 1))
    }
    if (major === 2 || major === 3) { at += n; return major === 2 ? buffer.subarray(at - n, at) : buffer.toString('utf8', at - n, at) }
    if (major === 4) { const out = []; for (let i = 0; i < n; i++) out.push(read(depth + 1)); return out }
    if (major === 5) { const out = {}; for (let i = 0; i < n; i++) { const key = read(depth + 1); out[key] = read(depth + 1) } return out }
    throw new Error(`unsupported CBOR major type ${major}`)
  }
  const value = read()
  if (at !== buffer.length) throw new Error('trailing bytes in CBOR frame')
  return value
}

const isMap = v => v !== null && typeof v === 'object' && !Array.isArray(v) && !Buffer.isBuffer(v) && !(v instanceof Tagged)
// a fresh copy, as decoding the record again would give
function clone (v) {
  if (Array.isArray(v)) return v.map(clone)
  if (Buffer.isBuffer(v)) return Buffer.from(v)
  if (v !== null && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)]))
  return v
}

// PHYSREC3: "PHYSREC3", then blocks of u32be compressed length, u32be raw length, u32be CRC32 of the raw bytes and the
// raw bytes as raw DEFLATE; the raw bytes are entries of u32be length and one CBOR map. Entries without `seq` are control
// records: { e: 'format', blobWindow, ... } first, { e: 'strings', first, values } (the string table) and
// { e: 'blob', id, sha256, bytes }. In the others, tag 6 (n) is string n, tag 7 (n) a packet's bytes as blob n, a
// checkpoint's state tag 8 (map) its domain's last full state with these fields replaced and tag 9 (null) the state of
// its domain's previous checkpoint; case_start forgets those states. Once the kept blobs total more than blobWindow
// bytes the oldest go, the newest always stays. The recorder's tools/session-format.cjs is the reference reader.
// Blocks are inflated one at a time.
function * compactEvents (data, file) {
  let format
  const strings = []; const blobs = new Map(); const order = []; let blobBytes = 0; let nextBlob = 0
  const bases = new Map(); const previous = new Map()
  for (let at = 8; at < data.length;) {
    if (at + 12 > data.length) throw new Error(`${file}: truncated block`)
    const length = data.readUInt32BE(at)
    const compressed = data.subarray(at + 12, at + 12 + length)
    if (compressed.length !== length) throw new Error(`${file}: truncated block`)
    const raw = zlib.inflateRawSync(compressed)
    if (raw.length !== data.readUInt32BE(at + 4) || crc32(raw) !== data.readUInt32BE(at + 8)) throw new Error(`${file}: checksum mismatch in block at ${at}`)
    at += 12 + length
    for (let p = 0; p < raw.length;) {
      const n = raw.readUInt32BE(p)
      const record = decode(raw.subarray(p + 4, p + 4 + n), { tags: true })
      p += 4 + n
      if (record.seq === undefined) {
        if (record.e === 'format') format = record
        else if (record.e === 'strings') {
          if (record.first !== strings.length) throw new Error(`${file}: string table out of order`)
          strings.push(...record.values)
        } else if (record.e === 'blob') {
          if (record.id !== nextBlob++) throw new Error(`${file}: blob ${record.id} out of order`)
          if (!crypto.createHash('sha256').update(record.bytes).digest().equals(record.sha256)) throw new Error(`${file}: blob ${record.id} checksum mismatch`)
          blobs.set(record.id, Buffer.from(record.bytes)); order.push(record.id); blobBytes += record.bytes.length
          while (blobBytes > format.blobWindow && order.length > 1) { const old = order.shift(); blobBytes -= blobs.get(old).length; blobs.delete(old) }
        } else throw new Error(`${file}: unknown control record ${record.e}`)
        continue
      }
      for (const [key, value] of Object.entries(record)) {
        if (!(value instanceof Tagged)) continue
        if (value.tag === 6) {
          if (value.value >= strings.length) throw new Error(`${file}: unknown string ${value.value}`)
          record[key] = strings[value.value]
        } else if (value.tag === 7) {
          if (!blobs.has(value.value)) throw new Error(`${file}: blob ${value.value} is not available`)
          record[key] = Buffer.from(blobs.get(value.value))
        }
      }
      if (record.e === 'case_start') { bases.clear(); previous.clear() }
      if (record.e === 'checkpoint' && 'state' in record) {
        const domain = record.domain == null ? 'null' : String(record.domain)
        const state = record.state
        if (state instanceof Tagged && state.tag === 9) {
          if (!previous.has(domain)) throw new Error(`${file}: checkpoint ${record.seq} repeats no state`)
          record.state = clone(previous.get(domain))
        } else if (state instanceof Tagged) {
          const base = bases.get(domain)
          if (!base || !isMap(state.value) || Object.keys(state.value).some(k => !(k in base))) throw new Error(`${file}: checkpoint ${record.seq} changes no base state`)
          const out = Object.fromEntries(Object.keys(base).map(k => [k, k in state.value ? state.value[k] : base[k]]))
          previous.set(domain, out)
          record.state = clone(out)
        } else if (isMap(state)) {
          bases.set(domain, state); previous.set(domain, state)
          record.state = clone(state)
        } else { bases.delete(domain); previous.delete(domain) }
      }
      yield record
    }
  }
}

// Every event of the session, in order.
function * events (file) {
  let data = fs.readFileSync(file)
  if (data[0] === 0x1f && data[1] === 0x8b) data = zlib.gunzipSync(data)
  const magic = data.subarray(0, 8)
  if (!magic.equals(MAGIC) && !magic.equals(MAGIC3)) throw new Error(`${file}: not a PHYSREC2 or PHYSREC3 session`)
  let seq = 0
  if (magic.equals(MAGIC3)) {
    for (const event of compactEvents(data, file)) {
      if (event.seq !== seq + 1) throw new Error(`${file}: event ${seq + 1} missing`)
      seq = event.seq
      yield event
    }
    return
  }
  for (let at = 8; at < data.length;) {
    const length = data.readUInt32BE(at)
    const frame = data.subarray(at + 8, at + 8 + length)
    if (frame.length !== length) throw new Error(`${file}: truncated frame after event ${seq}`)
    if (crc32(frame) !== data.readUInt32BE(at + 4)) throw new Error(`${file}: checksum mismatch after event ${seq}`)
    const event = decode(frame)
    if (event.seq !== seq + 1) throw new Error(`${file}: event ${seq + 1} missing`)
    seq = event.seq
    at += 8 + length
    yield event
  }
}

// Every case tick of the session: [event seq, row t, whether the client tick it ran in was paused].
function sessionTicks (file) {
  const ticks = []
  let paused = null
  for (const event of events(file)) {
    if (event.e === 'client_tick_start') paused = event.paused
    else if (event.e === 'tick_start') ticks.push([event.seq, event.t, paused])
  }
  return ticks
}

// The paused flag of each row of a case recorded in the session between two events; throws unless every row finds
// exactly one tick with a flag.
function casePauses (ticks, { name, firstEvent, lastEvent, rows }) {
  const out = new Array(rows)
  for (const [seq, t, paused] of ticks) {
    if (seq < firstEvent || seq > lastEvent) continue
    if (t < 1 || t > rows || out[t - 1] !== undefined || typeof paused !== 'boolean') {
      throw new Error(`${name}: tick ${t} of ${rows} has no single paused flag`)
    }
    out[t - 1] = paused
  }
  if (out.some(p => p === undefined)) throw new Error(`${name}: not every one of its ${rows} rows has a paused flag`)
  return out
}

// Every case tick of the session: [event seq, row t, the server packets the client handled since the tick before, as
// [handler event seq, hex], in the order it handled them]. A packet counts once its handler starts on the client's
// thread.
function sessionHandled (file) {
  const ticks = []
  const received = new Map()
  let handled = []
  for (const event of events(file)) {
    if (event.e === 'packet' && event.direction === 'clientbound') {
      received.set(event.packetId, Buffer.from(event.bytes).toString('hex'))
    } else if (event.e === 'handler_start' && received.has(event.packetId)) {
      handled.push([event.seq, received.get(event.packetId)])
      received.delete(event.packetId)
    } else if (event.e === 'tick_start') {
      ticks.push([event.seq, event.t, handled])
      handled = []
    }
  }
  return ticks
}

// Whether a case takes each row's paused flag from its session: one recorded with the client's pause state (an
// archive's, or a run of the recorder's own) that opens a screen ({ opensScreen: true }) or is a feature case (m_*);
// else null.
function takesPauses (label, rec) {
  if (!/^(archive|recordings):/.test(label) || !rec.sourceSession?.capabilities?.clientTickPaused) return null
  const opensScreen = (rec.steps ?? []).some(step => step.op === 'screen' && step.screen !== 'none')
  if (!opensScreen && !rec.name.startsWith('m_')) return null
  return { opensScreen }
}

// Each row's paused flag of a case that takes them (takesPauses) from its session's ticks, every row's, none paused
// too (a row that left the player as it was then ticked the client without the player); else null
function pausesFor (label, rec, ticks) {
  if (!takesPauses(label, rec)) return null
  const session = rec.sourceSession
  return casePauses(ticks, { name: rec.name, firstEvent: session.firstEvent, lastEvent: session.lastEvent, rows: rec.ticks.length })
}

module.exports = { sessionTicks, casePauses, sessionHandled, takesPauses, pausesFor, events, decode }
