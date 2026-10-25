'use strict'
// Builds the addon against the JDK scripts/jdk.js finds, and records that JDK as the one index.js starts.
// Opt-in (`pnpm --filter java-math build`): installing the workspace never builds it.
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { javaHome, includeDirs } = require('./jdk')

const root = path.join(__dirname, '..')
const home = javaHome()
includeDirs(home)
const nodeGyp = require.resolve('node-gyp/bin/node-gyp.js')
const run = spawnSync(process.execPath, [nodeGyp, 'rebuild'], { cwd: root, stdio: 'inherit', env: { ...process.env, JAVA_HOME: home } })
if (run.status !== 0) process.exit(run.status ?? 1)
fs.writeFileSync(path.join(root, 'build', 'jdk.json'), JSON.stringify({ javaHome: home }, null, 2) + '\n')
console.log(`java-math: built against ${home}`)
