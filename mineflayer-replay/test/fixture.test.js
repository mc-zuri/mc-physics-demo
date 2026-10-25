/* eslint-env mocha */
'use strict'
// fixtureFormat 2: a row's object fields as deltas of the field before them, long packet bytes in a blob table; load()
// gives the rows back as they were.
const assert = require('assert')
const { delta, patch, decode, BLOB, FORMAT } = require('../lib/fixture')

describe('fixture format 2', function () {
  it('patches a delta back to the value it was taken from', function () {
    const before = { vehicleId: 7, lastYaw: 1.5, nested: { a: 1, b: { c: 2 } }, gone: true }
    const after = { vehicleId: 7, lastYaw: -0, nested: { a: 1, b: { c: 3, d: [1, 2] } }, added: 'x' }
    const change = delta(after, before)
    assert.deepStrictEqual(change, { lastYaw: -0, nested: { b: { c: 3, d: [1, 2] } }, added: 'x', $del: ['gone'] })
    assert.deepStrictEqual(patch(before, change), after)
    assert.ok(Object.is(patch(before, change).lastYaw, -0))
  })

  it('keeps an equal value out of the delta, and arrays whole', function () {
    assert.deepStrictEqual(delta({ a: [1, 2], b: { c: 1 } }, { a: [1, 3], b: { c: 1 } }), { a: [1, 2] })
  })

  it('refuses a recorded key that would read as a deletion', function () {
    assert.throws(() => delta({ $del: 1 }, {}), /\$del/)
  })

  it('decodes deltas row by row and blob references in server packets', function () {
    const chunk = 'ab'.repeat(1024)
    const fixture = {
      version: '1.21.11',
      fixtureFormat: FORMAT,
      blobs: [chunk],
      cases: [{
        name: 'm_case',
        start: { pos: [0, 0, 0], netState: { a: 1, b: 2 }, in: { forward: false, yaw: 0 } },
        ticks: [
          { t: 1, netState: { b: 3 }, serverPackets: [{ type: 'level_chunk', bytes: BLOB + '0' }, { type: 'bundle', packets: [{ type: 'x', bytes: BLOB + '0' }, { type: 'y', bytes: '0102' }] }] },
          { t: 2, in: { forward: true } },
          { t: 3, netState: { $del: ['a'] } }
        ]
      }]
    }
    decode(fixture)
    const [one, two, three] = fixture.cases[0].ticks
    assert.deepStrictEqual(one.netState, { a: 1, b: 3 })
    assert.strictEqual(one.serverPackets[0].bytes, chunk)
    assert.strictEqual(one.serverPackets[1].packets[0].bytes, chunk)
    assert.strictEqual(one.serverPackets[1].packets[1].bytes, '0102')
    assert.deepStrictEqual(two.in, { forward: true, yaw: 0 })
    assert.deepStrictEqual(three.netState, { b: 3 })
    assert.strictEqual(fixture.fixtureFormat, undefined)
    assert.strictEqual(fixture.blobs, undefined)
  })

  it('throws on a blob the table lacks', function () {
    const fixture = { version: 'v', fixtureFormat: FORMAT, blobs: [], cases: [{ name: 'c', start: {}, ticks: [{ t: 1, serverPackets: [{ bytes: BLOB + '4' }] }] }] }
    assert.throws(() => decode(fixture), /no blob @4/)
  })
})
