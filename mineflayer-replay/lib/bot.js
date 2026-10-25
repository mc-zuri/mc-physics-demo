'use strict'
// Replays a recorded case through a whole mineflayer bot. The bot is put where the vanilla client was when the case
// began (its world, position, motion and what it last sent the server), then each client tick gets the server packets
// the client received, the keys and view it had, and runs once (physicsManual). The movement packets the bot writes
// during a tick must be the client's to the byte; its state after the tick must be the client's. The player's hands
// (lib/interact.js) drive mineflayer's interaction API from the same keys and from the screen clicks; the interaction
// packets the bot writes in a tick (digging, using, attacking, clicking in screens...) must be the client's, field by
// field, and are kept apart (`interaction`) so that a movement divergence stays readable.
const path = require('path')
const mc = require('minecraft-protocol')
const mineflayer = require('mineflayer')
const conv = require('mineflayer/lib/conversions')
const { JavaFloat } = require('mineflayer/lib/javamath')
const { Vec3 } = require('vec3')
const fixtures = require('./fixture')
const { registryFor } = require('./registry')
const { caseWorld } = require('./world')
const { createFakeClient, serverboundName, readServerbound, readClientbound } = require('./fakeClient')
const { differences, packetListDifference } = require('./compare')
const { INTERACTION, createHands, recordedSequenceStart } = require('./interact')
const nativeEngine = require('./nativeEngine')
require('./javaTrig')

const KEYS = ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak']
// minecraft-protocol's names of the packets a client tick sends about movement and input
const MOVEMENT = new Set(['position', 'position_look', 'look', 'flying', 'player_input', 'entity_action', 'tick_end',
  'teleport_confirm', 'steer_vehicle', 'vehicle_move', 'steer_boat'])
const FIELDS = ['pos', 'vel', 'onGround']
const GAME_MODES = { survival: 0, creative: 1, adventure: 2, spectator: 3 }
// the recorder's pose names as the Pose ordinals the engine keeps
const POSES = { standing: 0, fall_flying: 1, sleeping: 2, swimming: 3, spin_attack: 4, crouching: 5, dying: 7 }

function loginPacket (registry, start, rec) {
  const gameMode = GAME_MODES[start.gameMode ?? rec.gamemode ?? 'survival']
  const entityId = start.netState?.entityId ?? 1
  if (registry.supportFeature('usesLoginPacket')) {
    const packet = structuredClone(registry.loginPacket)
    packet.entityId = entityId
    if (packet.worldState) packet.worldState.gamemode = Object.keys(GAME_MODES)[gameMode]
    else packet.gameMode = gameMode
    return packet
  }
  return { entityId, levelType: 'default', gameMode, dimension: 0, difficulty: 0, maxPlayers: 20, reducedDebugInfo: false }
}

// The case's equipment (rec.setup.equipment) and inventory (rec.setup.inventory, by inventory index: the hotbar is
// 0 - 8) as the server gives them: a set_slot into the player's inventory window per item, encoded and decoded with
// the version's codec, then the selected hotbar slot (set_carried_item). (prismarine-item does not encode
// enchantments as 1.20.5+ components: the enchantments component is added here, by the enchantments' registry ids.)
// The set_slot packets carry the state id the client's container packets had left it (1.17.1+), which its first
// window click tells when no container packet of the case came before; with nothing to give, an empty crafting result
// slot carries it.
const EQUIPMENT_SLOTS = { head: 5, chest: 6, legs: 7, feet: 8, mainhand: 36, offhand: 45 }
// (the names before 1.13's flattening: "name:metadata")
const ITEM_NAMES = {
  firework_rocket: ['firework_rocket', 'fireworks'],
  oak_sign: ['oak_sign', 'sign'],
  oak_planks: ['oak_planks', 'planks:0'],
  oak_log: ['oak_log', 'log:0'],
  lapis_lazuli: ['lapis_lazuli', 'dye:4'],
  poppy: ['poppy', 'red_flower:0'],
  music_disc_13: ['music_disc_13', 'record_13']
}
// the version's name of a recorded item, and its metadata before 1.13: [name, metadata], [''] when the version has none
const versionItemName = (registry, id) => ((ITEM_NAMES[id] ?? [id]).find(name => registry.itemsByName[name.split(':')[0]]) ?? '').split(':')
// (the player inventory's own indexes as its window numbers them: the hotbar 36 - 44, the main slots 9 - 35, the armor
// 36 - 39 from the feet up at 8 - 5, the offhand 40 at 45)
const inventorySlot = index => index < 9 ? 36 + index : index < 36 ? index : index < 40 ? 44 - index : index === 40 ? 45 : undefined
function equip (client, registry, version, rec, stateId = 0) {
  const Item = require(require.resolve('prismarine-item', { paths: [path.dirname(require.resolve('mineflayer'))] }))(registry)
  const serializer = mc.createSerializer({ state: 'play', isServer: true, version })
  const give = (slot, { id, count = 1, enchantments = {} }) => {
    const [name, metadata = 0] = versionItemName(registry, id)
    if (!name || slot === undefined) return
    const item = new Item(registry.itemsByName[name].id, count, Number(metadata))
    const enchants = Object.entries(enchantments).map(([name, lvl]) => ({ name, lvl }))
    if (enchants.length) item.enchants = enchants
    const notch = Item.toNotch(item)
    if (Array.isArray(notch.components) && enchants.length) {
      const levels = enchants.map(({ name, lvl }) => ({ id: registry.enchantmentsByName[name].id, level: lvl }))
      notch.components.push({ type: 'enchantments', data: { enchantments: levels, showTooltip: true } })
      notch.addedComponentCount = notch.components.length
    }
    const params = { windowId: 0, stateId, slot, item: notch }
    client.receiveBytes(serializer.createPacketBuffer({ name: 'set_slot', params }))
    given++
  }
  let given = 0
  for (const [slot, spec] of Object.entries(rec.setup?.equipment ?? {})) give(EQUIPMENT_SLOTS[slot], spec)
  for (const [index, spec] of Object.entries(rec.setup?.inventory ?? {})) give(inventorySlot(Number(index)), spec)
  if (!given && stateId) {
    const params = { windowId: 0, stateId, slot: 0, item: Item.toNotch(null) }
    client.receiveBytes(serializer.createPacketBuffer({ name: 'set_slot', params }))
  }
  if (rec.setup?.selected != null) {
    client.receiveBytes(serializer.createPacketBuffer({ name: 'held_item_slot', params: { slot: rec.setup.selected } }))
  }
}

