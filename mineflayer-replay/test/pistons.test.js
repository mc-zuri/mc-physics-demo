/* eslint-env mocha */
'use strict'
// The client's moving pistons in the engine replay (lib/pistons.js), on the recordings that show them.
const assert = require('assert')
const fixtures = require('../lib/fixture')
const engine = require('../lib/engine')
const { createPistons } = require('../lib/pistons')
const { caseWorld } = require('../lib/world')

describe('engine replay pistons', function () {
  this.timeout(60 * 1000)

  // the client takes a tick's block changes and block events in the order they came: the head the server sends with
  // its piston's block event replaces the moving block the event made, and its block entity, which pushes no more
  it('takes a piston\'s block event among the block changes, in their order (n_piston_push on 1.11.2 - 1.19.4)', function () {
    let replayedAny = false
    for (const version of ['1.11.2', '1.13.2', '1.15.2', '1.16.5', '1.17.1', '1.18.2', '1.19', '1.19.2', '1.19.4']) {
      const rec = fixtures.scenario(version, 'n_piston_push')
      if (!rec) continue
      replayedAny = true
      assert.deepStrictEqual(engine.replay(version, rec).divergences.slice(0, 1), [], version)
    }
    if (!replayedAny) this.skip()
  })
  // before 1.11 the block entity's last tick, at progress 1, pushes once more before the moved block is set
  // (TileEntityPiston.update): each moving block ticks with its progress 0, 0.5 and then 1, and ends
  it('ticks a moving block at its end too, then sets the block it moved (n_piston_push on 1.12.2)', function () {
    const version = '1.12.2'
    const rec = fixtures.scenario(version, 'n_piston_push')
    if (!rec) this.skip()
    const world = caseWorld(fixtures.load(version), rec)
    const pistons = createPistons(version, world)
    const row = fixtures.expand(rec).find(r => r.events.serverPackets?.some(p => p.type === 'BlockActionS2CPacket'))
    pistons.receive(row.events.serverPackets.filter(p => p.type === 'BlockActionS2CPacket'))
    const seen = []
    for (let i = 0; i < 4; i++) pistons.tick(piston => seen.push(piston.progress))
    assert.deepStrictEqual(seen, [0, 0.5, 1])
    assert.strictEqual(world.getBlock({ x: 0, y: 101, z: 2707 }).name, 'piston_head')
  })
})
