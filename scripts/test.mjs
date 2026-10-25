// node scripts/test.mjs [suite ...]: the test suites, all of them by default.
//
//   gen          mineflayer-replay: the recorded vanilla sessions (fixtures/java) replayed tick by tick through
//                mineflayer-physics-utils' engines and through a whole mineflayer bot
//   gen-native   the same through minecraft-physics-native (REPLAY_ENGINE=native: its mineflayer adapter, and the bot
//                with mineflayer's nativePhysics option), on its WebAssembly build when there is no native addon
//   native       minecraft-physics-native's own tests, and its Rust tests when cargo is on the PATH
//   physics-utils  mineflayer-physics-utils' own tests
import { spawnSync } from 'node:child_process'
import { attempt, pnpmArgs } from './run.mjs'

const SUITES = {
  'physics-utils': () => attempt('', 'corepack', pnpmArgs('', '--filter', '@nxg-org/mineflayer-physics-util', 'test')),
  gen: () => attempt('', 'corepack', pnpmArgs('', '--filter', 'mineflayer-replay', 'test')),
  'gen-native': () => attempt('', 'corepack', pnpmArgs('', '--filter', 'mineflayer-replay', 'test'), { REPLAY_ENGINE: 'native' }),
  native: () => {
    const passed = attempt('minecraft-physics-native', 'corepack', pnpmArgs('minecraft-physics-native', 'test'))
    if (spawnSync('cargo', ['--version']).status !== 0) {
      console.log('\n(no cargo on the PATH: the engine\'s Rust tests are skipped)')
      return passed
    }
    return attempt('minecraft-physics-native/native', 'cargo', ['test', '--release']) && passed
  },
}

const asked = process.argv.slice(2)
const unknown = asked.filter(name => !SUITES[name])
if (unknown.length) {
  console.error(`unknown suite: ${unknown.join(', ')} (one of ${Object.keys(SUITES).join(', ')})`)
  process.exit(2)
}

const results = (asked.length ? asked : Object.keys(SUITES)).map(name => [name, SUITES[name]()])
console.log('\n' + results.map(([name, passed]) => `${passed ? 'passed' : 'FAILED'}  ${name}`).join('\n'))
process.exitCode = results.every(([, passed]) => passed) ? 0 : 1
