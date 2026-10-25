'use strict'
// Replays a riding case's vehicle (start.vehicle, row.vehicle) through mineflayer-physics-utils' vehicle physics: the
// vehicle the client steers ticks before its rider, with the rider's input of the tick before, and its state after
// every tick is compared with the vanilla client's.
//
//   boats and rafts: BoatPhysics (Boat.tick)
//   the pig, the strider, the camel and the horses: RiddenMobPhysics (LivingEntity.travelRidden)
//   minecarts: the client does not simulate them; it interpolates the server's moves (mineflayer's entityInterpolation)
//   horses: RiddenMobPhysics too (AbstractHorse.travel, tickRidden)
//
// The comparison ends when the rider leaves its vehicle (the rows lose their vehicle).
const { Vec3 } = require('vec3')
const { BoatPhysics, BoatState, RiddenMobPhysics, RiddenMobState, EPhysicsCtx, ControlStateHandler, initSetup } = require('@nxg-org/mineflayer-physics-util')
const { AABB } = require(require.resolve('@nxg-org/mineflayer-util-plugin', { paths: [require.resolve('@nxg-org/mineflayer-physics-util')] }))
const { registryFor } = require('./registry')
const { caseWorld } = require('./world')
const fixtures = require('./fixture')
const { differences } = require('./compare')
const { readClientbound } = require('./fakeClient')
const { createEntityInterpolation } = require('mineflayer/lib/entityInterpolation')
const nativeEngine = require('./nativeEngine')

const FIELDS = ['pos', 'vel', 'onGround']
const KEYS = ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak']
const BOAT_STATUS = { in_water: 0, under_water: 1, under_flowing_water: 2, on_land: 3, in_air: 4 }
const RIDDEN_MOBS = new Set(['pig', 'strider', 'camel', 'camel_husk', 'happy_ghast', 'nautilus', 'zombie_nautilus', 'horse', 'donkey', 'mule', 'skeleton_horse', 'zombie_horse'])
// the mobs that ride as another: a camel husk is a camel (CamelHusk extends Camel)
const RIDDEN_AS = { camel_husk: 'camel' }
// the names the recorder gives the vehicles before 1.11 (the entity classes' registry names): a horse of any variant is
// an EntityHorse
const LEGACY_NAMES = { Pig: 'pig', EntityHorse: 'horse', Boat: 'boat', MinecartRideable: 'minecart' }
const vehicleType = v => LEGACY_NAMES[v?.type] ?? v?.type
const SET_ENTITY_DATA = new Set(['minecraft:set_entity_data', 'EntityTrackerUpdateS2CPacket', 'entity_metadata'])

const isBoat = type => /(^|_)(boat|raft)$/i.test(type)

const engines = new Map()
function enginesFor (version) {
  if (!engines.has(version)) {
    const registry = registryFor(version)
    initSetup(registry)
    engines.set(version, nativeEngine.native
      ? { registry, boat: nativeEngine.boatPhysics(registry), ridden: nativeEngine.riddenMobPhysics(registry) }
      : { registry, boat: new BoatPhysics(registry), ridden: new RiddenMobPhysics(registry) })
  }
  return engines.get(version)
}

const controlsOf = input => new ControlStateHandler(...KEYS.map(key => !!input?.[key]))

// the vehicle's box before 1.17, from the recorded entities (Entity keeps its own box until then)
function boxOf (row, vehicleId) {
  const box = (row.entities ?? []).find(e => e.id === vehicleId)?.box
  return box ? new AABB(...box) : undefined
}

// A boat as the client held it after a tick: its motion, float yaw, status and the fields its next tick reads (the
// 1.12 / 1.13 recordings hold no status nor turn: the status is taken where the boat is, the turn kept).
function useBoat (state, v, box, legacy, settle) {
  state.pos.set(...v.pos)
  state.vel.set(...v.vel)
  state.setYawDegrees(v.yaw)
  state.onGround = v.onGround
  state.lastVerticalVelocity = v.vel[1]
  state.box = legacy ? box : undefined
  if (v.deltaRotation !== undefined) state.yawVelocity = v.deltaRotation
  if (v.landFriction !== undefined) state.landFriction = v.landFriction
  if (v.waterLevel !== undefined) state.waterLevel = v.waterLevel
  if (v.status !== undefined) state.status = BOAT_STATUS[v.status]
  else settle()
}