const pascal = name => name.split('_').map(part => part[0].toUpperCase() + part.slice(1)).join('')
const camel = name => name.replace(/[._]([a-z])/g, (m, c) => c.toUpperCase())
const unprefixed = name => name.replace(/^minecraft:/, '')

// The cases whose player the recorder lets be hurt (the catalog's `mortal: true`, which the recorded case does not
// carry)
const MORTAL = new Set(['m_click_air_full_food_snowball', 'm_damage_food', 'm_death_respawn', 'm_more_explosion',
  'm_more_explosion_armor', 'm_more_explosion_cover', 'r_free_play'])

// Whether the recorder made the case's player invulnerable, which no recorded packet tells. From its 1.14.4 adapter on
// it does in every case but a mortal one (BridgeImpl.setGameMode, for want of damage game rules before 1.15): such a
// player eats on a full stomach from 1.15 and not even hungry before (Player.canEat: q_eat_walk on 1.15.2, which eats
// at food 20; q_eat_until_done on 1.14.4, which does not at 12). Before 1.14, the coverage cases' player.
function recorderInvulnerable (registry, rec) {
  if (!registry.version['>=']('1.14')) return (rec.tags ?? []).includes('coverage')
  return !(rec.mortal ?? MORTAL.has(rec.name))
}

// The player's abilities when the case began, as the server sends them (ClientboundPlayerAbilitiesPacket): its game
// mode's (GameType.updatePlayerAbilities), may fly where the case let it (setup.flying), and flying as the client was.
function receiveAbilities (client, registry, start, rec) {
  const gameMode = start.gameMode ?? rec.gamemode ?? 'survival'
  const creative = gameMode === 'creative'
  const spectator = gameMode === 'spectator'
  const mayFly = creative || spectator || !!rec.setup?.flying
  const invulnerable = creative || spectator || recorderInvulnerable(registry, rec)
  const flags = (invulnerable ? 1 : 0) | (start.flying || spectator ? 2 : 0) | (mayFly ? 4 : 0) | (creative ? 8 : 0)
  client.receiveWritten('abilities', { flags, flyingSpeed: start.attributes?.['abilities.flyingSpeed'] ?? 0.05, walkingSpeed: 0.1 })
}

// The effects and attributes the server had synced when the case began, as the packets that synced them: the recorder's
// "speed:0" (name:amplifier) effects, and every attribute with the modifiers it holds.
function receiveSynced (client, registry, start) {
  const entityId = start.netState?.entityId ?? 1
  for (const entry of start.effects ?? []) {
    const [name, amplifier] = entry.split(':')
    const effect = registry.effectsByName[pascal(name)]
    if (effect) client.receiveWritten('entity_effect', { entityId, effectId: effect.id, amplifier: Number(amplifier), duration: 32767, hideParticles: 0, flags: 0 })
  }
  const packetName = registry.version['>=']('1.9') ? 'entity_update_attributes' : 'update_attributes'
  const [keyField] = registry.protocol.play.toClient.types[`packet_${packetName}`][1][1].type[1].type[1]
  const properties = []
  for (const [name, value] of Object.entries(start.attributes ?? {})) {
    // (minecraft-data keeps the generic./player. prefix the recorder drops: 1.21.1's sneaking_speed is player.sneaking_speed)
    const bare = name.replace(/^(generic|player)\./, '')
    const attribute = [name, bare, `generic.${bare}`, `player.${bare}`].map(n => registry.attributesByName[camel(n)]).find(Boolean)
    if (!attribute) continue
    // the attribute's name as the protocol writes it: its registry name (namespaced from 1.16), from 1.20.5 its id
    let key = registry.version['>=']('1.16') ? `minecraft:${unprefixed(attribute.resource)}` : attribute.resource
    if (Array.isArray(keyField.type)) {
      key = Object.values(keyField.type[1].mappings).find(mapped => unprefixed(mapped) === unprefixed(attribute.resource))
      if (key === undefined) continue
    }
    const synced = start.attributeModifiers?.[name]
    properties.push({
      [keyField.name]: key,
      value: synced ? synced.base : value,
      modifiers: (synced?.modifiers ?? []).map(m => ({ uuid: m.id, amount: m.amount, operation: m.operation }))
    })
  }
  if (properties.length) client.receiveWritten(packetName, { entityId, properties })
}

// The case's area as chunk columns, built once per version and area and copied for each replay.
const columns = new Map()
function columnsOf (bot, fixture, rec) {
  const key = `${fixture.version}/${rec.area}/${bot.game.minY}/${bot.game.height}`
  if (!columns.has(key)) {
    const Chunk = require('prismarine-chunk')(bot.registry)
    const world = caseWorld(fixture, rec)
    const area = world.area
    const air = world.stateIdAt(Number.MAX_SAFE_INTEGER, 0, 0)
    const built = new Map()
    const columnAt = (x, z) => {
      const id = `${x >> 4},${z >> 4}`
      if (!built.has(id)) built.set(id, new Chunk({ minY: bot.game.minY ?? 0, worldHeight: bot.game.height ?? 256 }))
      return built.get(id)
    }
    for (let x = area.min[0]; x <= area.max[0]; x++) {
      for (let z = area.min[2]; z <= area.max[2]; z++) {
        const column = columnAt(x, z)
        for (let y = area.min[1]; y <= area.max[1]; y++) {
          const stateId = world.stateIdAt(x, y, z)
          if (stateId !== air) column.setBlockStateId(new Vec3(x & 15, y, z & 15), stateId)
        }
      }
    }
    columns.set(key, [...built].map(([id, column]) => [...id.split(',').map(Number), column.toJson()]))
  }
  const Chunk = require('prismarine-chunk')(bot.registry)
  return columns.get(key).map(([x, z, json]) => [x, z, Chunk.fromJson(json)])
}

function setLook (bot, yaw, pitch) {
  bot.entity.yawDegrees = new JavaFloat(yaw)
  bot.entity.pitchDegrees = new JavaFloat(pitch)
  bot.entity.yaw = conv.fromNotchianYaw(yaw)
  bot.entity.pitch = conv.fromNotchianPitch(pitch)
}

