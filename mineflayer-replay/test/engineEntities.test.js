/* eslint-env mocha */
'use strict'
// The other entities the engine replay hands the engine (lib/engine.js nearbyEntitiesOf), on the recordings that show them.
const assert = require('assert')
const fixtures = require('../lib/fixture')
const engine = require('../lib/engine')
const { registryFor } = require('../lib/registry')

describe('engine replay entities', function () {
  this.timeout(60 * 1000)

  // 1.8 - 1.10 name a boat "Boat" and a shulker "Shulker": the engine takes them by mineflayer's snake-case names, solid
  // to the player as on the client (Boat / Shulker canBeCollidedWith)
  it('collides with the boats and shulkers of 1.8 - 1.10 (n_walk_into_boat, n_fall_onto_boat, n_stand_on_shulker)', function () {
    const cases = [['1.8.8', 'n_walk_into_boat'], ['1.8.8', 'n_fall_onto_boat'], ['1.9.4', 'n_jump_onto_boat'], ['1.10.2', 'n_walk_across_boat'], ['1.9.4', 'n_stand_on_shulker'], ['1.10.2', 'n_stand_on_shulker']]
    let replayedAny = false
    for (const [version, name] of cases) {
      const rec = fixtures.scenario(version, name)
      if (!rec) continue
      replayedAny = true
      assert.deepStrictEqual(engine.replay(version, rec).divergences.slice(0, 1), [], `${name}@${version}`)
    }
    if (!replayedAny) this.skip()
  })
  // a mob pushes the player from where its own tick left it: 1.9 - 1.10's client moves a cow without AI by the pushes
  // it took (LivingEntity.tickCramming after its travel), so it pushes from the tick's new position
  it('takes the push of a mob from where its tick left it (n_pushed_by_cow, n_sprint_into_cows, n_walk_through_cow on 1.9.4 - 1.10.2)', function () {
    let replayedAny = false
    for (const version of ['1.9.4', '1.10.2']) {
      for (const name of ['n_pushed_by_cow', 'n_sprint_into_cows', 'n_walk_through_cow']) {
        const rec = fixtures.scenario(version, name)
        if (!rec) continue
        replayedAny = true
        assert.deepStrictEqual(engine.replay(version, rec).divergences.slice(0, 1), [], `${name}@${version}`)
      }
    }
    if (!replayedAny) this.skip()
  })
  // 1.14 - 1.16 tick an entity whose slot comes after the player's first (Int2ObjectOpenHashMap): the player moves
  // against it where its tick left it, the tick's own row; one whose slot comes before is ticked after the player's
  // move, so the player meets it where the row before left it. Which it is depends on the session's entity ids: on the
  // recordings, the boat of n_walk_into_boat ticks before the player on 1.16.5 and after it on 1.15.2.
  const firstPush = rows => {
    const at = rows.findIndex((r, i) => i > 0 && r.entities?.[0] && rows[i - 1].entities?.[0] &&
      r.entities[0].box[0] !== rows[i - 1].entities[0].box[0])
    return at < 0 ? null : { row: rows[at], before: rows[at - 1] }
  }
  for (const [version, ticksBefore] of [['1.16.5', true], ['1.15.2', false]]) {
    it(`puts the boat of n_walk_into_boat where the client has it for the player's move on ${version}`, function () {
      const rec = fixtures.scenario(version, 'n_walk_into_boat')
      const push = rec && firstPush(fixtures.expand(rec))
      if (!push) this.skip()
      const { row, before } = push
      const [boat] = engine.nearbyEntitiesOf(registryFor(version), before, row)
      assert.strictEqual(boat.ticksBeforePlayer, ticksBefore)
      assert.strictEqual(boat.boundingBox.minX, (ticksBefore ? row : before).entities[0].box[0])
    })
  }
})