function replayBoat (version, rec, { mode }) {
  const { registry, boat } = enginesFor(version)
  const world = caseWorld(fixtures.load(version), rec)
  const start = fixtures.start(rec)
  const vehicleId = start.netState?.vehicleId
  const legacy = registry.version['<']('1.17')
  const state = BoatState.CREATE_FROM_ENTITY(boat, { name: start.vehicle.type, position: new Vec3(...start.vehicle.pos), velocity: new Vec3(...start.vehicle.vel), yaw: 0, pitch: 0, onGround: start.vehicle.onGround })
  state.controllingPlayer = true
  const ctx = EPhysicsCtx.FROM_ENTITY_STATE(boat, state, registry.entitiesByName[start.vehicle.type])
  const settle = () => boat.settleStatus(ctx, world)
  useBoat(state, start.vehicle, boxOf(start, vehicleId), legacy, settle)
  // 1.8's client runs EntityBoat.onUpdate itself for the boat its player rides, pushed by its rider's walk input
  const legacyBoat = registry.version['<']('1.9')
  return eachRidingTick(rec, start, (row, before) => {
    if (mode === 'stepwise') useBoat(state, before.vehicle, boxOf(before, vehicleId), legacy, settle)
    for (const change of row.events.blockChanges ?? []) world.setBlock(change)
    // the server's motion for the boat, as the client takes it before its tick (Entity.lerpMotion, setVelocity)
    for (const [target, x, y, z] of row.events.velocityPackets ?? []) if (target === 1) state.vel.set(x, y, z)
    if (legacyBoat) {
      // (the boat ticks before its rider: the moveForward and moveStrafing the rider's tick before left, its yaw)
      boat.simulateLegacy(ctx, world, { yaw: row.in.yaw, ...riderWalkInput(before.in) })
      return state
    }
    // the keys LocalPlayer.rideTick gave the boat the tick before
    state.control = controlsOf(before.in)
    boat.simulate(ctx, world)
    return state
  })
}

// 1.8's EntityPlayerSP moveForward / moveStrafing after its tick: the keys' 1.0F (0.3F of it sneaking), times 0.98F
function riderWalkInput (input) {
  const f32 = Math.fround
  const sneak = input?.sneak ? f32(0.3) : 1
  const forward = f32((input?.forward ? 1 : 0) - (input?.back ? 1 : 0))
  const strafe = f32((input?.left ? 1 : 0) - (input?.right ? 1 : 0))
  return { forward: f32(f32(forward * sneak) * f32(0.98)), strafe: f32(f32(strafe * sneak) * f32(0.98)) }
}

// The strider's suffocating modifier (Strider.setSuffocating): the client adds or removes it itself every tick, and
// RiddenMobPhysics with it, so a synced movement speed is taken without it.
const SUFFOCATING_MODIFIERS = new Set(['minecraft:suffocating', '9e362924-01de-4ddd-a2b2-d0f7a405a174'])
const MOVEMENT_SPEED = /(^|[.:])movement_speed$|movementSpeed$/

// AttributeInstance.calculateValue: the base, the added values, the base multiples, then the total multiples.
function attributeValue (base, modifiers) {
  let value = base
  for (const { amount, operation } of modifiers) if (operation === 0) value += amount
  let total = value
  for (const { amount, operation } of modifiers) if (operation === 1) total += value * amount
  for (const { amount, operation } of modifiers) if (operation === 2) total *= 1 + amount
  return total
}