function setKeys (bot, input) {
  for (const key of KEYS) {
    if (bot.getControlState(key) !== !!input[key]) bot.setControlState(key, !!input[key])
  }
}

// The Leave Bed button (InBedChatScreen.sendWakeUp), a click the client handles before its tick: where the recorded
// client sent its STOP_SLEEPING, the sleeping bot wakes up (bot.wake).
function leaveBed (bot, version, row) {
  const stops = (row.events.clientPackets ?? []).some(p => {
    const packet = readServerbound(version, fixtures.bytesOf(p.bytes))
    return packet?.name === 'entity_action' && packet.params.actionId === 'stop_sleeping'
  })
  if (stops && bot.isSleeping) bot.wake().catch(() => {})
}

// The client's state when the case began: motion, contacts, and what it last sent the server (LocalPlayer's xLast,
// yRotLast, lastOnGround, positionReminder, wasSprinting, lastSentInput).
function useStart (bot, start) {
  const entity = bot.entity
  entity.position.set(...start.pos)
  entity.velocity.set(...start.vel)
  entity.onGround = start.onGround
  // (the engine's record of the tick before: the warm-up tick ran right after a teleport, which clears ground contact)
  entity.lastOnGround = start.onGround
  entity.isCollidedHorizontally = start.isCollidedHorizontally
  entity.isCollidedVertically = start.isCollidedVertically
  entity.isInWater = start.isInWater
  // the swimming flag the client had (Entity.updateSwimming keeps a swimmer swimming while sprinting in water)
  entity.swimming = !!start.swimming
  entity.isInLava = start.isInLava
  entity.isInWeb = start.isInWeb
  // the powder snow the client's last block effects touched (Entity.isInPowderSnow, shifted into wasInPowderSnow at
  // the tick start); the warm-up tick's are not the client's
  entity.isInPowderSnow = !!start.isInPowderSnow
  // the eyes in water as the client had them (Entity.wasUnderwater); the warm-up tick's own eyes are not the client's
  entity.isUnderWater = !!start.isUnderWater
  entity.eyeInWater = !!start.isUnderWater
  entity.sprinting = start.sprinting
  // the pose the client's last tick set (Player.updatePlayerPose); the warm-up tick's is not the client's
  if (POSES[start.pose] !== undefined) entity.pose = POSES[start.pose]
  entity.crouching = start.crouching
  bot.jumpTicks = start.jumpTicks
  // what the blocks of the tick before left for the first tick (Entity.stuckSpeedMultiplier): the engine keeps it in
  // its own state, where the warm-up tick inside a cobweb or bush set it
  const state = bot.physicsEngineCtx?.state
  if (state && start.stuckSpeedMultiplier) state.stuckSpeedMultiplier.set(...start.stuckSpeedMultiplier)
  const net = start.netState ?? {}
  const sent = bot._lastSent
  if (net.lastPos) [sent.x, sent.y, sent.z] = net.lastPos
  sent.yaw = net.lastYaw ?? start.yaw
  sent.pitch = net.lastPitch ?? start.pitch
  sent.onGround = net.lastOnGround ?? start.onGround
  sent.flags = { onGround: sent.onGround, hasHorizontalCollision: !!net.lastHorizontalCollision }
  sent.positionReminder = net.positionReminder ?? 0
  sent.sprintState = !!net.wasSprinting
  const held = net.lastSentInput
  sent.sneakState = held ? held[5] : !!net.wasSneaking
  if (held) sent.previousInputState = { forward: held[0], back: held[1], left: held[2], right: held[3], jump: held[4], sneak: held[5], sprint: held[6] }
}

// The other entities the client held when the case began, in bot.entities as their spawn packets would have left them
// (the server's later packets about them then move them).
function useEntities (bot, start) {
  const Entity = require(require.resolve('prismarine-entity', { paths: [require.resolve('mineflayer')] }))(bot.version)
  for (const { id, type, pos, vel, yaw, pitch, onGround, box, yBodyRot, yHeadRot } of start.entities ?? []) {
    const data = bot.registry.entitiesByName[type]
    const entity = bot.entities[id] ?? (bot.entities[id] = new Entity(id))
    Object.assign(entity, { type: data?.type ?? 'other', name: type, displayName: data?.displayName, entityType: data?.id, kind: data?.category, width: data?.width, height: data?.height })
    entity.position.set(...pos)
    entity.velocity.set(...vel)
    // (and the float degrees the client held, whole turns kept: a vehicle sends them back in vehicle_move)
    if (yaw !== undefined) {
      entity.yaw = conv.fromNotchianYaw(yaw)
      entity.yawDegrees = new JavaFloat(yaw)
    }
    if (pitch !== undefined) {
      entity.pitch = conv.fromNotchianPitch(pitch)
      entity.pitchDegrees = new JavaFloat(pitch)
    }
    if (onGround !== undefined) entity.onGround = onGround
    // the box the client kept (before 1.17 its position is the box's centre): a mount the bot steers moves it on
    if (box !== undefined) entity.box = box
    useBodyRotation(entity, { pos, yBodyRot, yHeadRot })
    // the packet position the server's relative moves add to, as its spawn left it (Entity.recreateFromPacket)
    bot.entityInterpolation?.spawn(entity)
  }
}

// A mob's head and body rotation as the recording has them (yHeadRot, yBodyRot), its body settled: the head stable for
// long enough that BodyRotationControl turns the body to it (headStableTime past 20)
function useBodyRotation (entity, { pos, yBodyRot, yHeadRot }) {
  if (yHeadRot !== undefined) entity.headYawDegrees = Math.fround(yHeadRot)
  if (yBodyRot !== undefined) entity.bodyYawDegrees = Math.fround(yBodyRot)
  if (yHeadRot !== undefined) entity.body = { headStableTime: 20, lastStableYHeadRot: Math.fround(yHeadRot), last: { x: pos[0], z: pos[2] } }
}

