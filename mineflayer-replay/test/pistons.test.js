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

  // getCollisionRelatedBlockState: a retracting base collides as the head, short past a quarter from 1.16 (1.16
  // PistonBlockEntity.java:92-100); 1.13 - 1.15 set no SHORT, the long arm reaching -0.25 (1.15 :90-97)
  it('collides a retracting base as the short head past a quarter only from 1.16', function () {
    const mc = require('minecraft-protocol')
    const armStarts = version => {
      const registry = require('prismarine-registry')(version)
      const serializer = mc.createSerializer({ state: 'play', isServer: true, version })
      const params = { location: { x: -1, y: 101, z: 2707 }, byte1: 1, byte2: 5, blockId: registry.blocksByName.piston.id }
      const bytes = serializer.createPacketBuffer({ name: 'block_action', params }).toString('hex')
      const pistons = createPistons(version, { setStateId () {}, setBlock () {} })
      pistons.receive([{ type: 'minecraft:block_event', bytes }])
      const seen = []
      for (let i = 0; i < 2; i++) pistons.tick(piston => seen.push(Math.min(...piston.shapes.map(([minX]) => minX))))
      return seen
    }
    assert.deepStrictEqual(armStarts('1.13.2'), [-0.25, -0.25])
    assert.deepStrictEqual(armStarts('1.15.2'), [-0.25, -0.25])
    assert.deepStrictEqual(armStarts('1.16.5'), [-0.25, 0])
  })
})
