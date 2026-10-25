import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const at = (...parts) => path.join(root, ...parts)

// Runs a command in a folder of this repo, false when it fails. Through the shell on Windows, where corepack is a
// .cmd: one command line (the arguments have no spaces).
export function attempt (dir, command, args, env = {}) {
  const line = [command, ...args].join(' ')
  console.log(`\n> ${dir || '.'}: ${line}`)
  const options = { cwd: at(dir), stdio: 'inherit', env: { ...process.env, ...env } }
  const result = process.platform === 'win32' ? spawnSync(line, { ...options, shell: true }) : spawnSync(command, args, options)
  return result.status === 0
}

export function run (dir, command, ...args) {
  if (!attempt(dir, command, args)) throw new Error(`${[command, ...args].join(' ')} failed in ${dir || '.'}`)
}

// pnpm at the version the package pins (packageManager), else this repo's
export function pnpmArgs (dir, ...args) {
  const pinned = JSON.parse(fs.readFileSync(at(dir, 'package.json'), 'utf8')).packageManager?.split('+')[0]
  return [pinned ?? 'pnpm@11.13.0', ...args]
}

export function pnpm (dir, ...args) {
  run(dir, 'corepack', ...pnpmArgs(dir, ...args))
}
