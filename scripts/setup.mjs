// Installs and builds what the web client and the tests take from the forks here, then the web client itself.
import fs from 'node:fs'
import { at, attempt, pnpm, pnpmArgs, run } from './run.mjs'

run('', 'git', 'submodule', 'update', '--init', '--recursive')

// What a clone cannot build: mc-assets' dist comes from Minecraft's jars, the engine's WebAssembly from Rust.
fs.cpSync(at('prebuilt/mc-assets/dist'), at('mc-assets/dist'), { recursive: true })
fs.cpSync(at('prebuilt/minecraft-physics-native'), at('minecraft-physics-native'), { recursive: true })

// before this workspace's install: mineflayer-survival takes it with its dist
pnpm('mineflayer-mouse', 'install', '--ignore-workspace')
pnpm('mineflayer-mouse', 'run', 'build')

pnpm('minecraft-physics-native', 'install')
pnpm('minecraft-physics-native', 'run', 'build')

// mineflayer, mineflayer-physics-utils, minecraft-pathfinding, mineflayer-survival, minecraft-data (its data.js and
// index.d.ts from its prepare script), mineflayer-replay and java-math
pnpm('', 'install')
pnpm('', '--filter', 'minecraft-data', 'run', 'prepare')
pnpm('', 'run', 'build')

// Java's own sin and cos for the replays, which needs a JDK and a C++ toolchain; without it they use V8's, which can
// miss Java's by one bit
if (!attempt('', 'corepack', pnpmArgs('', '--filter', 'java-math', 'run', 'build'))) {
  console.warn('\njava-math was not built: the replays use V8\'s sin and cos')
}

// the workers the web client copies from its dist
pnpm('minecraft-renderer', 'install', '--ignore-workspace')
pnpm('minecraft-renderer', 'run', 'build:mesher')
pnpm('minecraft-renderer', 'run', 'build:threeworker')

pnpm('minecraft-web-client', 'install')
pnpm('minecraft-web-client', 'run', 'prepare-project')

console.log('\nDone: `npm start`, then open http://localhost:3000 (Options → Controls → Physics → Native Physics); `npm test` for the tests.')
