/* eslint-env mocha */
'use strict'
// The interaction layer compares decoded packets field by field and reports the first difference of a tick.
const assert = require('assert')
const { fieldDifferences, packetListDifference, interactionReport } = require('../lib/compare')

describe('interaction packet comparison', function () {
  it('finds no difference between equal packets', function () {
    const packet = { status: 0, location: { x: 2, y: 101, z: 2854 }, face: 4, sequence: 1, data: Buffer.from('0a0b', 'hex') }
    assert.deepStrictEqual(fieldDifferences(packet, structuredClone({ ...packet, data: Buffer.from('0a0b', 'hex') })), [])
  })

  it('tells a -0 from a 0 and names the nested field', function () {
    assert.deepStrictEqual(fieldDifferences({ cursor: { x: -0 } }, { cursor: { x: 0 } }), [{ path: 'cursor.x', expected: -0, actual: 0 }])
  })

  it('ignores a field neither side wrote, not one that only one side wrote', function () {
    assert.deepStrictEqual(fieldDifferences({ a: 1, b: undefined }, { a: 1 }), [])
    assert.deepStrictEqual(fieldDifferences({ a: 1, b: 2 }, { a: 1 }), [{ path: 'b', expected: 2, actual: undefined }])
  })

  it('compares buffers by their bytes', function () {
    assert.strictEqual(fieldDifferences({ b: Buffer.from([1]) }, { b: Buffer.from([2]) }).length, 1)
  })

  it('describes the first difference of two packet lists', function () {
    const dig = sequence => ({ name: 'block_dig', params: { status: 0, face: 1, sequence } })
    assert.strictEqual(packetListDifference([dig(1)], [dig(1)]), null)
    assert.strictEqual(packetListDifference([dig(1)], [dig(2)]), '#1 block_dig.sequence: vanilla 1 ours 2')
    assert.strictEqual(packetListDifference([dig(1)], [{ name: 'arm_animation', params: { hand: 0 } }]), '#1: vanilla block_dig, ours arm_animation')
    assert.match(packetListDifference([dig(1)], []), /^#1: missing block_dig\{status:0,face:1,sequence:1\}$/)
    assert.match(packetListDifference([], [dig(3)]), /^#1: extra block_dig/)
  })

  it('takes the enchantments of a stack in any order (1.20.5 - 1.21.4: a hash map keyed by identity)', function () {
    const click = ids => ({
      name: 'window_click',
      params: { changedSlots: [{ location: 37, item: { components: [{ type: 'enchantments', data: { enchantments: ids.map(id => ({ id, level: 1 })), showTooltip: true } }] } }] }
    })
    assert.strictEqual(packetListDifference([click([17, 39])], [click([39, 17])]), null)
    assert.match(packetListDifference([click([17, 39])], [click([39, 18])]), /enchantments\.0\.id: vanilla 17 ours 18/)
  })

  it('takes the hashed components of a stack in any order (1.21.5+: keyed by identity), not the full ones', function () {
    const click = (types, removed = []) => ({
      name: 'window_click',
      params: { cursorItem: { itemId: 1, itemCount: 1, components: types.map(type => ({ type, hash: type.length })), removeComponents: removed.map(type => ({ type })) } }
    })
    assert.strictEqual(packetListDifference([click(['repair_cost', 'enchantments'], ['lore', 'food'])], [click(['enchantments', 'repair_cost'], ['food', 'lore'])]), null)
    assert.match(packetListDifference([click(['repair_cost'])], [click(['enchantments'])]), /components\.0\.type: vanilla "repair_cost" ours "enchantments"/)
    const full = types => ({ name: 'window_click', params: { cursorItem: { components: types.map(type => ({ type, data: 1 })) } } })
    assert.match(packetListDifference([full(['repair_cost', 'damage'])], [full(['damage', 'repair_cost'])]), /components\.0\.type/)
  })

  it('reports a case whose interaction packets all match, and one that differs', function () {
    assert.strictEqual(interactionReport('1.21.11', 'm_dig', { ticks: 3, interaction: [] }), 'm_dig on 1.21.11: the interaction packets of all 3 ticks match')
    const text = interactionReport('1.21.11', 'm_dig', {
      ticks: 3,
      interaction: [{ t: 2, input: { attack: true, yaw: 0, pitch: 90 }, expected: [], actual: [], difference: '#1: missing x' }],
      unsupported: [{ t: 2, action: 'select_trade', reason: 'no API' }]
    })
    assert.match(text, /interaction differs in 1 of 3 ticks; first at tick 2 \(attack, yaw 0, pitch 90\)/)
    assert.match(text, /unsupported at tick 2: select_trade \(no API\)/)
  })
})