// The ridden mob's synced data the client takes as it comes: the boost of a pig or strider (DATA_BOOST_TIME), the
// camel's dash; and its movement speed from the attributes the server sends for it.
function useMobEvents (state, { registry, ridden }, version, vehicleId, events) {
  const keys = metadataKeysOf(registry, state.type)
  for (const entry of events.serverPackets ?? []) {
    for (const { type, bytes } of entry.packets ?? [entry]) {
      if (/update_attributes|EntityAttributesS2CPacket/.test(type)) {
        const packet = readClientbound(version, fixtures.bytesOf(bytes))
        if (packet?.params.entityId !== vehicleId) continue
        const speed = packet.params.properties.find(property => MOVEMENT_SPEED.test(property.key))
        if (speed) state.movementSpeed = attributeValue(speed.value, speed.modifiers.filter(m => !SUFFOCATING_MODIFIERS.has(m.uuid)))
        continue
      }
      if (!SET_ENTITY_DATA.has(type)) continue
      const packet = readClientbound(version, fixtures.bytesOf(bytes))
      if (packet?.params.entityId !== vehicleId) continue
      for (const { key, value } of packet.params.metadata) {
        if (keys[key] === 'boost_time') state.startBoost(value)
        else if (keys[key] === 'dash') ridden.syncDash(state, value)
        else if (key === horseFlagsKey(registry, keys) && HORSES.has(state.type)) state.standing = (value & 32) !== 0
      }
    }
  }
}

const HORSES = new Set(['horse', 'donkey', 'mule', 'skeleton_horse', 'zombie_horse'])

// The names of a ridden mob's synced data by index: minecraft-data's from 1.19.4; before, a pig's saddle and boost
// time (Pig: DATA_SADDLE_ID, DATA_BOOST_TIME) and a strider's boost time, suffocating and saddle (Strider) after the
// entity, living entity, mob and ageable data of the version, where AbstractHorse's flags are
function metadataKeysOf (registry, type) {
  const named = registry.entitiesByName[type]?.metadataKeys
  if (named) return named
  const first = horseFlagsKey(registry, [])
  const keys = []
  if (type === 'pig') Object.assign(keys, { [first]: 'saddle', [first + 1]: 'boost_time' })
  if (type === 'strider') Object.assign(keys, { [first]: 'boost_time', [first + 1]: 'suffocating', [first + 2]: 'saddle' })
  return keys
}

// AbstractHorse's flags (DATA_ID_FLAGS, 32 rearing): minecraft-data names it from 1.21; before, its index
// after the entity, living entity, mob and ageable data of the version (1.9 has no no_gravity yet)
function horseFlagsKey (registry, keys) {
  const named = keys.indexOf('flags')
  if (named >= 0) return named
  if (registry.version['<']('1.10')) return 12
  if (registry.version['<']('1.14')) return 13
  if (registry.version['<']('1.15')) return 15
  if (registry.version['<']('1.17')) return 16
  return 17
}

function useMob (state, v) {
  state.pos.set(...v.pos)
  state.vel.set(...v.vel)
  state.onGround = v.onGround
}

