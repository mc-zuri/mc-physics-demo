'use strict'
// Replays a recorded case through mineflayer-physics-utils' BotcraftPhysics alone: no bot, no packets. The engine is
// handed what a correct bot would hand it (the vanilla keys and view, the attributes, effects and enchantments the
// server synced) and its state after every tick is compared with the vanilla client's.
//
//   mode 'trajectory': one continuous simulation, as a bot runs it.
//   mode 'stepwise':   every tick starts from vanilla's state after the tick before, so each tick's error is its own.
const { Vec3 } = require('vec3')
const conv = require('mineflayer/lib/conversions')
const { BotcraftPhysics, EPhysicsCtx, PhysicsWorldSettings, ControlStateHandler, initSetup } = require('@nxg-org/mineflayer-physics-util')
const { applyMdToNewEntity, CheapEffects } = require('@nxg-org/mineflayer-physics-util/dist/util/physicsUtils')
const { extractAttribute } = require('@nxg-org/mineflayer-physics-util/dist/physics/engines/botcraft')
const { registryFor } = require('./registry')
const { caseWorld } = require('./world')
const { createPistons } = require('./pistons')
const fixtures = require('./fixture')
const { differences } = require('./compare')
const { readClientbound } = require('./fakeClient')
const { replayVehicle } = require('./vehicles')
const nativeEngine = require('./nativeEngine')
require('./javaTrig')

// State the engine computes, compared on every tick.
const FIELDS = ['pos', 'vel', 'onGround', 'isCollidedHorizontally', 'isCollidedVertically', 'isInWater', 'isInLava',
  'isInWeb', 'elytraFlying']
const KEYS = ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak']
const POSES = { standing: 0, fall_flying: 1, sleeping: 2, swimming: 3, spin_attack: 4, crouching: 5, dying: 7 }

const engines = new Map()
function engineFor (version) {
  if (!engines.has(version)) {
    const registry = registryFor(version)
    initSetup(registry)
    engines.set(version, { registry, physics: nativeEngine.native ? nativeEngine.playerPhysics(registry) : new BotcraftPhysics(registry) })
  }
  return engines.get(version)
}

const camel = name => name.replace(/[._]([a-z])/g, (m, c) => c.toUpperCase())

// The key the engine reads an attribute under (BotcraftPhysics' extractAttribute), from the recorder's name for it.
// The recorder names some attributes without the generic./player. prefix minecraft-data still has (1.21.1's
// sneaking_speed is player.sneaking_speed there).
function attributeKey (physics, registry, name) {
  const bare = name.replace(/^(generic|player)\./, '')
  const known = [name, bare, `generic.${bare}`, `player.${bare}`].map(n => registry.attributesByName[camel(n)]).find(Boolean)
  if (!known) return null
  return extractAttribute(physics, known.name)
}

// The attributes as the client held them ({ value: base, modifiers }), the sprint modifier too: setSprinting adds
// and removes it, and a sync from the server without it drops it.
function attributesOf (physics, registry, row) {
  const out = {}
  for (const [name, value] of Object.entries(row.attributes ?? {})) {
    const key = attributeKey(physics, registry, name)
    if (!key) continue
    const synced = row.attributeModifiers?.[name]
    out[key] = synced
      ? { value: synced.base, modifiers: synced.modifiers.map(m => ({ uuid: m.id, amount: m.amount, operation: m.operation })) }
      : { value, modifiers: [] }
  }
  return out
}

const pascal = name => name.split('_').map(part => part[0].toUpperCase() + part.slice(1)).join('')

// The recorder's "jump_boost:1" (name:amplifier) as mineflayer's bot.entity.effects, keyed by effect id.
function effectsOf (registry, row) {
  const out = {}
  for (const entry of row.effects ?? []) {
    const [name, amplifier] = entry.split(':')
    const effect = registry.effectsByName[pascal(name)]
    if (effect) out[effect.id] = { id: effect.id, amplifier: Number(amplifier), duration: 0 }
  }
  return out
}

