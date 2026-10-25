/* eslint-env mocha */
'use strict'
// A PHYSREC3 session (deflated blocks, a string table, blobs, checkpoint states as changes) reads as the events the
// recorder logged.
const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const zlib = require('zlib')
const { events, sessionTicks, sessionHandled } = require('../tools/session')

class Tag { constructor (tag, value) { this.tag = tag; this.value = value } }

// the CBOR the recorder writes (definite lengths only)
function cbor (value) {
  const head = (major, n) => {
    if (n < 24) return Buffer.from([major << 5 | n])
    if (n < 256) return Buffer.from([major << 5 | 24, n])
    if (n < 65536) { const b = Buffer.alloc(3); b[0] = major << 5 | 25; b.writeUInt16BE(n, 1); return b }
    const b = Buffer.alloc(5); b[0] = major << 5 | 26; b.writeUInt32BE(n, 1); return b
  }
  if (value instanceof Tag) return Buffer.concat([head(6, value.tag), cbor(value.value)])
  if (value === null) return Buffer.from([0xf6])
  if (value === false) return Buffer.from([0xf4])
  if (value === true) return Buffer.from([0xf5])
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value])
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value)
  if (typeof value === 'string') { const b = Buffer.from(value); return Buffer.concat([head(3, b.length), b]) }
  if (Array.isArray(value)) return Buffer.concat([head(4, value.length), ...value.map(cbor)])
  const entries = Object.entries(value)
  return Buffer.concat([head(5, entries.length), ...entries.flatMap(([k, v]) => [cbor(k), cbor(v)])])
}

function block (records) {
  const raw = Buffer.concat(records.map(record => {
    const body = cbor(record)
    const length = Buffer.alloc(4)
    length.writeUInt32BE(body.length)
    return Buffer.concat([length, body])
  }))
  const compressed = zlib.deflateRawSync(raw)
  const header = Buffer.alloc(12)
  header.writeUInt32BE(compressed.length, 0)
  header.writeUInt32BE(raw.length, 4)
  header.writeUInt32BE(zlib.crc32(raw), 8)
  return Buffer.concat([header, compressed])
}

describe('PHYSREC3 session reader', function () {
  let dir, file
  const packet = Buffer.from('2a0102', 'hex')
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'physrec3-'))
    file = path.join(dir, 'session.bin')
    const data = Buffer.concat([
      Buffer.from('PHYSREC3'),
      block([
        { e: 'format', blobWindow: 1 << 20 },
        { e: 'strings', first: 0, values: ['tick_start', 'clientbound'] },
        { seq: 1, e: 'case_start' },
        { seq: 2, e: 'client_tick_start', paused: false },
        { e: 'blob', id: 0, sha256: crypto.createHash('sha256').update(packet).digest(), bytes: packet },
        { seq: 3, e: 'packet', direction: new Tag(6, 1), packetId: 9, bytes: new Tag(7, 0) },
        { seq: 4, e: 'handler_start', packetId: 9 }
      ]),
      block([
        { seq: 5, e: new Tag(6, 0), t: 1 },
        { seq: 6, e: 'checkpoint', domain: 'player', state: { a: 1, b: 2 } },
        { seq: 7, e: 'checkpoint', domain: 'player', state: new Tag(8, { b: 3 }) },
        { seq: 8, e: 'checkpoint', domain: 'player', state: new Tag(9, null) },
        { seq: 9, e: 'client_tick_start', paused: true },
        { seq: 10, e: 'tick_start', t: 2 }
      ])
    ])
    fs.writeFileSync(file, zlib.gzipSync(data))
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('resolves strings, blobs and checkpoint states', function () {
    const all = [...events(file)]
    assert.deepStrictEqual(all.map(e => e.seq), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    assert.strictEqual(all[2].direction, 'clientbound')
    assert.ok(all[2].bytes.equals(packet))
    assert.strictEqual(all[4].e, 'tick_start')
    assert.deepStrictEqual(all[5].state, { a: 1, b: 2 })
    assert.deepStrictEqual(all[6].state, { a: 1, b: 3 })
    assert.deepStrictEqual(all[7].state, { a: 1, b: 3 })
  })

  it('gives the case ticks and the packets handled before each', function () {
    assert.deepStrictEqual(sessionTicks(file), [[5, 1, false], [10, 2, true]])
    assert.deepStrictEqual(sessionHandled(file), [[5, 1, [[4, '2a0102']]], [10, 2, []]])
  })

  it('throws on a corrupt block', function () {
    const data = zlib.gunzipSync(fs.readFileSync(file))
    data[19] ^= 1 // the first block's CRC32
    fs.writeFileSync(file, data)
    assert.throws(() => [...events(file)], /checksum mismatch/)
  })
})

describe('which cases take their rows\' paused flags from their sessions (tools/import.js)', function () {
  const { takesPauses } = require('../tools/session')
  const paused = { capabilities: { clientTickPaused: true } }
  it('a feature case or one that opens a screen, recorded with the client\'s pause state, from the archive or the recorder\'s runs', function () {
    assert.deepStrictEqual(takesPauses('recordings:1.14.4/full', { name: 'm_dimension', sourceSession: paused }), { opensScreen: false })
    assert.deepStrictEqual(takesPauses('archive:1.14.4/m', { name: 'm_dimension', sourceSession: paused }), { opensScreen: false })
    assert.deepStrictEqual(takesPauses('recordings:1.14.4/full', { name: 'b_walk', steps: [{ op: 'screen', screen: 'inventory' }], sourceSession: paused }), { opensScreen: true })
    // (a physics case with no screen, a session without the pause state, the generator's out/)
    assert.strictEqual(takesPauses('recordings:1.14.4/full', { name: 'b_walk', sourceSession: paused }), null)
    assert.strictEqual(takesPauses('recordings:1.14.4/full', { name: 'm_dimension', sourceSession: { capabilities: {} } }), null)
    assert.strictEqual(takesPauses('out:1.14.4', { name: 'm_dimension', sourceSession: paused }), null)
  })
})

describe('the rows\' paused flags a case takes from its session (tools/import.js)', function () {
  const { pausesFor } = require('../tools/session')
  it('every row\'s, none of them paused too: the respawn row of m_dimension ticked the client without its player', function () {
    const rec = { name: 'm_dimension', ticks: [{}, {}, {}], sourceSession: { firstEvent: 10, lastEvent: 30, capabilities: { clientTickPaused: true } } }
    const ticks = [[5, 9, true], [11, 1, false], [12, 2, false], [13, 3, false]]
    assert.deepStrictEqual(pausesFor('recordings:1.14.4/full-3', rec, ticks), [false, false, false])
    assert.deepStrictEqual(pausesFor('recordings:1.14.4/full-3', rec, [[11, 1, false], [12, 2, true], [13, 3, false]]), [false, true, false])
    assert.strictEqual(pausesFor('out:1.14.4', rec, ticks), null)
  })
})
