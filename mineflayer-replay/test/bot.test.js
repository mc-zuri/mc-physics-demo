/* eslint-env mocha */
'use strict'
// Every recorded case through a whole mineflayer bot stepped tick by tick (physicsManual): the movement and input
// packets it writes each tick must be the vanilla client's to the byte, and its position, motion and ground contact
// the client's. The interaction packets it writes from the same keys and screen clicks (digging, using, attacking,
// containers...: lib/interact.js) must be the client's too, field by field; they are a test of their own per case
// ("<case> interaction"), so a movement failure stays readable. Cases in known-failures.json ("case@version" under
// "bot", and under "interaction" with the reason) are expected to differ; one that starts matching fails too, so the
// lists only ever shrink.
const assert = require('assert')
const { botCase, versions, casesOf, knownFailures } = require('../lib/cases')
const bot = require('../lib/bot')
const { report, interactionReport } = require('../lib/compare')

const listed = knownFailures()
const known = new Set(listed.bot ?? [])
// { "case@version": "reason" } (a plain list is read as ids without reasons)
const knownInteraction = new Set(Array.isArray(listed.interaction) ? listed.interaction : Object.keys(listed.interaction ?? {}))

for (const version of versions('bot')) {
  describe(`bot replay ${version}v`, function () {
    this.timeout(20 * 1000)
    // each case is replayed once for both of its tests
    const results = new Map()
    const resultOf = async rec => {
      if (!results.has(rec.name)) results.set(rec.name, await bot.replay(version, rec))
      return results.get(rec.name)
    }
    for (const rec of casesOf(version, botCase)) {
      const id = `${rec.name}@${version}`
      it(rec.name, async function () {
        const result = await resultOf(rec)
        if (known.has(id)) {
          assert.ok(result.divergences.length > 0, `${id} matches vanilla now: remove it from known-failures.json`)
          return
        }
        if (result.divergences.length) assert.fail(report(version, rec.name, result))
      })
      it(`${rec.name} interaction`, async function () {
        const result = await resultOf(rec)
        results.delete(rec.name)
        if (knownInteraction.has(id)) {
          assert.ok(result.interaction.length > 0, `${id} sends vanilla's interaction packets now: remove it from known-failures.json "interaction"`)
          return
        }
        if (result.interaction.length) assert.fail(interactionReport(version, rec.name, result))
      })
    }
  })
}