function replayRiddenMob (version, rec, { mode, steered = true }) {
  const { registry, ridden } = enginesFor(version)
  const world = caseWorld(fixtures.load(version), rec)
  const start = fixtures.start(rec)
  const v = start.vehicle
  const vehicleId = start.netState?.vehicleId
  const state = new RiddenMobState(ridden, { type: RIDDEN_AS[vehicleType(v)] ?? vehicleType(v), pos: new Vec3(...v.pos), vel: new Vec3(...v.vel), yawDegrees: v.yaw, onGround: v.onGround, movementSpeed: v.movementSpeed, jumpStrength: v.jumpStrength })
  // before 1.17 the mob keeps its own box (Entity.move)
  const box = (start.entities ?? []).find(e => e.id === vehicleId)?.box
  if (box && registry.version['<']('1.17')) {
    const bb = state.getBB()
    bb.set(...box)
    state.keptBoundingBox = { bb, pos: state.pos.clone(), width: state.dimensions.width, height: state.dimensions.height }
  }
  // (a mob its rider controls but does not steer goes on its own input: RiddenMobState.saddled)
  state.saddled = steered
  // the recorder's mount without AI (setup.mount.noAi: Mob's flags, bit 1)
  state.noAi = !!rec.setup?.mount?.noAi
  const ctx = EPhysicsCtx.FROM_ENTITY_STATE(ridden, state, registry.entitiesByName.player)
  return eachRidingTick(rec, start, (row, before) => {
    if (mode === 'stepwise') useMob(state, before.vehicle)
    for (const change of row.events.blockChanges ?? []) world.setBlock(change)
    useMobEvents(state, { registry, ridden }, version, vehicleId, row.events)
    // the motion the server sets (Entity.lerpMotion)
    for (const [target, x, y, z] of row.events.velocityPackets ?? []) if (target === 1) state.vel.set(x, y, z)
    // before 1.11 the client boosts the pig its rider uses the stick on for a length it draws itself (ItemCarrotOnAStick,
    // EntityPig.boost: rand.nextInt(841) + 140, never synced): the length the recording has of the client's boost
    const boost = row.vehicle?.boost
    if (registry.version['<']('1.11') && row.in?.use && boost?.boosting && !before.vehicle?.boost?.boosting) state.startBoost(boost.boostTimeTotal)
    // the rider's look of this tick, its input and sprint after its last aiStep
    ridden.simulateRidden(ctx, world, { yawDegrees: row.in.yaw, pitchDegrees: row.in.pitch, xxa: before.xxa, zza: before.zza, sprinting: before.sprinting, jumping: !!before.in?.jump })
    // a released jump charges the mob in the rider's aiStep, after the mob's tick
    const charge = before.vehicle?.jumpRidingScale ?? 0
    if (before.in?.jump && !row.in.jump) ridden.riderJump(state, Math.floor(Math.fround(charge * 100)))
    return state
  })
}

const isMinecart = type => /(^|_)minecart$/i.test(type)
// the item a pig's or strider's rider steers it with, in either hand
const STICKS = { pig: 'carrot_on_a_stick', strider: 'warped_fungus_on_a_stick' }
function holds (rec, item) {
  const { equipment = {}, inventory = {}, selected = 0 } = rec.setup ?? {}
  return [equipment.mainhand?.id, equipment.offhand?.id, inventory[selected]?.id, inventory[40]?.id].includes(item)
}

// the living vehicles a rider never steers (Llama.getControllingPassenger: none from 1.19)
const SERVER_DRIVEN_MOBS = new Set(['llama', 'trader_llama'])
// but 1.21.5's, which counts the saddle in a llama's saddle slot (the recorder's mount wears one): its rider steers
// it as a horse (Mob.isSaddled, AbstractHorse.getControllingPassenger)
const steeredLlama = (version, type) => SERVER_DRIVEN_MOBS.has(type) && registryFor(version).version['==']('1.21.5')

// The move of a move_entity packet: flat dX / dY / dZ, or from 26.3 a VecDelta (ClientboundMoveEntityPacket): one delta,
// or chained steps (VecDelta.Stepped) whose end, where the minecart's LinearInterpolationHandler heads, is their sum
// (but for a coordinate whose steps cancel out, which vanilla rounds to the 1/4096 grid)
function moveDelta (p) {
  if (!p.delta) return p
  const steps = p.delta.steps ?? [p.delta]
  return steps.reduce((sum, step) => ({ dX: sum.dX + step.dX, dY: sum.dY + step.dY, dZ: sum.dZ + step.dZ }), { dX: 0, dY: 0, dZ: 0 })
}

