/* eslint-env mocha */
'use strict'
// The recorded setup's items by the version's own names (lib/bot.js): before 1.13 a flower, a disc, planks... have
// other names, some with metadata.
const assert = require('assert')
const { registryFor } = require('../lib/registry')
const { versionItemName } = require('../lib/bot')

describe('the recorded items by the version\'s names', function () {
  it('a poppy and a disc before 1.13 are red_flower and record_13', function () {
    assert.deepStrictEqual(versionItemName(registryFor('1.8.8'), 'poppy'), ['red_flower', '0'])
    assert.deepStrictEqual(versionItemName(registryFor('1.12.2'), 'music_disc_13'), ['record_13'])
    assert.deepStrictEqual(versionItemName(registryFor('1.13.2'), 'poppy'), ['poppy'])
    assert.deepStrictEqual(versionItemName(registryFor('1.13.2'), 'music_disc_13'), ['music_disc_13'])
  })

  it('an item the version does not have has no name', function () {
    assert.deepStrictEqual(versionItemName(registryFor('1.8.8'), 'netherite_ingot'), [''])
  })
})