// The vehicle the client rode when the case began, as the server put it there: set_passengers (1.9+), attach_entity before.
// A horse the case rode was tame and saddled (the recorder's mount): its AbstractHorse flags (DATA_ID_FLAGS, bits 2 and
// 4) as its metadata gave them, at the version's index (an int at 16 on 1.8, 12 on 1.9, 13 to 1.13, 15 on 1.14, 16 on
// 1.15 - 1.16, 17 since), and from 1.21.5 the saddle it wears (EquipmentSlot.SADDLE, slot 7).
const HORSE_TYPES = new Set(['horse', 'donkey', 'mule', 'skeleton_horse', 'zombie_horse', 'llama', 'trader_llama', 'camel', 'camel_husk'])
// a nautilus the case rode was saddled too (AbstractNautilus: EquipmentSlot.SADDLE)
const NAUTILUS_TYPES = new Set(['nautilus', 'zombie_nautilus'])
// the equipment slots of the mount's setup (setup.mount.equipment) as mineflayer's entity.equipment indexes them
const MOUNT_EQUIPMENT_SLOTS = { body: 6, saddle: 7 }
// A mount made ready to ride (the recorder's mount, a summon marked ready): a horse tame and saddled, from 1.21.5 a
// saddle in its saddle slot (so a nautilus too), its MOVEMENT_SPEED and JUMP_STRENGTH as the server synced them (from
// the vehicle state the recording has of it); and what it wore (a happy ghast's harness in its body slot).
// 1.8 - 1.10's EntityHorse is every horse, its variant in its synced data ("type": a byte at 19 on 1.8, an int after its
// flags from 1.9)
const LEGACY_HORSE_VARIANTS = ['horse', 'donkey', 'mule', 'zombie_horse', 'skeleton_horse']
const LEGACY_ENTITY_NAMES = { ...Object.fromEntries(LEGACY_HORSE_VARIANTS.map(name => [name, 'EntityHorse'])), pig: 'Pig', boat: 'Boat', oak_boat: 'Boat', minecart: 'MinecartRideable' }
function prepareMount (vehicle, registry, { ready = true, attributes = null, equipment = {}, as = null } = {}) {
  const Item = require(require.resolve('prismarine-item', { paths: [require.resolve('mineflayer')] }))(registry)
  const v = registry.version
  if (ready && (HORSE_TYPES.has(vehicle.name) || vehicle.name === 'EntityHorse')) {
    const named = registry.entitiesByName.horse?.metadataKeys?.indexOf('flags') ?? -1
    const flagsIndex = named >= 0 ? named : v['<']('1.9') ? 16 : v['<']('1.10') ? 12 : v['<']('1.14') ? 13 : v['<']('1.15') ? 15 : v['<']('1.17') ? 16 : 17
    vehicle.metadata ??= []
    vehicle.metadata[flagsIndex] = 0x02 | 0x04
    // (the variant the recorder spawned)
    if (vehicle.name === 'EntityHorse' && LEGACY_HORSE_VARIANTS.includes(as)) vehicle.metadata[v['<']('1.9') ? 19 : flagsIndex + 1] = LEGACY_HORSE_VARIANTS.indexOf(as)
    if (v['>=']('1.21.5') && registry.itemsByName.saddle) vehicle.setEquipment(7, new Item(registry.itemsByName.saddle.id, 1))
    // the mount's MOVEMENT_SPEED and JUMP_STRENGTH, as the server synced them before the case began
    vehicle.attributes ??= {}
    if (attributes?.movementSpeed != null) vehicle.attributes['generic.movement_speed'] = { value: attributes.movementSpeed, modifiers: [] }
    if (attributes?.jumpStrength != null) vehicle.attributes['horse.jump_strength'] = { value: attributes.jumpStrength, modifiers: [] }
  }
  if (ready && NAUTILUS_TYPES.has(vehicle.name) && registry.itemsByName.saddle) vehicle.setEquipment(7, new Item(registry.itemsByName.saddle.id, 1))
  // a pig or strider made ready wears a saddle: its saddle flag until 1.21.5 (Pig / Strider DATA_SADDLE_ID), the saddle
  // slot since
  if (ready && (vehicle.name === 'pig' || vehicle.name === 'strider')) {
    const saddleIndex = registry.entitiesByName[vehicle.name]?.metadataKeys?.indexOf('saddle') ?? -1
    if (v['>=']('1.21.5') && registry.itemsByName.saddle) vehicle.setEquipment(7, new Item(registry.itemsByName.saddle.id, 1))
    else if (saddleIndex >= 0) (vehicle.metadata ??= [])[saddleIndex] = true
  }
  for (const [slot, name] of Object.entries(equipment)) {
    if (MOUNT_EQUIPMENT_SLOTS[slot] === undefined || !registry.itemsByName[name]) continue
    vehicle.setEquipment(MOUNT_EQUIPMENT_SLOTS[slot], new Item(registry.itemsByName[name].id, 1))
  }
}

// A mob's flags in its synced data (Mob.DATA_MOB_FLAGS_ID, bit 1 no AI): minecraft-data names it from 1.19.4; before,
// its index after the entity and living entity data of the version (1.9 has no no_gravity yet, 1.14 adds the pose and
// the sleeping position, 1.15 the stinger count, 1.17 the frozen ticks)
function mobFlagsIndex (registry, name) {
  const named = registry.entitiesByName[name]?.metadataKeys?.indexOf('mob_flags') ?? -1
  if (named >= 0 || registry.entitiesByName[name]?.metadataKeys) return named
  const v = registry.version
  if (v['<']('1.9')) return -1
  if (v['<']('1.10')) return 10
  if (v['<']('1.14')) return 11
  if (v['<']('1.15')) return 13
  if (v['<']('1.17')) return 14
  return 15
}

// The entities the case summoned (setup.summon) as the server had set them up: without AI (Mob's flags, bit 1), made
// ready to ride, wearing their equipment; a mount's attributes from the recording's state of it once ridden.
function useSummons (bot, registry, start, rec) {
  const rows = fixtures.expand(rec)
  for (const spec of rec.setup?.summon ?? []) {
    // (before 1.11 the recorder names the entity by its class: EntityHorse for every horse, Pig...)
    const known = (start.entities ?? []).find(e => e.type === spec.entity || e.type === LEGACY_ENTITY_NAMES[spec.entity])
    const entity = known && bot.entities[known.id]
    if (!entity) continue
    const flags = mobFlagsIndex(registry, entity.name)
    if (spec.noAi && flags >= 0) {
      entity.metadata ??= []
      entity.metadata[flags] = (entity.metadata[flags] ?? 0) | 0x01
    }
    const ridden = rows.find(row => row.vehicle?.type === spec.entity)?.vehicle
    prepareMount(entity, registry, { ready: !!spec.ready, attributes: ridden, equipment: spec.equipment ?? {}, as: spec.entity })
  }
}

