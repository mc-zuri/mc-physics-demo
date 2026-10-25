'use strict'
// REPLAY_ENGINE=native: the engine layer replays through minecraft-physics-native's mineflayer adapter instead of
// mineflayer-physics-utils' engines (BotcraftPhysics, BoatPhysics, RiddenMobPhysics), and the bot layer's bot moves
// through it (mineflayer's nativePhysics option). REPLAY_NATIVE_DIR is the checkout of minecraft-physics-native, built
// (pnpm build, and its native addon or its WebAssembly build); the default is the one next to this package.
const path = require('path')

const native = process.env.REPLAY_ENGINE === 'native'
const dir = path.resolve(process.env.REPLAY_NATIVE_DIR ?? path.join(__dirname, '../../minecraft-physics-native'))

let adapter = null
function load () {
  adapter ??= require(dir)
  return adapter
}

// (a mineflayer without the nativePhysics option, its native-physics branch's, would replay the bot layer on the default
// engines)
function assertNativeBot (bot) {
  if (native && !(bot.physicsEngine instanceof load().NativePhysics)) throw new Error('REPLAY_ENGINE=native: this mineflayer has no nativePhysics option')
}

module.exports = {
  native,
  module: () => native ? load() : undefined,
  assertNativeBot,
  playerPhysics: registry => new (load().NativePhysics)(registry),
  boatPhysics: registry => new (load().NativeBoatPhysics)(registry),
  riddenMobPhysics: registry => new (load().NativeRiddenMobPhysics)(registry)
}
