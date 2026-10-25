#!/usr/bin/env node
// The whole replay suite. The per-version replays (engine.test.js, bot.test.js) run one version per process: mocha
// declares a version's tests from its fixture, so one process would hold every version's fixture at once (about 6 GB
// of heap from the 165 MB of gzipped fixtures) and run out of memory. The other test files each run in a process of
// their own too, since several of them load fixtures of many versions (lib/fixture.js keeps every one it loaded).
//
//   node tools/test.js [--jobs N]
//     --jobs N   versions replayed at once (default: half the CPUs, at most 4)
'use strict'
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')
const { readdirSync } = require('fs')
const { versions } = require('../lib/cases')

const ROOT = path.join(__dirname, '..')
const MOCHA = require.resolve('mocha/bin/mocha.js')
const PER_VERSION = ['engine.test.js', 'bot.test.js']

const at = process.argv.indexOf('--jobs')
const jobs = at >= 0 ? Number(process.argv[at + 1]) : Math.max(1, Math.min(4, Math.floor(os.cpus().length / 2)))

function mocha (files, env, label) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [MOCHA, '--reporter', 'dot', '--exit', ...files], {
      cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe']
    })
    let out = ''
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { out += d })
    child.on('close', code => resolve({ label, code, out }))
  })
}

async function main () {
  const tests = readdirSync(path.join(ROOT, 'test')).filter(f => f.endsWith('.test.js'))
  const runs = tests.filter(f => !PER_VERSION.includes(f)).map(f => () => mocha([path.join('test', f)], {}, f))
  // a version the engine replays but the bot doesn't (releases mineflayer doesn't test yet) runs only engine.test.js
  const botVersions = new Set(versions('bot'))
  for (const version of versions('engine')) {
    const files = PER_VERSION.filter(f => f !== 'bot.test.js' || botVersions.has(version)).map(f => path.join('test', f))
    runs.push(() => mocha(files, { REPLAY_VERSIONS: version }, version))
  }

  let failed = 0
  let next = 0
  const worker = async () => {
    while (next < runs.length) {
      const result = await runs[next++]()
      const summary = result.out.match(/\d+ passing[^\n]*(\n\s*\d+ (failing|pending)[^\n]*)*/)?.[0].replace(/\s+/g, ' ') ?? ''
      console.log(`${result.code === 0 ? 'ok  ' : 'FAIL'} ${result.label}: ${summary || `exit ${result.code}`}`)
      if (result.code !== 0) {
        failed++
        console.log(result.out)
      }
    }
  }
  await Promise.all(Array.from({ length: jobs }, worker))
  console.log(failed ? `${failed} of ${runs.length} runs failed` : `all ${runs.length} runs passed`)
  process.exitCode = failed ? 1 : 0
}

main()