// The mobs the case summoned by its setup commands (summon <entity> ... {NBT}, the command of the newest version key the
// version reaches), as their NBT set them up: without AI (NoAI: Mob's flags, bit 1), a horse tame (Tame: AbstractHorse's
// flags, bit 2)
function useCommandSummons (bot, registry, start, rec) {
  const v = registry.version
  const taken = new Set()
  for (const entry of rec.setup?.commands ?? []) {
    const keys = typeof entry === 'string' ? null : Object.keys(entry).filter(key => v['>='](key)).sort((a, b) => registryFor(a).version['>'](b) ? -1 : 1)
    const command = typeof entry === 'string' ? entry : keys?.length ? entry[keys[0]] : null
    const match = /\bsummon (?:minecraft:)?(\w+)[^{]*(\{.*\})?/.exec(command ?? '')
    if (!match) continue
    const [, name, nbt = ''] = match
    const known = (start.entities ?? []).find(e => !taken.has(e.id) && (e.type === name || LEGACY_ENTITY_NAMES[e.type] === name || e.type === LEGACY_ENTITY_NAMES[name]))
    const entity = known && bot.entities[known.id]
    if (!entity) continue
    taken.add(known.id)
    entity.metadata ??= []
    const mobFlags = mobFlagsIndex(registry, entity.name)
    if (/\bNoAI:1b/.test(nbt) && mobFlags >= 0) entity.metadata[mobFlags] = (entity.metadata[mobFlags] ?? 0) | 0x01
    if (/\bTame:1b/.test(nbt) && (HORSE_TYPES.has(entity.name) || entity.name === 'EntityHorse')) {
      const named = registry.entitiesByName.horse?.metadataKeys?.indexOf('flags') ?? -1
      const flagsIndex = named >= 0 ? named : v['<']('1.9') ? 16 : v['<']('1.10') ? 12 : v['<']('1.14') ? 13 : v['<']('1.15') ? 15 : v['<']('1.17') ? 16 : 17
      entity.metadata[flagsIndex] = (entity.metadata[flagsIndex] ?? 0) | 0x02
    }
  }
}

// The packet position the client keeps for the vehicle (the base the server's relative moves add to,
// VecDeltaCodec): the server's own, which can lag where the client moved the vehicle it steers. The first move the
// server sends tells it, while the vehicle stands still where the client put it (the recorder's vehicleServer, the
// server's vehicle that tick, is the client's vehicle of the two ticks before): that position as the move encodes it
// (rounded to 1/4096 from 1.19, floored before), less the move.
// The packet position a relative move of d (1/4096) started from, for the position v it led to: an axis the move leaves
// keeps the position; else the position encoded as VecDeltaCodec.encode does (Math.round from 1.19.3, Mth.lfloor
// before), less the move
function packetPositionBefore (registry, v, d) {
  if (d === 0) return v
  const encoded = registry.version['>=']('1.19.3') ? Math.round(v * 4096) : Math.floor(v * 4096)
  return (encoded - d) / 4096
}

function useVehiclePacketBase (bot, registry, rec, vehicle) {
  if (!bot.entityInterpolation?.controlledTeleport || registry.version['<']('1.9')) return
  const version = registry.version.minecraftVersion
  const same = (a, b) => a && b && a.every((v, i) => v === b[i])
  let earlier = null
  let before = fixtures.start(rec)
  for (const row of fixtures.expand(rec)) {
    if (!row.vehicle) return
    // (one server tick in the row: the move is that tick's)
    const reported = row.events.vehicleServer?.length === 1 ? row.events.vehicleServer[0].pos : null
    const server = same(reported, before.vehicle?.pos) && same(reported, earlier?.vehicle?.pos) ? reported : null
    earlier = before
    before = row
    for (const entry of row.events.serverPackets ?? []) {
      for (const part of entry.packets ?? [entry]) {
        if (!/move_entity_pos|rel_entity_move|entity_move_look|EntityS2CPacket\$(MoveRelative|RotateAndMoveRelative)/.test(part.type ?? '')) continue
        const packet = readClientbound(version, fixtures.bytesOf(part.bytes ?? ''))
        if (packet?.params.entityId !== vehicle.id) continue
        // (the first move only: a later one may start from where the server moved the vehicle since)
        if (!server) return
        // (from 26.3 a VecDelta: one delta, or chained steps, their sum)
        const steps = packet.params.delta ? (packet.params.delta.steps ?? [packet.params.delta]) : [packet.params]
        const { dX, dY, dZ } = steps.reduce((sum, step) => ({ dX: sum.dX + step.dX, dY: sum.dY + step.dY, dZ: sum.dZ + step.dZ }), { dX: 0, dY: 0, dZ: 0 })
        // (an axis the move leaves keeps the server's position)
        const back = (v, d) => packetPositionBefore(registry, v, d)
        bot.entityInterpolation.controlledTeleport(vehicle, back(server[0], dX), back(server[1], dY), back(server[2], dZ))
        return
      }
    }
  }
}

function useVehicle (bot, client, registry, start, rec) {
  const vehicleId = start.netState?.vehicleId
  if (vehicleId == null) return
  const entityId = start.netState?.entityId ?? 1
  const vehicle = bot.entities[vehicleId]
  if (vehicle) prepareMount(vehicle, registry, { attributes: start.vehicle, equipment: rec?.setup?.mount?.equipment ?? {}, as: rec?.setup?.mount?.entity })
  // the recorder's mount without AI (setup.mount.noAi: Mob's flags, bit 1)
  const mobFlags = vehicle && rec?.setup?.mount?.noAi ? mobFlagsIndex(registry, vehicle.name) : -1
  if (mobFlags >= 0) {
    vehicle.metadata ??= []
    vehicle.metadata[mobFlags] = (vehicle.metadata[mobFlags] ?? 0) | 0x01
  }
  if (vehicle && start.vehicle) useBodyRotation(vehicle, start.vehicle)
  // the client rode it before the case began: a pig's or strider's empty boost from its spawn data (1.9 - 1.19.2) went
  // with the first tick it was steered
  if (vehicle) vehicle.spentSpawnBoost = true
  if (vehicle) useVehiclePacketBase(bot, registry, rec, vehicle)
  // a raft before 1.21.2 is a boat of the bamboo type (Boat.Type.BAMBOO, its "type" data: the 12th, which minecraft-data
  // names from 1.19.4; the 8th type in 1.19.3, the 9th from 1.19.4, whose CHERRY comes before it), a chest raft a chest
  // boat of it: the recorder mounted one
  if ((vehicle?.name === 'boat' || vehicle?.name === 'chest_boat') && /_raft$/.test(rec?.setup?.mount?.entity ?? '')) {
    const keys = registry.entitiesByName[vehicle.name]?.metadataKeys
    const typeIndex = keys ? keys.indexOf('type') : 11
    if (typeIndex >= 0) {
      vehicle.metadata ??= []
      vehicle.metadata[typeIndex] = registry.version['>=']('1.19.4') ? 8 : 7
    }
  }
  // the walk animation the client had computed for its vehicle (WalkAnimationState: a strider's seat bobs with it)
  const walk = start.vehicle
  if (vehicle && walk?.walkAnimationSpeed !== undefined) {
    vehicle.walkAnimation = { speed: Math.fround(walk.walkAnimationSpeed), position: Math.fround(walk.walkAnimationPosition ?? 0) }
  }
  if (registry.version['>=']('1.9')) client.receive('set_passengers', { entityId: vehicleId, passengers: [entityId] })
  else client.receive('attach_entity', { entityId, vehicleId, leash: false })
}

function recordedUuid (version, rec) {
  for (const row of fixtures.expand(rec)) {
    for (const entry of row.events.serverPackets ?? []) {
      const packet = readClientbound(version, fixtures.bytesOf(entry.bytes ?? ''))
      const uuid = packet?.name === 'player_info' && packet.params.data?.find(item => item.uuid)?.uuid
      if (uuid) return uuid
    }
  }
  return undefined
}

// The state id of the client's containers when the case began (1.17.1+): the one its first window click sent, unless a
// container packet of the case (window_items, set_slot) set it before
function recordedStateId (version, rec) {
  for (const row of fixtures.expand(rec)) {
    for (const entry of row.events.clientPackets ?? []) {
      const packet = /^[0-9a-f]*$/i.test(entry.bytes ?? '') && readServerbound(version, fixtures.bytesOf(entry.bytes))
      if (packet?.name === 'window_click') return packet.params.stateId ?? 0
    }
    for (const entry of row.events.serverPackets ?? []) {
      for (const part of entry.packets ?? [entry]) {
        const name = readClientbound(version, fixtures.bytesOf(part.bytes ?? ''))?.name
        if (name === 'window_items' || name === 'set_slot') return 0
      }
    }
  }
  return 0
}

// The last transaction id of the player's inventory menu before the case (before 1.17: the menu counted its clicks
// through the session): the one its first click in the inventory sent, minus one
function recordedActionNumber (version, rec) {
  for (const row of fixtures.expand(rec)) {
    for (const entry of row.events.clientPackets ?? []) {
      const packet = /^[0-9a-f]*$/i.test(entry.bytes ?? '') && readServerbound(version, fixtures.bytesOf(entry.bytes))
      if (packet?.name === 'window_click' && packet.params.windowId === 0 && packet.params.action > 0) return packet.params.action - 1
    }
  }
  return 0
}

async function startBot (version, rec, { levelLoaded = null } = {}) {
  const registry = registryFor(version)
  const fixture = fixtures.load(version)
  const start = fixtures.start(rec)
  const client = createFakeClient(version)
  // the player's UUID, as the login told the client (minecraft-protocol keeps it as client.uuid): the singleplayer
  // recordings' player list holds only the recorded player
  client.uuid = recordedUuid(version, rec)
  const bot = mineflayer.createBot({ client, version, username: client.username, physicsManual: true, respawn: false, hideErrors: true, logErrors: false, nativePhysics: nativeEngine.module() })
  bot.levelLoaded = levelLoaded
  client.setState('play')
  await new Promise(resolve => setImmediate(resolve))
  nativeEngine.assertNativeBot(bot)
  // The recordings' client is instrumented: on 1.7.10 - 1.13.2 the recorder's ClientPlayNetworkHandlerMixin runs
  // World.checkChunk(player, false) at the end of onPlayerPositionLook, so after every server teleport the player is
  // put in its chunk at once if the chunk is loaded (vanilla waits for the end of the next tick). The bot re-checks its
  // chunk after each teleport there too (1.9 - 1.13: the versions whose check matters), after the bot's own handler.
  if (registry.version['>=']('1.9') && registry.version['<']('1.14')) {
    client.on('position', () => bot._checkChunk())
  }
  // the dimensions a server sends during configuration (1.20.2+), or in the login packet before
  const codec = registry.registryCodec ?? registry.loginPacket?.dimensionCodec
  if (registry.supportFeature('segmentedRegistryCodecData')) {
    for (const entry of Object.values(codec ?? {})) client.receive('registry_data', entry)
  } else if (registry.supportFeature('hasConfigurationState')) {
    client.receive('registry_data', { codec: codec ?? {} })
  }
  client.receive('login', loginPacket(registry, start, rec))
  // a 1.21.4+ server follows the login with level_chunks_load_start (PlayerList.placeNewPlayer)
  if (registry.version['>=']('1.21.4')) client.receive('game_state_change', { reason: 'level_chunks_load_start', gameMode: 0 })
  for (const [x, z, column] of columnsOf(bot, fixture, rec)) bot.world.setColumn(x, z, column)
  equip(client, registry, version, rec, registry.supportFeature('stateIdUsed') ? recordedStateId(version, rec) : 0)
  if (registry.supportFeature('actionIdUsed')) bot.inventory.actionNumber = recordedActionNumber(version, rec)
  useEntities(bot, start)
  client.receive('update_health', { health: 20, food: start.food ?? 20, foodSaturation: 5 })
  receiveSynced(client, registry, start)
  receiveAbilities(client, registry, start, rec)
  client.receive('position', {
    x: start.pos[0],
    y: start.pos[1],
    z: start.pos[2],
    yaw: start.netState?.lastYaw ?? start.yaw,
    pitch: start.netState?.lastPitch ?? start.pitch,
    flags: registry.supportFeature('positionPacketHasBitflags') ? { x: false, y: false, z: false, yaw: false, pitch: false } : 0,
    teleportId: 0,
    dx: 0,
    dy: 0,
    dz: 0
  })
  // the client's auto-jump option (mineflayer-physics-utils reads bot.physics.autoJump)
  bot.physics.autoJump = !!rec.setup?.autoJump
  // the recorded player was in its chunk: 1.9 - 1.16 put a player in its chunk at the end of a tick, and tick it from
  // the next one (World.updateEntityWithOptionalForce, ClientLevel.tickNonPassenger)
  if (registry.version['>=']('1.9') && registry.version['<']('1.17')) bot.physicsTick()
  // one tick at the rotation the client last sent, so the bot's own record of it is that rotation; then the start
  setLook(bot, start.netState?.lastYaw ?? start.yaw, start.netState?.lastPitch ?? start.pitch)
  bot.physicsTick()
  // (the pushes the priming ticks gave back to the mobs around are not the client's: mineflayer's entity.lastPush; nor
  // is the drift of a 1.8 boat on its motion, EntityBoat.onUpdate: the entities start where and as fast as recorded)
  for (const entity of Object.values(bot.entities)) delete entity.lastPush
  for (const { id, pos, vel } of start.entities ?? []) {
    const entity = bot.entities[id]
    if (!entity || entity === bot.entity) continue
    entity.velocity?.set(...vel)
    entity.interpolatedPosition?.set(...pos)
  }
  // seated after that tick, so the vehicle (which the bot may steer) starts where the case began
  useSummons(bot, registry, start, rec)
  useCommandSummons(bot, registry, start, rec)
  useVehicle(bot, client, registry, start, rec)
  useStart(bot, start)
  client.written.length = 0
  return { bot, client }
}

function entityState (bot) {
  return { pos: bot.entity.position, vel: bot.entity.velocity, onGround: bot.entity.onGround }
}

// The recorded packets the client sent, with their names (a packet the recorder could not encode, "unencodable: ...",
// never left the client)
function sentPacketsOf (version, packets) {
  return (packets ?? [])
    .filter(p => /^[0-9a-f]*$/i.test(p.bytes ?? ''))
    .map(p => ({ bytes: fixtures.bytesOf(p.bytes) }))
    .map(p => ({ ...p, name: serverboundName(version, p.bytes) }))
}

// Which of a case's rows the client spent paused, as rowIndex => boolean (by the index: the row before tells too). A
// pausing screen in singleplayer stops the client's ticks; a real bot never pauses, so the replay skips those rows.
// The recorder's flag where the fixture has it, else from 1.21.2 the missing tick_end every client tick ends with,
// else a row that sent no position and left LocalPlayer.positionReminder as the row before had it (every tick of a
// player not riding counts it up or, sending its position, back to 0). A paused client still sends what its screen or
// its frame sends (1.15.2's m_sign_place: a swing while the sign editor is open). A respawn gives the client a new
// player, its reminder at 0 (m_dimension on 1.17.1 and 1.19.2: the row of the respawn did not tick it).
function pausedRows (version, rec, rows = fixtures.expand(rec)) {
  const theirsOf = row => sentPacketsOf(version, row.events.clientPackets)
  const endsTick = row => theirsOf(row).some(p => p.name === 'tick_end')
  const marksTicks = rows.some(endsTick)
  const respawns = row => (row.events.serverPackets ?? []).some(entry => readClientbound(version, fixtures.bytesOf(entry.bytes ?? ''))?.name === 'respawn')
  const reminderOf = index => respawns(rows[index]) ? 0 : (index > 0 ? rows[index - 1] : fixtures.start(rec)).netState?.positionReminder
  // (a row that left a vehicle ticked: 1.16's client stops riding in its vehicle's tick, Player.rideTick, and when it
  // ticks its entities the player before the vehicle the player sends nothing that tick)
  const rode = index => !!(index > 0 ? rows[index - 1] : fixtures.start(rec)).netState?.vehicleId
  const stood = (row, index) => row.netState?.positionReminder != null && row.netState.positionReminder === reminderOf(index) &&
    !row.netState.vehicleId && !rode(index) && !theirsOf(row).some(p => MOVEMENT.has(p.name))
  return index => rows[index].paused ?? (marksTicks ? !endsTick(rows[index]) : stood(rows[index], index))
}

// 1.9 - 1.16 tick the player only once it is in a loaded chunk (mineflayer's chunk gate: World.checkChunk, whose
// EmptyChunk takes no entity; ClientLevel.tickNonPassenger): a row that left the player as it was while its chunk was not
// loaded yet (after a respawn far away) is a tick of the client without the player, not a pause, and the bot ticks it
// too, its chunk checked as the client's was. (columnLoaded: whether the bot's chunk is loaded as the row begins)
// (a row with the recorder's own pause flag is taken at its word: recorded(index), the row's flag or undefined)
function chunkGatedPause (version, paused, columnLoaded, recorded = () => undefined) {
  const v = registryFor(version).version
  const gated = v['>=']('1.9') && v['<']('1.17')
  return index => paused(index) && !(gated && recorded(index) === undefined && !columnLoaded())
}

async function replay (version, rec) {
  const rows = fixtures.expand(rec)
  const packetsOf = packets => sentPacketsOf(version, packets)
  const theirsOf = row => packetsOf(row.events.clientPackets)
  // 1.21.4+: the recorded client loaded the level once its renderer had the player's section, which no server packet
  // tells: from the start if it had already sent a position, else (and after a respawn) from the row it sent
  // player_loaded in
  const sentPosition = fixtures.start(rec).netState?.lastPos?.some(v => v !== 0)
  const rowsWhere = test => rows.flatMap((row, index) => test(row) ? [index] : [])
  const loadRows = rowsWhere(row => theirsOf(row).some(p => p.name === 'player_loaded'))
  const respawnRows = rowsWhere(row => (row.events.serverPackets ?? []).some(entry => readClientbound(version, fixtures.bytesOf(entry.bytes ?? ''))?.name === 'respawn'))
  let current = 0
  const levelLoaded = () => {
    const since = Math.max(-1, ...respawnRows.filter(index => index <= current))
    if (since < 0 && sentPosition) return true
    return loadRows.some(index => index >= since && index <= current)
  }
  // mineflayer times some of what it does by the clock (a dig's progress, a dismount request): the replay's clock moves
  // 50 ms a tick, as a server's ticks do
  const clock = virtualClock()
  let started
  try {
    started = await startBot(version, rec, { levelLoaded })
  } catch (err) {
    clock.restore()
    throw err
  }
  const { bot, client } = started
  // the length of a boost the recorded client drew itself (before 1.11: EntityPig.boost's rand.nextInt(841) + 140):
  // the one the recording has of the vehicle's boost that row
  const drawBoost = bot._riddenMobPhysics?.boostLength
  if (drawBoost) bot._riddenMobPhysics.boostLength = () => rows[current]?.vehicle?.boost?.boostTimeTotal || drawBoost()
  // the sequence of the client's block interactions went on through its session before the case
  // (BlockStatePredictionHandler): mineflayer's count starts where the client's was
  const sequenceStart = recordedSequenceStart(version, rows)
  if (sequenceStart != null) {
    let sequence = sequenceStart
    bot._nextInteractionSequence = () => ++sequence
  }
  const hands = createHands(bot, version)
  const recordedPause = pausedRows(version, rec, rows)
  const columnLoaded = () => !!bot.world.getColumn(Math.floor(bot.entity.position.x / 16), Math.floor(bot.entity.position.z / 16))
  const pausedNow = chunkGatedPause(version, recordedPause, columnLoaded, index => rows[index].paused)
  const pausedAt = []
  const paused = index => pausedAt[index]
  const divergences = []
  const interaction = []
  const isInteraction = p => INTERACTION.has(p.name)
  const decoded = packets => packets.map(p => readServerbound(version, p.bytes) ?? { name: 'unknown', params: { bytes: p.bytes.toString('hex') } })
  // what mineflayer was asked to do this tick that resolves later (an activateBlock, a window click) runs before the tick
  const settle = async () => {
    if (!hands.state.pending) return
    hands.state.pending = false
    await new Promise(resolve => setImmediate(resolve))
  }
  try {
    for (const [index, row] of rows.entries()) {
      current = index
      pausedAt[index] = pausedNow(index)
      // A row's food is sampled after its tick, so the food of a set_health the client handled after the tick shows in
      // that row without its packet (e_food_drop_mid_sprint 1.20.4, row 19): the bot gets the food the row before ended
      // with when its packets left it elsewhere.
      const foodBefore = (index > 0 ? rows[index - 1] : fixtures.start(rec)).food
      if (foodBefore != null && bot.food !== foodBefore) bot.food = foodBefore
      const sent = decoded(theirsOf(row))
      // a click on the screen comes before the server packets its server answers (the recorder files what it sends with
      // the tick)
      client.written.length = 0
      if (!paused(index)) leaveBed(bot, version, row)
      hands.screen(row.t, sent, paused(index) ? {} : row.in)
      const unreadable = sent.filter(p => p.name === 'unknown').length
      if (unreadable) hands.unreadable(row.t, unreadable)
      await settle()
      const clicked = client.written.filter(p => MOVEMENT.has(p.name))
      const ourHands = client.written.filter(isInteraction)
      // what the bot sends while handling a server packet is checked against the client's responses to it
      const answered = []
      const responded = []
      const respondedHands = []
      for (const entry of row.events.serverPackets ?? []) {
        client.written.length = 0
        for (const part of entry.packets ?? [entry]) {
          try { client.receiveBytes(fixtures.bytesOf(part.bytes)) } catch (err) { /* a packet the codec can't read is skipped */ }
        }
        answered.push(...client.written.filter(p => MOVEMENT.has(p.name)))
        ourHands.push(...client.written.filter(isInteraction))
        responded.push(...packetsOf(entry.responses).filter(p => MOVEMENT.has(p.name)))
        respondedHands.push(...packetsOf(entry.responses).filter(isInteraction))
      }
      client.written.length = 0
      setKeys(bot, row.in)
      setLook(bot, row.in.yaw, row.in.pitch)
      if (!paused(index)) {
        if (index > 0 && paused(index - 1)) hands.resumed()
        // the keys the client handled before its tick (Minecraft.handleKeybinds)
        await hands.keys(row.t, row.in)
        await settle()
        // a screen they opened released them all for the tick (lib/interact.js)
        if (hands.state.keysReleased) setKeys(bot, {})
        clock.advance(50)
        bot.physicsTick()
      }
      const ours = [...clicked, ...client.written.filter(p => MOVEMENT.has(p.name))]
      const theirs = theirsOf(row).filter(p => MOVEMENT.has(p.name))
      ourHands.push(...client.written.filter(isInteraction))
      client.written.length = 0
      const diffs = differences(entityState(bot), row, FIELDS)
      const differ = (a, b) => a.length !== b.length || a.some((p, i) => !p.bytes.equals(b[i].bytes))
      if (differ(ours, theirs)) diffs.unshift({ field: 'packets', expected: describe(theirs), actual: describe(ours) })
      if (differ(answered, responded)) diffs.unshift({ field: 'responses', expected: describe(responded), actual: describe(answered) })
      if (diffs.length) divergences.push({ t: row.t, input: row.in, diffs })
      // the interaction packets of the tick, decoded alike on both sides; one the codec cannot read counts as vanilla's
      const expected = [...decoded(respondedHands), ...sent.filter(p => INTERACTION.has(p.name) || p.name === 'unknown')]
      const actual = decoded(ourHands)
      const difference = packetListDifference(expected, actual)
      if (difference) interaction.push({ t: row.t, input: row.in, expected, actual, difference })
    }
  } finally {
    bot.end()
    clock.restore()
  }
  return { ticks: rows.length, divergences, interaction, unsupported: hands.unsupported }
}

// performance.now as a clock the replay moves (and puts back when it is done)
function virtualClock () {
  const { performance } = require('perf_hooks')
  const own = Object.prototype.hasOwnProperty.call(performance, 'now')
  const previous = performance.now
  let now = performance.now()
  performance.now = () => now
  return {
    advance (ms) { now += ms },
    restore () {
      if (own) performance.now = previous
      else delete performance.now
    }
  }
}

const describe = packets => packets.map(p => `${p.name}:${p.bytes.toString('hex')}`).join(' ') || '(none)'

module.exports = { packetPositionBefore, replay, startBot, recorderInvulnerable, pausedRows, chunkGatedPause, mobFlagsIndex, versionItemName, MOVEMENT }
