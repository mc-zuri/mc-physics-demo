// Installs and builds what the web client takes from the forks next to it, then the web client itself.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const at = (...parts) => path.join(root, ...parts)

// (through the shell on Windows, where corepack is a .cmd: one command line, the arguments have no spaces)
function run (dir, command, ...args) {
  const line = [command, ...args].join(' ')
  console.log(`\n> ${dir || '.'}: ${line}`)
  const options = { cwd: at(dir), stdio: 'inherit' }
  const result = process.platform === 'win32' ? spawnSync(line, { ...options, shell: true }) : spawnSync(command, args, options)
  if (result.status !== 0) throw new Error(`${line} failed in ${dir || '.'}`)
}

// pnpm at the version the package pins (packageManager), else this repo's
function pnpm (dir, ...args) {
  const pinned = JSON.parse(fs.readFileSync(at(dir, 'package.json'), 'utf8')).packageManager?.split('+')[0]
  run(dir, 'corepack', pinned ?? 'pnpm@11.13.0', ...args)
}

run('', 'git', 'submodule', 'update', '--init', '--recursive')

// What a clone cannot build: mc-assets' dist comes from Minecraft's jars, the engine's WebAssembly from Rust.
fs.cpSync(at('prebuilt/mc-assets/dist'), at('mc-assets/dist'), { recursive: true })
fs.cpSync(at('prebuilt/minecraft-physics-native'), at('minecraft-physics-native'), { recursive: true })

// before this workspace's install: mineflayer-survival takes it with its dist
pnpm('mineflayer-mouse', 'install', '--ignore-workspace')
pnpm('mineflayer-mouse', 'run', 'build')

pnpm('minecraft-physics-native', 'install')
pnpm('minecraft-physics-native', 'run', 'build')

// mineflayer, mineflayer-physics-utils, minecraft-pathfinding, mineflayer-survival and minecraft-data (its data.js and
// index.d.ts from its prepare script)
pnpm('', 'install')
pnpm('', '--filter', 'minecraft-data', 'run', 'prepare')
pnpm('', 'run', 'build')

// the workers the web client copies from its dist
pnpm('minecraft-renderer', 'install', '--ignore-workspace')
pnpm('minecraft-renderer', 'run', 'build:mesher')
pnpm('minecraft-renderer', 'run', 'build:threeworker')

pnpm('minecraft-web-client', 'install')
pnpm('minecraft-web-client', 'run', 'prepare-project')

console.log('\nDone: `npm start`, then open http://localhost:3000 (Options → Controls → Physics → Native Physics).')
