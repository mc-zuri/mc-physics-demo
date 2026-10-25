/* eslint-env mocha */
'use strict'
// The recorder's player is invulnerable in the cases it made so, which the bot replay gives the bot (lib/bot.js).
const assert = require('assert')
const { registryFor } = require('../lib/registry')
const { recorderInvulnerable } = require('../lib/bot')

describe('the recorded player\'s invulnerability', function () {
  it('from 1.14 every case but a mortal one', function () {
    for (const version of ['1.14.4', '1.15.2', '1.21.11']) {
      const registry = registryFor(version)
      assert.strictEqual(recorderInvulnerable(registry, { name: 'q_eat_walk', tags: ['item_use', 'eat'] }), true, version)
      assert.strictEqual(recorderInvulnerable(registry, { name: 'm_damage_food', tags: ['features', 'health'] }), false, version)
      assert.strictEqual(recorderInvulnerable(registry, { name: 'q_eat_walk', mortal: true }), false, version)
    }
  })

  it('before 1.14 only the coverage cases', function () {
    const registry = registryFor('1.13.2')
    assert.strictEqual(recorderInvulnerable(registry, { name: 'q_eat_walk', tags: ['item_use', 'eat'] }), false)
    assert.strictEqual(recorderInvulnerable(registry, { name: 'm_c_use_cake', tags: ['coverage'] }), true)
  })
})
