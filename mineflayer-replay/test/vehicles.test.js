/* eslint-env mocha */
'use strict'
// Which engine replays a riding case's vehicle (lib/vehicles.js), on the recordings that tell them apart.
const assert = require('assert')
const fixtures = require('../lib/fixture')
const { replayVehicle } = require('../lib/vehicles')

function replayed (version, name) {
  const rec = fixtures.scenario(version, name)
  if (!rec) return null
  return replayVehicle(version, rec)
}

describe('vehicle replay', function () {
  this.timeout(60 * 1000)

  // 1.21.5 counts the saddle in a llama's saddle slot (Mob.isSaddled): its rider steers it as a horse, forward and jump
  // moving it; the llama of every other version goes where the server moves it
  it('steers a 1.21.5 llama as a horse, and follows the server\'s llama elsewhere (c_ride_llama_keys_ignored)', function () {
    const steered = replayed('1.21.5', 'c_ride_llama_keys_ignored')
    if (!steered) this.skip()
    assert.deepStrictEqual(steered.divergences, [])
    // (a llama the recorder made without AI stays where it is: travelRidden's isEffectiveAi)
    const rec = fixtures.scenario('1.21.5', 'c_ride_llama_keys_ignored')
    const end = fixtures.expand(rec).at(-1).vehicle.pos[0]
    if (rec.setup?.mount?.noAi) assert.strictEqual(end, fixtures.start(rec).vehicle.pos[0], 'the llama without AI stayed')
    else assert.ok(end > 10, `the steered llama walked east (x ${end})`)
    for (const version of ['1.21.4', '1.21.6']) {
      const driven = replayed(version, 'c_ride_llama_keys_ignored')
      if (driven) assert.deepStrictEqual(driven.divergences, [], version)
    }
  })

  // before 1.19.4 minecraft-data names no synced data: a pig's boost time (and a strider's) is found by its index, after
  // the version's entity, living entity, mob and ageable data
  it('boosts a pig or strider on the boost time synced at its index before 1.19.4 (c_ride_pig_boost, c_ride_strider_boost)', function () {
    const cases = [['1.11.2', 'c_ride_pig_boost'], ['1.14.4', 'c_ride_pig_boost'], ['1.15.2', 'c_ride_pig_boost'], ['1.17.1', 'c_ride_pig_boost'], ['1.19.2', 'c_ride_strider_boost']]
    let replayedAny = false
    for (const [version, name] of cases) {
      const result = replayed(version, name)
      if (!result) continue
      replayedAny = true
      assert.deepStrictEqual(result.divergences, [], `${name}@${version}`)
    }
    if (!replayedAny) this.skip()
  })

  // before 1.11 the recorder names a vehicle by its entity class: a Pig is a pig (an EntityHorse a horse, a Boat a boat)
  it('replays the vehicles the recorder names by their class before 1.11 (c_ride_pig_dismount on 1.9.4)', function () {
    const result = replayed('1.9.4', 'c_ride_pig_dismount')
    if (!result) this.skip()
    assert.ok(!result.divergences.some(d => d.diffs.some(diff => diff.field === 'vehicle')), 'an engine replays it')
  })

  // before 1.9 the server alone moves a ridden mob (EntityPig / EntityHorse move only where !worldObj.isRemote): the
  // client eases it toward the server's moves, the steered pig of c_ride_pig_boost on 1.8.8 too. A living entity's
  // motion fades only while it does not interpolate: the move of tick 53 keeps it for its 3 steps
  // (EntityLivingBase.onLivingUpdate, newPosRotationIncrements)
  it("follows the server's ridden mob before 1.9, its motion kept while it interpolates (c_ride_pig_boost on 1.8.8)", function () {
    const result = replayed('1.8.8', 'c_ride_pig_boost')
    if (!result) this.skip()
    assert.deepStrictEqual(result.divergences, [])
  })

  // from 26.3 Entity.commonTick steps the interpolation before LivingEntity.aiStep asks whether it runs: the tick that
  // ends a stepped interpolation (the llama's sync, 3 ticks from tick 2) fades the llama's motion by 0.98 already
  it('fades a server-driven mob\'s motion on the tick its stepped interpolation ends (c_ride_llama_idle on 26.3)', function () {
    const result = replayed('26.3', 'c_ride_llama_idle')
    if (!result) this.skip()
    assert.deepStrictEqual(result.divergences, [])
  })

  // before 1.11 a pig is its first passenger's to move without the stick too (canPassengerSteer): the client moves it
  // unsteered, on its own input, never damping its motion
  it('moves a stickless pig its rider controls before 1.11, unsteered (c_ride_pig_dismount)', function () {
    for (const version of ['1.9.4', '1.10.2']) {
      const result = replayed(version, 'c_ride_pig_dismount')
      if (result) assert.deepStrictEqual(result.divergences, [], version)
    }
  })
  // 1.8's client runs the boat its player rides itself (EntityBoat.onUpdate), pushed by its rider's walk input, and
  // takes the server's motion for it (S12PacketEntityVelocity, setVelocity) before its tick
  it("runs 1.8's boat by its rider's input and the server's motion for it (v_boat_ice, v_boat_ice_turning, v_boat_off_ledge_into_water, v_boat_dismount on 1.8.8)", function () {
    let replayedAny = false
    for (const name of ['v_boat_ice', 'v_boat_ice_turning', 'v_boat_off_ledge_into_water', 'v_boat_dismount']) {
      const result = replayed('1.8.8', name)
      if (!result) continue
      replayedAny = true
      assert.deepStrictEqual(result.divergences.slice(0, 1), [], name)
    }
    if (!replayedAny) this.skip()
  })

  // the recorder's mount without AI (setup.mount.noAi): the 1.21.5 llama its rider steers does not move
  // (travelRidden: isEffectiveAi, false for a mob without AI), its motion 0 (c_ride_llama_idle on 1.21.5)
  it("keeps the recorder's mount without AI still (c_ride_llama_idle on 1.21.5)", function () {
    const result = replayed('1.21.5', 'c_ride_llama_idle')
    if (!result) this.skip()
    assert.deepStrictEqual(result.divergences.slice(0, 1), [])
  })

  // the recorder settles the vehicle before tick 0, the server's last move of it still being eased in: the steps the
  // client had left and their target, as the recording has them, go on (EntityLivingBase.newPosRotationIncrements): the
  // 1.8 pig keeps its motion for those 3 ticks (v_pig_carrot_on_a_stick, c_ride_pig_boost on 1.8.8)
  it('goes on with the interpolation the vehicle was in at tick 0 (v_pig_carrot_on_a_stick on 1.8.8)', function () {
    const rec = fixtures.scenario('1.8.8', 'v_pig_carrot_on_a_stick')
    if (!rec || !(fixtures.start(rec).vehicle.lerp?.steps > 0)) this.skip()
    for (const mode of ['trajectory', 'stepwise']) assert.deepStrictEqual(replayVehicle('1.8.8', rec, { mode }).divergences, [], mode)
  })

  // before 1.11 the client boosts the pig its rider uses the stick on for a length it draws itself (EntityPig.boost:
  // rand.nextInt(841) + 140, never synced): the replay takes the recording's (c_ride_pig_boost on 1.9.4 and 1.10.2)
  it('boosts a 1.9 - 1.10 pig for the length its client drew (c_ride_pig_boost)', function () {
    let replayedAny = false
    for (const version of ['1.9.4', '1.10.2']) {
      const rec = fixtures.scenario(version, 'c_ride_pig_boost')
      if (!rec || !fixtures.expand(rec).some(row => row.vehicle?.boost?.boosting)) continue
      replayedAny = true
      assert.deepStrictEqual(replayed(version, 'c_ride_pig_boost').divergences, [], version)
    }
    if (!replayedAny) this.skip()
  })

  // before 1.9 a living entity's motion under 0.005 is dropped (EntityLivingBase.onLivingUpdate; 0.003 since): the
  // 1.8 horse the server moves stops at the tick its fading motion falls under it (c_ride_skeleton_horse_walk t59,
  // c_ride_donkey_step_up t56 on 1.8.8)
  it("drops a 1.8 mob's motion under 0.005 (c_ride_skeleton_horse_walk, c_ride_donkey_step_up on 1.8.8)", function () {
    let replayedAny = false
    for (const name of ['c_ride_skeleton_horse_walk', 'c_ride_donkey_step_up']) {
      const result = replayed('1.8.8', name)
      if (!result) continue
      replayedAny = true
      assert.deepStrictEqual(result.divergences.slice(0, 1), [], name)
    }
    if (!replayedAny) this.skip()
  })
})