// A minecart the server drives: the client shows it where its interpolation of the server's moves has got to
// (Entity.lerpTo / InterpolationHandler), takes its motion from the velocity packets (lerpMotion) and its ground
// contact from the moves. So are the other vehicles the client does not move: a llama (ridden, never steered), a
// happy ghast without its harness, a cushion (a seat that does not move). A living one's motion fades by 0.98 a tick
// while it does not interpolate (LivingEntity.aiStep: !isInterpolating() && !canSimulateMovement()), and a component
// under 0.003 is dropped (0.005 before 1.9).
function replayMinecart (version, rec, { mode, living = false }) {
  const registry = registryFor(version)
  const start = fixtures.start(rec)
  const vehicleId = start.netState?.vehicleId
  const interpolation = createEntityInterpolation(registry)
  const legacyRotation = registry.version['<']('1.14')
  // (a minecart is an object before 1.14, a living vehicle a mob: it interpolates over the packet's steps)
  const cart = { id: vehicleId, name: start.vehicle.type, type: registry.version['<']('1.14') && !living ? 'object' : 'mob', position: new Vec3(...start.vehicle.pos) }
  const state = { pos: new Vec3(...start.vehicle.pos), vel: new Vec3(...start.vehicle.vel), onGround: start.vehicle.onGround }
  interpolation.spawn(cart)
  useLerp(cart, start.vehicle.lerp)
  const degrees = (packet) => packet.yaw != null && packet.pitch != null ? { yaw: packet.yaw * 360 / 256, pitch: packet.pitch * 360 / 256 } : undefined
  return eachRidingTick(rec, start, (row, before) => {
    if (mode === 'stepwise') {
      // the tick starts where the client showed the minecart; the interpolation keeps its target and steps
      cart.interpolatedPosition.set(...before.vehicle.pos)
      state.vel.set(...before.vehicle.vel)
      state.onGround = before.vehicle.onGround
      useLerp(cart, before.vehicle.lerp)
    }
    for (const entry of row.events.serverPackets ?? []) {
      for (const { type, bytes } of entry.packets ?? [entry]) {
        if (!/move_entity|rel_entity|entity_move|entity_look|EntityS2CPacket|teleport_entity|entity_teleport|EntityPosition|position_sync|sync_entity/i.test(type)) continue
        const packet = readClientbound(version, fixtures.bytesOf(bytes))
        if (!packet || packet.params.entityId !== vehicleId) continue
        const p = packet.params
        if ((packet.name === 'rel_entity_move' || packet.name === 'entity_move_look') && living && p.delta?.steps) {
          // a living one goes along the steps (26.3+, SteppedInterpolationHandler), each taking its ticks
          interpolation.queueTicks(cart.id, p.delta.steps.map(step => step.ticks))
          for (const { dX, dY, dZ } of p.delta.steps) interpolation.move(cart, dX, dY, dZ, degrees(p))
        } else if (packet.name === 'rel_entity_move' || packet.name === 'entity_move_look') {
          const { dX, dY, dZ } = moveDelta(p)
          interpolation.move(cart, dX, dY, dZ, degrees(p))
        } else if (packet.name === 'entity_look') {
          if (legacyRotation) interpolation.move(cart, 0, 0, 0, degrees(p))
          else interpolation.move(cart, null, null, null, degrees(p))
        } else if (packet.name === 'entity_teleport') {
          const fixed = registry.supportFeature('fixedPointPosition')
          const flags = typeof p.flags === 'object' ? p.flags : null
          const base = flags ? interpolation.relativeBase(cart) : null
          const x = fixed ? p.x / 32 : flags?.x ? base.x + p.x : p.x
          const y = fixed ? p.y / 32 : flags?.y ? base.y + p.y : p.y
          const z = fixed ? p.z / 32 : flags?.z ? base.z + p.z : p.z
          interpolation.teleport(cart, x, y, z, flags ? { yaw: p.yaw, pitch: p.pitch } : degrees(p))
        } else if (packet.name === 'sync_entity_position') {
          const steps = p.path?.steps
          if (steps?.length) interpolation.queueTicks(cart.id, [steps.reduce((sum, step) => sum + step.tickOffset, 0)])
          const end = p.path ? (steps?.at(-1) ?? p.path) : p
          interpolation.sync(cart, end.x, end.y, end.z, { yaw: p.yaw, pitch: p.pitch })
        } else {
          continue
        }
        const onGround = p.delta?.onGround ?? p.onGround
        if (onGround !== undefined) state.onGround = onGround
      }
    }
    for (const [target, x, y, z] of row.events.velocityPackets ?? []) if (target === 1) state.vel.set(x, y, z)
    // the vehicle ticks before its rider: one step of the interpolation (a tick that takes the last step still
    // interpolates: LivingEntity.aiStep asks isInterpolating before the step; from 26.3 Entity.commonTick steps it
    // first, so the tick that ends a stepped interpolation no longer does)
    const steppedFirst = registry.version['>=']('26.3')
    let interpolating = cart.interpolation?.steps > 0
    interpolation.tick(cart)
    if (steppedFirst) interpolating = cart.interpolation?.steps > 0
    state.pos.set(cart.interpolatedPosition.x, cart.interpolatedPosition.y, cart.interpolatedPosition.z)
    if (living) {
      if (!interpolating) state.vel.scale(0.98)
      // (0.005 before 1.9: EntityLivingBase.onLivingUpdate)
      const negligible = registry.version['<']('1.9') ? 0.005 : 0.003
      state.vel.set(Math.abs(state.vel.x) < negligible ? 0 : state.vel.x, Math.abs(state.vel.y) < negligible ? 0 : state.vel.y, Math.abs(state.vel.z) < negligible ? 0 : state.vel.z)
    }
    return state
  })
}

