'use strict'
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { Worker } = require('node:worker_threads')
const javaMath = require('..')

const skip = !javaMath.isBuilt() && 'the addon is not built (pnpm --filter java-math build)'
const f32 = Math.fround

// A vanilla pitch in radians: pitch * 0.017453292F, in float.
const pitchRadians = degrees => f32(f32(degrees) * f32(0.017453292))

describe('java-math', { skip }, () => {
  it("returns Java's Math.cos where V8's differs in the last bit", () => {
    const { cos } = javaMath.load()
    // The elytra lift at pitch 56 (f_elytra_pitch_sweep_down_up, 1.18.2+)
    assert.equal(cos(pitchRadians(56)), 0.5591928973939152)
    assert.equal(Math.cos(pitchRadians(56)), 0.5591928973939153)
  })

  it('matches Math.sin and Math.cos of a separate Java process bit for bit', () => {
    const { sin, cos, javaHome } = javaMath.load()
    const inputs = [0, -0, Number.MIN_VALUE, -Number.MIN_VALUE, Math.PI, -Math.PI, Infinity, -Infinity, NaN]
    for (let pitch = -90; pitch <= 90; pitch += 0.125) inputs.push(pitchRadians(pitch))
    let seed = 12345
    for (let i = 0; i < 10000; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      inputs.push((seed / 2 ** 32 - 0.5) * 1e6)
    }
    const data = Buffer.alloc(inputs.length * 8)
    inputs.forEach((x, i) => data.writeDoubleBE(x, i * 8))
    const java = path.join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
    const run = spawnSync(java, [path.join(__dirname, 'MathReference.java')], { input: data, maxBuffer: inputs.length * 16 + 1024 * 1024 })
    assert.equal(run.status, 0, run.stderr.toString())
    assert.equal(run.stdout.length, inputs.length * 16)
    inputs.forEach((x, i) => {
      assert.ok(Object.is(sin(x), run.stdout.readDoubleBE(i * 16)), `sin(${x})`)
      assert.ok(Object.is(cos(x), run.stdout.readDoubleBE(i * 16 + 8)), `cos(${x})`)
    })
  })

  it('can be called from a worker thread', async () => {
    const worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads')
      const { cos, sin } = require(workerData).load()
      parentPort.postMessage([cos(${pitchRadians(56)}), Object.is(sin(-0), -0)])
    `, { eval: true, workerData: require.resolve('..') })
    const result = await new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject) })
    assert.deepEqual(result, [0.5591928973939152, true])
  })
})