// The recorder's entities near the player as the engine's nearbyEntities, named as mineflayer names them for the
// engine (snake case: 1.8 - 1.10's "Boat" and "Shulker" are "boat" and "shulker"). Living: a mob or another player, by
// the 1.21.11 registry's type, else by the version's own category (older names).
const snakeCase = name => name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/\s+/g, '_').toLowerCase()
const LIVING_TYPES = new Set(['mob', 'animal', 'hostile', 'passive', 'ambient', 'water_creature', 'player'])
const LIVING_CATEGORIES = new Set(['Passive mobs', 'Hostile mobs'])
// Each pushes the player from where its own tick left it (afterTick): the tick's row has the entities after their ticks.
function nearbyEntitiesOf (registry, row, after) {
  const latest = registryFor('1.21.11')
  const { order, first } = tickOrder(registry, row)
  const entities = [...(row.entities ?? [])].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
  const boxOf = ([minX, minY, minZ, maxX, maxY, maxZ]) => ({ minX, minY, minZ, maxX, maxY, maxZ })
  return entities.map(({ id, type, pos, box }) => {
    const living = latest.entitiesByName[type] ? LIVING_TYPES.has(latest.entitiesByName[type].type) : LIVING_CATEGORIES.has(registry.entitiesByName[type]?.category)
    const ticked = after?.entities?.find(e => e.id === id)
    // (one the client ticks before the player is where its tick left it for the player's move too)
    const shown = first.has(id) && ticked ? ticked : { pos, box }
    return {
      name: snakeCase(type),
      living,
      position: new Vec3(...shown.pos),
      boundingBox: boxOf(shown.box),
      ticksBeforePlayer: first.has(id),
      afterTick: ticked && { position: new Vec3(...ticked.pos), boundingBox: boxOf(ticked.box) }
    }
  })
}

function enchantment (rec, slot, id) {
  return rec.setup?.equipment?.[slot]?.enchantments?.[id] ?? 0
}

const setVec = (vec, [x, y, z]) => vec.set(x, y, z)

// The engine state of a recorded snapshot: what the tick after it starts from.
function useRecorded (state, s) {
  setVec(state.pos, s.pos)
  setVec(state.vel, s.vel)
  state.onGround = s.onGround
  state.isCollidedHorizontally = s.isCollidedHorizontally
  state.isCollidedHorizontallyMinor = !!s.minorHorizontalCollision
  state.isCollidedVertically = s.isCollidedVertically
  state.isInWater = s.isInWater
  state.isUnderWater = !!s.isUnderWater
  state.isInLava = s.isInLava
  state.isInWeb = s.isInWeb
  if (s.stuckSpeedMultiplier) setVec(state.stuckSpeedMultiplier, s.stuckSpeedMultiplier)
  state.jumpTicks = s.jumpTicks
  state.sprinting = s.sprinting
  state.crouching = s.crouching
  state.swimming = !!s.swimming
  state.pose = POSES[s.pose] ?? 0
  state.fallFlying = s.elytraFlying
  state.flying = !!s.flying
  // the ticks the item in use has been used: the 72000-tick items (a trident) count down useItemRemainingTicks
  state.itemUseTicks = s.usingItem ? 72000 - s.useItemRemainingTicks : 0
}

// How many of the row's rockets the client attaches to the player. Before 1.14 a rocket keeps its shooter as an int
// whose 0 means none (EntityFireworkRocket: attached while the id is > 0), so a player whose entity id is 0 is never
// boosted; since 1.14 the shooter is an OptionalInt. (Rockets attach from 1.11.)
function attachedRockets (registry, row) {
  if (registry.version['<']('1.14') && !(row.netState?.entityId > 0)) return 0
  return row.fireworks?.length ?? 0
}

// The client's entity tick order: the ids of the row's entities in the order they tick, and those that tick before
// the player. 1.14 - 1.16 tick the entities of an Int2ObjectOpenHashMap (fastutil, 32 slots for a few entities,
// linear probing, filled in id order) from the last slot down, so an entity whose id lands in a higher slot than the
// player's ticks first; before 1.14 the entity list and since 1.17 EntityTickList keep the order they were added in,
// the player first.
function tickOrder (registry, row) {
  const ids = (row.entities ?? []).map(e => e.id)
  const playerId = row.netState?.entityId
  if (!ids.length || playerId == null || registry.version['<']('1.14') || registry.version['>=']('1.17')) return { order: ids, first: new Set() }
  let n = 32
  while (ids.length + 1 >= n * 0.75) n *= 2
  const slots = new Map()
  const taken = new Set()
  for (const id of [playerId, ...[...ids].sort((a, b) => a - b)]) {
    const h = Math.imul(id, 0x9E3779B9 | 0)
    let pos = (h ^ (h >>> 16)) & (n - 1)
    while (taken.has(pos)) pos = (pos + 1) & (n - 1)
    taken.add(pos)
    slots.set(id, pos)
  }
  const order = [...ids].sort((a, b) => slots.get(b) - slots.get(a))
  return { order, first: new Set(ids.filter(id => slots.get(id) > slots.get(playerId))) }
}