// The interpolation the client had the vehicle in, as the recording has it (its lerpSteps and target, before 1.21.5):
// the steps it has left go on toward that target (the recorder settles the vehicle before tick 0, the server's last
// move still being eased in)
function useLerp (entity, lerp) {
  if (!(lerp?.steps > 0) || lerp.x == null || !entity.interpolation) return
  entity.interpolation.target.set(lerp.x, lerp.y, lerp.z)
  entity.interpolation.steps = lerp.steps
  if (lerp.yRot != null) {
    entity.interpolation.yaw = lerp.yRot
    entity.interpolation.pitch = lerp.xRot
  }
}

// Every tick the client rode its vehicle, compared with row.vehicle.
function eachRidingTick (rec, start, tick) {
  const rows = fixtures.expand(rec)
  const divergences = []
  let ticks = 0
  let before = start
  for (const row of rows) {
    if (!row.vehicle || !before.vehicle) break
    const state = tick(row, before)
    ticks++
    const diffs = differences(state, row.vehicle, FIELDS)
    if (diffs.length) divergences.push({ t: row.t, input: row.in, diffs })
    before = row
  }
  return { ticks, divergences }
}

function replayVehicle (version, rec, options = {}) {
  const mode = options.mode ?? 'trajectory'
  const type = vehicleType(fixtures.start(rec).vehicle) ?? ''
  if (isBoat(type)) return replayBoat(version, rec, { mode })
  // a happy ghast is steered in its harness only, a pig or strider by a rider holding its stick
  // (HappyGhast / Pig / Strider.getControllingPassenger)
  const unsteered = (type === 'happy_ghast' && !/_harness$/.test(rec.setup?.mount?.equipment?.body ?? '')) ||
    (STICKS[type] && !holds(rec, STICKS[type]))
  // (before 1.9 the server alone moves a ridden mob, EntityPig / EntityHorse only where !worldObj.isRemote: the client
  // eases it toward the server's moves)
  const clientMoves = registryFor(version).version['>=']('1.9')
  if (clientMoves && ((RIDDEN_MOBS.has(type) && !unsteered) || steeredLlama(version, type))) return replayRiddenMob(version, rec, { mode })
  if (!clientMoves && RIDDEN_MOBS.has(type)) return replayMinecart(version, rec, { mode, living: true })
  // before 1.11 a pig is its first passenger's to move without its stick too (canPassengerSteer), unsteered
  if (STICKS[type] && unsteered && registryFor(version).version['<']('1.11')) return replayRiddenMob(version, rec, { mode, steered: false })
  if (isMinecart(type) || type === 'cushion') return replayMinecart(version, rec, { mode })
  if (SERVER_DRIVEN_MOBS.has(type) || unsteered) return replayMinecart(version, rec, { mode, living: true })
  const first = fixtures.expand(rec)[0]
  return { ticks: 1, divergences: [{ t: first?.t ?? 1, input: first?.in ?? {}, diffs: [{ field: 'vehicle', expected: type, actual: 'no engine' }] }] }
}

module.exports = { replayVehicle }
