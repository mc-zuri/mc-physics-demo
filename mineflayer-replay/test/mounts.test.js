/* eslint-env mocha */
'use strict'
// How the bot replay sets up the mobs a case rides or summons (lib/bot.js).
const assert = require('assert')
const fixtures = require('../lib/fixture')
const { registryFor } = require('../lib/registry')
const { startBot, mobFlagsIndex, pausedRows, replay, packetPositionBefore } = require('../lib/bot')

describe('mount setup', function () {
  this.timeout(60 * 1000)

  // a mob's flags (bit 1: no AI) after the entity and living entity data, where the recordings have them: the pig's
  // boost time sits 3 after (its ageable baby and saddle between), 14 on 1.12.2, 17 on 1.16.5, 18 on 1.17.1
  it('finds a mob\'s flags by index before minecraft-data names them', function () {
    const expected = { '1.9.4': 10, '1.12.2': 11, '1.14.4': 13, '1.16.5': 14, '1.17.1': 15, '1.19.2': 15 }
    for (const [version, index] of Object.entries(expected)) assert.strictEqual(mobFlagsIndex(registryFor(version), 'strider'), index, version)
    const named = registryFor('1.21.4')
    assert.strictEqual(mobFlagsIndex(named, 'strider'), named.entitiesByName.strider.metadataKeys.indexOf('mob_flags'))
  })

  it('summons a mob without AI as its flags say, before 1.19.4 too (m_c_mount_click_strider)', async function () {
    for (const version of ['1.17.1', '1.19.3']) {
      const rec = fixtures.scenario(version, 'm_c_mount_click_strider')
      if (!rec) continue
      const { bot } = await startBot(version, rec)
      const strider = Object.values(bot.entities).find(e => e.name === 'strider')
      assert.strictEqual(strider.metadata[mobFlagsIndex(bot.registry, 'strider')] & 1, 1, version)
      bot.end?.()
    }
  })

  // 1.9 - 1.19.2 a pig's or strider's spawn data starts an empty boost that its first steered tick spends: a case that
  // starts riding has its vehicle steered before, so the replay marks it spent (mineflayer reads entity.spentSpawnBoost)
  it('marks the boost of the vehicle a case starts on as spent (c_ride_pig_boost)', async function () {
    const rec = fixtures.scenario('1.12.2', 'c_ride_pig_boost')
    if (!rec) this.skip()
    const { bot } = await startBot('1.12.2', rec)
    const vehicle = bot.entities[fixtures.start(rec).netState.vehicleId]
    assert.strictEqual(vehicle?.name, 'pig')
    assert.strictEqual(vehicle.spentSpawnBoost, true)
  })

  // the recorder settles the vehicle before tick 0: the camel the client steers stands where it spawned, and the server's
  // packet position is that too, which the client keeps for the relative moves to come (m_c_open_camel_riding)
  it("starts the packet position of a vehicle settled before the case at its spawn's (m_c_open_camel_riding)", async function () {
    const rec = fixtures.scenario('1.21.4', 'm_c_open_camel_riding')
    if (!rec) this.skip()
    const { bot } = await startBot('1.21.4', rec)
    const camel = bot.entities[fixtures.start(rec).netState.vehicleId]
    assert.deepStrictEqual([camel.interpolation.base.x, camel.interpolation.base.z], fixtures.start(rec).vehicle.pos.filter((_, i) => i !== 1))
  })

  // the priming ticks stand the player where the case starts, inside the camel it rides: the push back mineflayer gives
  // the camel then (entity.lastPush) is not the client's
  it('starts with no push back from the priming ticks (m_c_open_camel_riding)', async function () {
    const rec = fixtures.scenario('1.20.1', 'm_c_open_camel_riding')
    if (!rec) this.skip()
    const { bot } = await startBot('1.20.1', rec)
    for (const entity of Object.values(bot.entities)) assert.strictEqual(entity.lastPush, undefined, entity.name)
  })

  // c_ride_pig_dismount (1.20.6): the server's first moves of the pig come in a row of 16 server ticks, whose positions
  // do not tell which tick sent them: the packet position stays the spawn's
  it('leaves the vehicle packet position when the first move came in a row of several server ticks (c_ride_pig_dismount)', async function () {
    const rec = fixtures.scenario('1.20.6', 'c_ride_pig_dismount')
    if (!rec) this.skip()
    const { bot } = await startBot('1.20.6', rec)
    const pig = bot.entities[fixtures.start(rec).netState.vehicleId]
    assert.deepStrictEqual([pig.interpolation.base.x, pig.interpolation.base.z], [0.5, 3245.5])
  })

  // m_c_open_nautilus_riding (26.1): the server's first move of the nautilus comes the tick the saddle is taken off it,
  // the server's nautilus already moving: the packet position stays the spawn's, and no later move, from where the
  // server's nautilus had gone by then, sets it
  it('takes only the first move of the vehicle for its packet position (m_c_open_nautilus_riding)', async function () {
    const rec = fixtures.scenario('26.1', 'm_c_open_nautilus_riding')
    if (!rec) this.skip()
    const { bot } = await startBot('26.1', rec)
    const nautilus = bot.entities[fixtures.start(rec).netState.vehicleId]
    assert.deepStrictEqual([nautilus.interpolation.base.x, nautilus.interpolation.base.y], [0.5, 99])
  })

  // m_c_use_entity_horse_saddle: the case's horse comes from a setup command (summon ... {NoAI:1b,Tame:1b}): it has no
  // AI, so the saddled horse its rider takes does not move (travelRidden: isEffectiveAi, 1.21.5), and is tame
  it('sets up a mob its setup command summoned as its NBT says (m_c_use_entity_horse_saddle)', async function () {
    const rec = fixtures.scenario('1.21.5', 'm_c_use_entity_horse_saddle')
    if (!rec) this.skip()
    const { bot } = await startBot('1.21.5', rec)
    const horse = bot.entities[fixtures.start(rec).entities.find(e => e.type === 'horse').id]
    const keys = bot.registry.entitiesByName.horse.metadataKeys
    assert.strictEqual(horse.metadata[keys.indexOf('mob_flags')] & 0x01, 0x01)
    assert.strictEqual(horse.metadata[keys.indexOf('flags')] & 0x02, 0x02)
  })

  // the recordings log a living entity's head and body rotation (yHeadRot, yBodyRot): the mob starts with them, its
  // head steady (BodyRotationControl), where a llama before 1.20.5 seats its rider along its body (c_ride_llama_keys_ignored)
  it('starts a mob with the head and body rotation the recording has (c_ride_llama_keys_ignored)', async function () {
    const rec = fixtures.scenario('1.20.2', 'c_ride_llama_keys_ignored')
    if (!rec || fixtures.start(rec).vehicle?.yBodyRot === undefined) this.skip()
    const { bot } = await startBot('1.20.2', rec)
    const llama = bot.entities[fixtures.start(rec).netState.vehicleId]
    assert.strictEqual(llama.bodyYawDegrees, Math.fround(fixtures.start(rec).vehicle.yBodyRot))
    assert.strictEqual(llama.headYawDegrees, Math.fround(fixtures.start(rec).vehicle.yHeadRot))
    assert.strictEqual(llama.body.headStableTime, 20)
  })

  // before 1.21.2 a bamboo chest raft is a chest boat of the bamboo type (Boat.Type.BAMBOO, 8)
  it('mounts a chest raft as a bamboo chest boat before 1.21.2 (c_ride_bamboo_chest_raft_forward)', async function () {
    const rec = fixtures.scenario('1.21.1', 'c_ride_bamboo_chest_raft_forward')
    if (!rec) this.skip()
    const { bot } = await startBot('1.21.1', rec)
    const raft = bot.entities[fixtures.start(rec).netState.vehicleId]
    assert.strictEqual(raft.name, 'chest_boat')
    assert.strictEqual(raft.metadata[bot.registry.entitiesByName.chest_boat.metadataKeys.indexOf('type')], 8)
  })

  // 1.19.3's bamboo is the 8th boat type (7; CHERRY came before it in 1.19.4), its type the 12th data, which
  // minecraft-data names from 1.19.4 only: the raft the case rides is seated as one (v_raft_forward on 1.19.3)
  it('mounts a raft as a boat of the bamboo type on 1.19.3, by its index (v_raft_forward)', async function () {
    const rec = fixtures.scenario('1.19.3', 'v_raft_forward')
    if (!rec) this.skip()
    const { bot } = await startBot('1.19.3', rec)
    const raft = bot.entities[fixtures.start(rec).netState.vehicleId]
    assert.strictEqual(raft.name, 'boat')
    assert.strictEqual(raft.metadata[11], 7)
  })

  // the priming ticks before a case stand for no tick of the client: a 1.8 boat they drifted on its motion
  // (EntityBoat.onUpdate, empty until the case mounts it) starts the case where and as fast as recorded (v_boat_dismount
  // on 1.8.8)
  it('starts the entities as recorded after the priming ticks (v_boat_dismount on 1.8.8)', async function () {
    const rec = fixtures.scenario('1.8.8', 'v_boat_dismount')
    if (!rec) this.skip()
    const { bot } = await startBot('1.8.8', rec)
    const start = fixtures.start(rec)
    const boat = bot.entities[start.netState.vehicleId]
    const recorded = start.entities.find(e => e.id === boat.id)
    assert.deepStrictEqual(boat.velocity.toArray(), recorded.vel)
    assert.deepStrictEqual(boat.interpolatedPosition.toArray(), recorded.pos)
  })

  // 1.16's client leaves its vehicle in the vehicle's tick (Player.rideTick) and, its entry before the vehicle's, sends
  // nothing that tick: that row is a tick of the client, not a pause (m_c_mount_click_horse tick 91 on 1.16.5)
  it('ticks the row that left a vehicle, though it sent nothing (m_c_mount_click_horse on 1.16.5)', function () {
    const rec = fixtures.scenario('1.16.5', 'm_c_mount_click_horse')
    if (!rec) this.skip()
    const rows = fixtures.expand(rec)
    const index = rows.findIndex(r => r.t === 91)
    assert.ok(rows[index - 1].netState.vehicleId && !rows[index].netState.vehicleId)
    assert.strictEqual(pausedRows('1.16.5', rec, rows)(index), false)
  })

  // v_boat_dismount (26.2): the boat moves every tick, so the server's position a move encodes is not the one logged
  // that tick: the packet position stays the spawn's
  it('leaves the packet position of a vehicle that moves (v_boat_dismount)', async function () {
    const rec = fixtures.scenario('26.2', 'v_boat_dismount')
    if (!rec) this.skip()
    const { bot } = await startBot('26.2', rec)
    const boat = bot.entities[fixtures.start(rec).netState.vehicleId]
    assert.strictEqual(boat.interpolation.base.x, 0.5)
  })

  // 1.8 - 1.10 name every horse EntityHorse (its variant in its synced data, an int after its flags from 1.9): the case's
  // summoned donkey is found by that name and spawned a donkey (variant 1)
  it('summons a donkey as an EntityHorse of the donkey variant before 1.11 (m_c_mount_click_donkey)', async function () {
    const rec = fixtures.scenario('1.9.4', 'm_c_mount_click_donkey')
    if (!rec) this.skip()
    const { bot } = await startBot('1.9.4', rec)
    const donkey = Object.values(bot.entities).find(e => e.name === 'EntityHorse')
    assert.strictEqual(donkey.metadata[13], 1)
  })

  // from 26.3 a move is a VecDelta (one delta, or chained steps): the 26.3 llama's first move, steps of 0, takes its
  // packet position from the server's (c_ride_llama_keys_ignored on 26.3)
  it('starts the packet position of a vehicle from its first move, a 26.3 VecDelta too (c_ride_llama_keys_ignored)', async function () {
    const rec = fixtures.scenario('26.3', 'c_ride_llama_keys_ignored')
    if (!rec) this.skip()
    const { bot } = await startBot('26.3', rec)
    const llama = bot.entities[fixtures.start(rec).netState.vehicleId]
    assert.deepStrictEqual([llama.interpolation.base.x, llama.interpolation.base.y, llama.interpolation.base.z], fixtures.start(rec).vehicle.pos)
    bot.end?.()
  })

  // before 1.11 the client draws the length of its pig's boost itself (EntityPig.boost: rand.nextInt(841) + 140): the
  // bot replay draws the one the recording has of the client's boost (c_ride_pig_boost on 1.9.4)
  it('boosts the pig for the length the recorded client drew (c_ride_pig_boost on 1.9.4)', async function () {
    const rec = fixtures.scenario('1.9.4', 'c_ride_pig_boost')
    if (!rec || !fixtures.expand(rec).some(row => row.vehicle?.boost?.boosting)) this.skip()
    const result = await replay('1.9.4', rec)
    assert.deepStrictEqual(result.divergences.slice(0, 1), [])
  })

  // the packet position a vehicle's first move started from, as VecDeltaCodec.encode encodes it: rounded from 1.19.3,
  // floored before (as mineflayer's interpolation takes it)
  it('takes the packet position before a move as VecDeltaCodec encodes it, rounded from 1.19.3', function () {
    const x = 3.5 + 0.9 / 4096
    assert.strictEqual(packetPositionBefore(registryFor('1.19.2'), x, 4096), (Math.floor(x * 4096) - 4096) / 4096)
    assert.strictEqual(packetPositionBefore(registryFor('1.19.3'), x, 4096), (Math.round(x * 4096) - 4096) / 4096)
    assert.strictEqual(packetPositionBefore(registryFor('1.19.3'), x, 0), x)
  })

  // the recorder's mount without AI (setup.mount.noAi): its flags say so (Mob's flags, bit 1), so the 1.21.5 llama its
  // rider steers does not move (travelRidden: isEffectiveAi) (c_ride_llama_idle on 1.21.5)
  it('starts the mount without AI the setup says (c_ride_llama_idle)', async function () {
    const rec = fixtures.scenario('1.21.5', 'c_ride_llama_idle')
    if (!rec || !rec.setup?.mount?.noAi) this.skip()
    const { bot } = await startBot('1.21.5', rec)
    const llama = bot.entities[fixtures.start(rec).netState.vehicleId]
    assert.strictEqual(llama.metadata[mobFlagsIndex(bot.registry, 'llama')] & 0x01, 0x01)
    bot.end?.()
  })
})
