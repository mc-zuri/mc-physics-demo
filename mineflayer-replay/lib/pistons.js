'use strict'
// The client's moving pistons, as it builds them from the server's block events (PistonBaseBlock.triggerEvent) and
// ticks them after its entities (PistonMovingBlockEntity.tick): each tick a moving block goes 0.5F further and, through
// the engine's pushByMovingPiston, pushes the player out of its way; at progress 1 it turns into the block it moved.
// Only the piston's own head and base move: blocks in front of a piston (PistonStructureResolver) are not pushed.
const mc = require('minecraft-protocol')
const { registryFor } = require('./registry')

// Direction.from3DDataValue: down, up, north, south, west, east
const DIRECTIONS = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]]
const FACINGS = ['down', 'up', 'north', 'south', 'west', 'east']
const BLOCK_EVENTS = new Set(['minecraft:block_event', 'BlockActionS2CPacket'])
// the packets whose block changes the recorder keeps (blockChanges): one, or one per record of a section's
const BLOCK_UPDATES = new Set(['minecraft:block_update', 'BlockUpdateS2CPacket'])
const SECTION_UPDATES = new Set(['minecraft:section_blocks_update', 'ChunkDeltaUpdateS2CPacket'])
// the moving block itself (before 1.13 piston_extension)
const MOVING_BLOCK = /^(moving_piston|piston_extension)([[@]|$)/

function createPistons (version, world) {
  const registry = registryFor(version)
  const Block = require('prismarine-block')(registry)
  const legacy = registry.isOlderThan('1.13')
  const deserializer = mc.createDeserializer({ state: 'play', isServer: false, version })
  const moving = new Map()
  const key = ([x, y, z]) => `${x},${y},${z}`

  // the state ids of the piston head and base (before 1.13 by id and metadata: facing, 8 sticky / extended)
  const head = (facing, sticky, short) => legacy
    ? registry.blocksByName.piston_head.id * 16 + (facing | (sticky ? 8 : 0))
    : Block.fromProperties('piston_head', { facing: FACINGS[facing], short: String(short), type: sticky ? 'sticky' : 'normal' }, 0).stateId
  const base = (facing, sticky, extended) => {
    const name = sticky ? 'sticky_piston' : 'piston'
    return legacy
      ? registry.blocksByName[name].id * 16 + (facing | (extended ? 8 : 0))
      : Block.fromProperties(name, { facing: FACINGS[facing], extended: String(extended) }, 0).stateId
  }
  const shapesOf = (stateId) => Block.fromStateId(stateId, 0).shapes

  // PistonMovingBlockEntity.finalTick: the moving block becomes the block it moved
  function finish (entity) {
    moving.delete(key(entity.pos))
    world.setStateId(entity.pos, entity.movedState)
  }

  function triggerEvent ({ location, byte1: event, byte2: param, blockId }) {
    const name = registry.blocks[blockId]?.name
    if (name !== 'piston' && name !== 'sticky_piston') return
    const sticky = name === 'sticky_piston'
    const facing = param & 7
    const [dx, dy, dz] = DIRECTIONS[facing]
    const pos = [location.x, location.y, location.z]
    const front = [pos[0] + dx, pos[1] + dy, pos[2] + dz]
    if (event === 0) {
      // extend: the head moves out of the piston into the cell in front
      world.setStateId(pos, base(facing, sticky, true))
      moving.set(key(front), { pos: front, facing, extending: true, source: true, progress: 0, sticky, movedState: head(facing, sticky, false) })
    } else if (event === 1 || event === 2) {
      // retract: a head still moving out finishes, the base moves back over the head's cell
      const out = moving.get(key(front))
      if (out) finish(out)
      world.setStateId(front, registry.blocksByName.air.defaultState ?? 0)
      moving.set(key(pos), { pos, facing, extending: false, source: true, progress: 0, sticky, movedState: base(facing, sticky, false) })
    }
  }

  return {
    // the tick's server packets, as the client handles them before it ticks, in their order: a block event among the
    // block changes (a head the server sends with its piston's event replaces the moving block)
    receive (serverPackets, blockChanges = []) {
      const parse = packet => deserializer.parsePacketBuffer(Buffer.from(packet.bytes, 'hex')).data.params
      let next = 0
      const apply = n => {
        for (const end = Math.min(next + n, blockChanges.length); next < end; next++) {
          // (another block set where a block moves replaces it, and its block entity goes)
          world.setBlock(blockChanges[next])
          if (!MOVING_BLOCK.test(blockChanges[next][3])) moving.delete(key(blockChanges[next]))
        }
      }
      for (const entry of serverPackets ?? []) {
        for (const packet of entry.packets ?? [entry]) {
          if (BLOCK_UPDATES.has(packet.type)) apply(1)
          else if (SECTION_UPDATES.has(packet.type)) apply(parse(packet).records.length)
          else if (BLOCK_EVENTS.has(packet.type)) triggerEvent(parse(packet))
        }
      }
      apply(blockChanges.length)
    },
    // after the player's tick, every moving block ticks: push(piston) gets it as the engine's MovingPiston, the tick it
    // ends too (before 1.11 that pushes once more)
    tick (push) {
      for (const entity of [...moving.values()]) {
        // getCollisionRelatedBlockState: a retracting base collides as the head, short past a quarter
        const collision = !entity.extending && entity.source
          ? head(entity.facing, entity.sticky, entity.progress > Math.fround(0.25))
          : entity.movedState
        push({ pos: entity.pos, direction: DIRECTIONS[entity.facing], extending: entity.extending, source: entity.source, progress: entity.progress, shapes: shapesOf(collision) })
        if (entity.progress >= 1) finish(entity)
        else entity.progress = Math.min(Math.fround(entity.progress + Math.fround(0.5)), 1)
      }
    }
  }
}

module.exports = { createPistons }
