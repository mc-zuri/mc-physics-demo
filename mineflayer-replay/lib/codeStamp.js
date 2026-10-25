'use strict'
// What the replays run: a stamp (every file's path, size and modification time) of the code a replay loads. A run that
// sees it change midway (an agent's tsc rewriting physics-utils' dist, a java-math rebuild, a pnpm relink) mixes two
// builds across its child processes and its results flip between runs; the baseline refuses to write such a run.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const ROOT = path.join(__dirname, '..', '..')
const CODE = [
  path.join(ROOT, 'mineflayer', 'lib'),
  path.join(ROOT, 'mineflayer', 'index.js'),
  path.join(ROOT, 'mineflayer-physics-utils', 'dist'),
  path.join(ROOT, 'java-math', 'build', 'Release'),
  __dirname
]

function walk (entry, out) {
  let stat
  try { stat = fs.statSync(entry) } catch { out.push(`${entry} missing`); return }
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(entry).sort()) walk(path.join(entry, name), out)
  } else {
    out.push(`${entry} ${stat.size} ${stat.mtimeMs}`)
  }
}

/** A hash of the size and modification time of every file under `paths` (by default the code a replay loads). */
function codeStamp (paths = CODE) {
  const lines = []
  for (const entry of paths) walk(entry, lines)
  return crypto.createHash('sha1').update(lines.join('\n')).digest('hex')
}

module.exports = { codeStamp, CODE }