// How many of the row's rockets the client ticks before the player: they boost it before its own tick.
function rocketsBeforePlayer (registry, row) {
  if (!row.fireworks?.length) return 0
  const { first } = tickOrder(registry, row)
  const before = (row.entities ?? []).filter(e => e.type === 'firework_rocket' && first.has(e.id)).length
  return Math.min(before, row.fireworks.length)
}

// The food a tick sees: the row before's, then the food of the set_health packets the client handled before the tick.
// A row's own food is taken after its tick, so a packet the client handled after the tick shows there a row early
// (e_food_drop_mid_sprint on 1.20.4: food 7 in row 19, the sprint restarting at tick 20).
function foodOf (before, row) {
  let food = before.food ?? 20
  for (const packet of row.events.serverPackets ?? []) if (packet.after?.food !== undefined) food = packet.after.food
  return food
}

// The tick's input: the keys and view of the row, and what the server had synced by then. The row's attributes,
// effects and abilities already hold this tick's packets, which the client handles before it ticks.
function useInput (state, { physics, registry }, rec, row, before) {
  const input = row.in
  state.control = new ControlStateHandler(...KEYS.map(key => !!input[key]))
  state.yaw = conv.fromNotchianYaw(input.yaw)
  state.yawDegrees = input.yaw
  state.pitch = conv.fromNotchianPitch(input.pitch)
  state.attributes = attributesOf(physics, registry, row)
  state.effects = effectsOf(registry, row)
  // the levels PlayerState.update reads from bot.entity.effects
  state.jumpBoost = physics.getEffectLevel(CheapEffects.JUMP_BOOST, state.effects)
  state.speed = physics.getEffectLevel(CheapEffects.SPEED, state.effects)
  state.slowness = physics.getEffectLevel(CheapEffects.SLOWNESS, state.effects)
  state.dolphinsGrace = physics.getEffectLevel(CheapEffects.DOLPHINS_GRACE, state.effects)
  state.slowFalling = physics.getEffectLevel(CheapEffects.SLOW_FALLING, state.effects)
  state.levitation = physics.getEffectLevel(CheapEffects.LEVITATION, state.effects)
  state.blindness = physics.getEffectLevel(CheapEffects.BLINDNESS, state.effects)
  state.food = foodOf(before, row)
  state.gameMode = row.gameMode ?? rec.gamemode ?? 'survival'
  state.mayFly = state.gameMode === 'creative' || state.gameMode === 'spectator' || !!rec.setup?.flying
  state.flySpeed = row.attributes?.['abilities.flyingSpeed'] ?? 0.05
  state.isUsingItem = !!row.usingItem
  state.isUsingMainHand = state.isUsingItem
  state.isUsingOffHand = false
  state.depthStrider = enchantment(rec, 'feet', 'depth_strider')
  state.riptide = enchantment(rec, 'mainhand', 'riptide')
  state.soulSpeed = enchantment(rec, 'feet', 'soul_speed')
  state.swiftSneak = enchantment(rec, 'legs', 'swift_sneak')
  state.validElytraEquipped = rec.setup?.equipment?.chest?.id === 'elytra'
  state.autoJumpEnabled = !!rec.setup?.autoJump
  state.canWalkOnPowderSnow = rec.setup?.equipment?.feet?.id === 'leather_boots'
  const rockets = attachedRockets(registry, row)
  state.fireworkRocketDuration = rockets > 0 ? 1 : 0
  state.fireworkRockets = rockets
  state.fireworkRocketsBeforePlayer = Math.min(rocketsBeforePlayer(registry, row), rockets)
}

// The server's position corrections (teleports), whose handling the recorder keeps as the position and motion they left.
const POSITION_PACKETS = new Set(['PlayerPositionLookS2CPacket', 'minecraft:player_position'])
const SET_ENTITY_DATA = new Set(['minecraft:set_entity_data', 'EntityTrackerUpdateS2CPacket'])
// the pose entry of an entity's synced data (1.14 - 1.16: index 6, serializer 18)
const POSE_KEY = 6
const POSE_TYPE = 18

