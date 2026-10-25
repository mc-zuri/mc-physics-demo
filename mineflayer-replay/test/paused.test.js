/* eslint-env mocha */
'use strict'
// Which recorded rows the client spent paused, by its position reminder where no tick_end marks its ticks (lib/bot.js).
const assert = require('assert')
const mc = require('minecraft-protocol')
const fixtures = require('../lib/fixture')
const { pausedRows } = require('../lib/bot')

const version = '1.15.2'
const serializer = mc.createSerializer({ state: 'play', isServer: false, version })
const sent = (name, params) => ({ bytes: serializer.createPacketBuffer({ name, params }).toString('hex') })
const swing = sent('arm_animation', { hand: 0 })
const position = sent('position', { x: 0.5, y: 101, z: 0.5, onGround: true })

// rows of a client standing still: its position reminder, what it sent
const caseOf = rows => {
  const rec = { start: { netState: { positionReminder: 14 } }, ticks: [] }
  return { rec, rows: rows.map(([positionReminder, clientPackets = []], i) => ({ t: i + 1, in: {}, netState: { positionReminder }, events: { clientPackets } })) }
}

describe('paused rows before 1.21.2', function () {
  it('a row whose position reminder did not count on is paused, though its client sent a swing', function () {
    const { rec, rows } = caseOf([[15, [swing]], [15, [swing]], [15], [16]])
    const paused = pausedRows(version, rec, rows)
    assert.deepStrictEqual(rows.map((row, i) => paused(i)), [false, true, true, false])
  })

  it('a row is told by the row before it, not by the start', function () {
    // (the start's reminder is 14: the fourth row's 14 counted on from the third's 13)
    const { rec, rows } = caseOf([[0, [position]], [12], [13], [14]])
    const paused = pausedRows(version, rec, rows)
    assert.deepStrictEqual(rows.map((row, i) => paused(i)), [false, false, false, false])
  })

  it('a respawn starts a new player\'s reminder at 0: the row of the respawn did not tick it', function () {
    // m_dimension on 1.13.2: the respawn comes in row 2, the new player sends its position in row 3 (1.17.1's new
    // recording ticks its new player in the row of the respawn already)
    // (the guess, without the recorder's own flags the fixture carries)
    const rec = fixtures.load('1.13.2').cases.find(c => c.name === 'm_dimension')
    const rows = fixtures.expand(rec).map(({ paused, ...row }) => row)
    const paused = pausedRows('1.13.2', rec, rows)
    assert.deepStrictEqual([0, 1, 2].map(paused), [false, true, false])
  })

  it('a row that sent its position ticked, its reminder back to 0 as before', function () {
    const { rec, rows } = caseOf([[0, [position]], [0, [position]], [0]])
    const paused = pausedRows(version, rec, rows)
    assert.deepStrictEqual(rows.map((row, i) => paused(i)), [false, false, true])
  })
})

describe('rows of a client ticking without its player (1.9 - 1.16: its chunk not loaded)', function () {
  // loads mineflayer and a registry per version, longer than mocha's 2 s on a busy machine
  this.timeout(20 * 1000)
  const { chunkGatedPause } = require('../lib/bot')
  it('a row that left the player as it was while its chunk was not loaded is a tick, from 1.9 to 1.16', function () {
    const stood = () => true
    for (const [version, loaded, paused] of [['1.9.4', false, false], ['1.13.2', false, false], ['1.16.5', false, false], ['1.9.4', true, true], ['1.8.8', false, true], ['1.17.1', false, true]]) {
      assert.strictEqual(chunkGatedPause(version, stood, () => loaded)(0), paused, `${version} ${loaded}`)
    }
    // (a row that ticked the player is no pause either way)
    assert.strictEqual(chunkGatedPause('1.9.4', () => false, () => true)(0), false)
    // (a row with the recorder's own flag is taken at its word)
    assert.strictEqual(chunkGatedPause('1.14.4', stood, () => false, () => true)(0), true)
    assert.strictEqual(chunkGatedPause('1.14.4', () => false, () => false, () => false)(0), false)
  })

  it('the recorder\'s pause flag decides where a row has it, the guess where it has none', function () {
    // rows the guess takes for paused (their reminder did not count on, nothing sent), two with the recorder's flags
    const { rec, rows } = caseOf([[14], [14], [14], [14]])
    rows[1].paused = false
    rows[2].paused = true
    const paused = pausedRows(version, rec, rows)
    assert.deepStrictEqual(rows.map((row, i) => paused(i)), [true, false, true, true])
    // (and over the chunk-gated guess: a recorded tick ticks, a recorded pause pauses)
    const gated = chunkGatedPause('1.14.4', paused, () => false, i => rows[i].paused)
    assert.deepStrictEqual(rows.map((row, i) => gated(i)), [false, false, true, false])
  })
})