// What the server sent before the tick, as the client applied it. The server sends an explosion's packet as it
// explodes and the motion it gave the player with its entity tracker later in that tick, so the explosion's knockback
// comes first and a velocity packet after it replaces the velocity.
function useEvents (state, world, events, { physics, version, entityId }) {
  for (const { type, after } of events.serverPackets ?? []) {
    if (!POSITION_PACKETS.has(type) || !after) continue
    if (after.pos) setVec(state.pos, after.pos)
    if (after.vel) setVec(state.vel, after.vel)
  }
  for (const [x, y, z] of events.explosionKnockback ?? []) state.vel.translate(x, y, z)
  for (const [target, x, y, z] of events.velocityPackets ?? []) {
    if (target === 0) state.vel.set(x, y, z)
  }
  for (const p of events.serverPackets ?? []) if (p.after && p.after.elytraFlying !== undefined) state.fallFlying = p.after.elytraFlying
  // the pose and swimming flag the server's entity data sets (the client takes them as they come)
  for (const p of events.serverPackets ?? []) {
    if (p.after?.pose !== undefined && POSES[p.after.pose] !== undefined) state.pose = POSES[p.after.pose]
    if (p.after?.swimming !== undefined) state.swimming = p.after.swimming
  }
  // The player's pose set from synced entity data refits the box (Entity.refreshDimensions, 1.14 - 1.16)
  for (const { type, bytes } of events.serverPackets ?? []) {
    if (!SET_ENTITY_DATA.has(type)) continue
    const packet = readClientbound(version, fixtures.bytesOf(bytes))
    if (packet?.params.entityId === entityId && packet.params.metadata.some(({ key, type }) => key === POSE_KEY && type === POSE_TYPE)) {
      physics.refreshDimensions(state)
    }
  }
}

// A minimal bot for EPhysicsCtx.FROM_BOT, standing where the recording starts.
function botAt (registry, version, start) {
  const control = {}
  const bot = {
    version,
    registry,
    entity: {
      position: new Vec3(...start.pos),
      velocity: new Vec3(...start.vel),
      onGround: start.onGround,
      yaw: conv.fromNotchianYaw(start.yaw),
      pitch: conv.fromNotchianPitch(start.pitch),
      effects: {},
      attributes: {},
      equipment: []
    },
    inventory: { slots: [] },
    food: start.food ?? 20,
    game: { gameMode: start.gameMode ?? 'survival' },
    getControlState: name => !!control[name],
    setControlState: (name, value) => { control[name] = value },
    getEquipmentDestSlot: () => 0
  }
  bot.entity = applyMdToNewEntity(EPhysicsCtx, registry.entitiesByName.player, bot.entity)
  return bot
}

function replay (version, rec, { mode = 'trajectory', fields = FIELDS } = {}) {
  // a riding case replays the vehicle the client steered (lib/vehicles.js)
  if (fixtures.start(rec).vehicle) return replayVehicle(version, rec, { mode })
  const engine = engineFor(version)
  const { registry, physics } = engine
  const fixture = fixtures.load(version)
  const world = caseWorld(fixture, rec)
  const pistons = createPistons(version, world)
  const start = fixtures.start(rec)
  const rows = fixtures.expand(rec)
  const ctx = EPhysicsCtx.FROM_BOT(physics, botAt(registry, version, start), new PhysicsWorldSettings(registry))
  const state = ctx.state
  useRecorded(state, start)
  const divergences = []
  rows.forEach((row, i) => {
    const before = i > 0 ? rows[i - 1] : start
    if (mode === 'stepwise' && i > 0) {
      useRecorded(state, before)
      // the recorder takes the stuck multiplier as the move starts, so the row holds what the last tick's blocks set
      if (row.stuckSpeedMultiplier) setVec(state.stuckSpeedMultiplier, row.stuckSpeedMultiplier)
    }
    useInput(state, engine, rec, row, before)
    // the other entities as they were when the player ticked: they tick after it
    state.nearbyEntities = nearbyEntitiesOf(registry, before, row)
    useEvents(state, world, row.events, { physics, version, entityId: start.netState?.entityId ?? 1 })
    // the block changes and the pistons' block events, in the order the client took them
    pistons.receive(row.events.serverPackets, row.events.blockChanges)
    physics.simulate(ctx, world)
    // the moving pistons tick after the player and push it
    pistons.tick(piston => physics.pushByMovingPiston(ctx, world, piston))
    const diffs = differences(state, row, fields)
    if (diffs.length) divergences.push({ t: row.t, input: row.in, diffs })
  })
  return { ticks: rows.length, divergences }
}

module.exports = { FIELDS, replay, attributeKey, nearbyEntitiesOf }
