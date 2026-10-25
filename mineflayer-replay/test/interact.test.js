/* eslint-env mocha */
'use strict'
// The player's hands (lib/interact.js): a screen its own keys open releases every key for the rest of the tick; a use
// on a block goes on to the item and the off hand as Minecraft.startUseItem does.
const assert = require('assert')
const { EventEmitter } = require('events')
const { registryFor } = require('../lib/registry')
const { createHands } = require('../lib/interact')

// a bot standing in the air, looking at nothing, holding `held`
function fakeBot (held, version = '1.21.5') {
  const bot = new EventEmitter()
  Object.assign(bot, {
    registry: registryFor(version),
    game: { gameMode: 'survival' },
    heldItem: held,
    inventory: { slots: [] },
    usingHeldItem: false,
    used: 0,
    raycastHitResult: () => ({ type: 'miss' }),
    activateItem () { bot.used++; return 'success' },
    deactivateItem () {},
    setQuickBarSlot () {},
    swingArm () {}
  })
  return bot
}

describe('hands: screens the keys open', function () {
  it('a use of a book and quill opens its editor and releases the keys for the tick', async function () {
    const bot = fakeBot({ name: 'writable_book', count: 1 })
    const hands = createHands(bot, '1.21.5')
    await hands.keys(1, { sneak: true, use: true })
    assert.strictEqual(bot.used, 1)
    assert.strictEqual(hands.state.screen, 'book')
    assert.strictEqual(hands.state.keysReleased, true)
    // the next tick the recorder holds the keys again; the editor in front of the world takes no use
    await hands.keys(2, { sneak: true, use: true })
    assert.strictEqual(hands.state.keysReleased, false)
    assert.strictEqual(bot.used, 1)
  })

  it('the book editor has closed when the paused client ticks again, and a held use is a new press', async function () {
    const bot = fakeBot({ name: 'writable_book', count: 1 })
    const hands = createHands(bot, '1.21.5')
    await hands.keys(1, { use: true })
    hands.resumed()
    assert.strictEqual(hands.state.screen, null)
    await hands.keys(2, { use: true })
    assert.strictEqual(bot.used, 2)
  })

  it('another item used in the air opens nothing', async function () {
    const bot = fakeBot({ name: 'stick', count: 1 })
    const hands = createHands(bot, '1.21.5')
    await hands.keys(1, { sneak: true, use: true })
    assert.strictEqual(hands.state.screen, null)
    assert.strictEqual(hands.state.keysReleased, false)
    assert.deepStrictEqual(hands.state.held, { sneak: true, use: true })
  })

  it('the inventory key opens the inventory and releases the keys for the tick', async function () {
    const bot = fakeBot(null)
    const hands = createHands(bot, '1.21.5')
    await hands.keys(1, { forward: true, inventory: true })
    assert.strictEqual(hands.state.screen, 'inventory')
    assert.strictEqual(hands.state.keysReleased, true)
    assert.deepStrictEqual(hands.state.held, {})
  })

  it('a screen the server opens releases nothing', async function () {
    const bot = fakeBot(null)
    const hands = createHands(bot, '1.21.5')
    bot.emit('windowOpen')
    await hands.keys(1, { forward: true })
    assert.strictEqual(hands.state.screen, 'window')
    assert.strictEqual(hands.state.keysReleased, false)
  })

  it('the clicks of keys pressed while a screen is open act once it closes (KeyMapping.clickCount, handleKeybinds)', async function () {
    const bot = fakeBot({ name: 'stick', count: 1 })
    const slots = []
    bot.setQuickBarSlot = slot => slots.push(slot)
    const hands = createHands(bot, '1.15.2')
    bot.emit('windowOpen')
    await hands.keys(1, {})
    await hands.keys(2, { hotbar9: true })
    await hands.keys(3, {})
    await hands.keys(4, { use: true })
    await hands.keys(5, {})
    assert.deepStrictEqual([slots, bot.used], [[], 0])
    // the screen closes (its close_window, before the tick's keys): the hotbar slot and the use the recorder clicked
    bot.emit('windowClose')
    await hands.keys(6, {})
    assert.deepStrictEqual([slots, bot.used], [[8], 1])
    // consumed: not again
    await hands.keys(7, {})
    assert.deepStrictEqual([slots, bot.used], [[8], 1])
  })

  it('a screen the server opens drops the clicks before it, and a key held on is clicked anew (Minecraft.setScreen: KeyMapping.releaseAll)', async function () {
    const bot = fakeBot({ name: 'stick', count: 1 })
    const hands = createHands(bot, '1.15.2')
    bot.emit('windowOpen')
    await hands.keys(1, { use: true })
    // another screen opens: the click before is dropped; the held key counts again
    bot.emit('windowOpen')
    await hands.keys(2, { use: true })
    bot.emit('windowClose')
    await hands.keys(3, {})
    assert.strictEqual(bot.used, 1)
  })

  it('the book editor saved or signed is bot.writeBook / bot.signBook on the book in hand, and closes', async function () {
    for (const version of ['1.16.5', '1.21.5']) {
      const bot = fakeBot({ name: 'writable_book', count: 1 }, version)
      const calls = []
      Object.assign(bot, {
        QUICK_BAR_START: 36,
        quickBarSlot: 2,
        username: 'replay',
        writeBook: async (...args) => calls.push(['write', ...args]),
        signBook: async (...args) => calls.push(['sign', ...args])
      })
      const hands = createHands(bot, version)
      await hands.keys(1, { use: true })
      const Item = require(require.resolve('prismarine-item', { paths: [require.resolve('mineflayer')] }))(bot.registry)
      const book = (tags) => Item.toNotch(new Item(bot.registry.itemsByName.writable_book.id, 1, 0, { type: 'compound', name: '', value: tags }))
      const pages = list => ({ pages: { type: 'list', value: { type: 'string', value: list } } })
      if (version === '1.16.5') {
        hands.screen(6, [{ name: 'edit_book', params: { new_book: book(pages(['a', 'b'])), signing: false, hand: 0 } }])
        hands.screen(9, [{ name: 'edit_book', params: { new_book: book({ title: { type: 'string', value: 'T' }, author: { type: 'string', value: 'Dev' }, ...pages(['a']) }), signing: true, hand: 0 } }])
        assert.deepStrictEqual(calls, [['write', 38, ['a', 'b']], ['sign', 38, ['a'], 'Dev', 'T']])
      } else {
        hands.screen(6, [{ name: 'edit_book', params: { hand: 2, pages: ['a', 'b'] } }])
        hands.screen(9, [{ name: 'edit_book', params: { hand: 2, pages: ['a'], title: 'T' } }])
        assert.deepStrictEqual(calls, [['write', 38, ['a', 'b']], ['sign', 38, ['a'], 'replay', 'T']])
      }
      assert.strictEqual(hands.state.screen, null)
    }
  })
})

describe('hands: an item used up', function () {
  it('the use key held on uses what the finished item left in the hand, as mineflayer has it (a bucket after milk)', async function () {
    const bot = fakeBot({ name: 'milk_bucket', count: 1 })
    const hands = createHands(bot, '1.21.5')
    bot.usingHeldItem = true
    await hands.keys(1, { use: true })
    // the server says the use is complete: mineflayer leaves the bucket in the hand (LivingEntity.completeUsingItem)
    bot.usingHeldItem = false
    bot.heldItem = { name: 'bucket', count: 1 }
    await hands.keys(2, { use: true })
    assert.strictEqual(bot.used, 1)
  })
})

describe('hands: a use on a block', function () {
  // looking at a block whose use fails (a block item that cannot go there), holding an item whose own use passes
  function onBlock (version) {
    const { Vec3 } = require('vec3')
    const bot = fakeBot({ name: 'cobblestone', count: 1 }, version)
    const block = { position: new Vec3(2, 100, 0), name: 'stone' }
    bot.raycastHitResult = () => ({ type: 'block', block, face: 1, intersect: new Vec3(2.5, 101, 0.5) })
    bot.blocks = []
    bot.activateBlock = async (target, face, cursor, offHand) => { bot.blocks.push(offHand ? 'off' : 'main'); return 'fail' }
    bot.activateItem = () => { bot.used++; return 'pass' }
    return bot
  }

  it('a FAIL ends the use from 1.13; before, the item in that hand is used and the off hand tried', async function () {
    const legacy = onBlock('1.12.2')
    await createHands(legacy, '1.12.2').keys(1, { use: true })
    assert.deepStrictEqual(legacy.blocks, ['main', 'off'])
    assert.strictEqual(legacy.used, 1)
    const flattened = onBlock('1.13.2')
    await createHands(flattened, '1.13.2').keys(1, { use: true })
    assert.deepStrictEqual(flattened.blocks, ['main'])
    assert.strictEqual(flattened.used, 0)
  })

  it('a spectator uses the block too (MultiPlayerGameMode.useItemOn sends it, a CONSUME)', async function () {
    const bot = onBlock('1.21.8')
    bot.game.gameMode = 'spectator'
    await createHands(bot, '1.21.8').keys(1, { use: true })
    assert.deepStrictEqual(bot.blocks, ['main'])
  })
})

describe('hands: a dig the server ended', function () {
  it('the attack key let go stops a dig the server\'s break ended too (Minecraft.continueAttack: stopDestroyBlock)', async function () {
    const bot = fakeBot(null, '1.13.2')
    bot.targetDigBlock = null
    bot.isDestroying = true
    bot.stops = 0
    bot.stopDigging = () => { bot.stops++; bot.isDestroying = false }
    const hands = createHands(bot, '1.13.2')
    // (the key let go)
    await hands.keys(1, {})
    assert.strictEqual(bot.stops, 1)
    await hands.keys(2, {})
    assert.strictEqual(bot.stops, 1)
  })
})

describe('hands: paddling a boat', function () {
  // in a boat it steers, looking at a block
  function inBoat (version) {
    const { Vec3 } = require('vec3')
    const bot = fakeBot({ name: 'stick', count: 1 }, version)
    bot.entity = { id: 1 }
    bot.vehicle = { name: version === '1.9.4' ? 'Boat' : 'oak_boat', passengers: [bot.entity] }
    bot.raycastHitResult = () => ({ type: 'block', block: { position: new Vec3(2, 100, 0), name: 'stone' }, face: 1, intersect: new Vec3(2.5, 101, 0.5) })
    bot.calls = []
    bot.dig = async () => { bot.calls.push('dig') }
    bot.blockAt = () => ({ type: 1 })
    bot.stopDigging = () => {}
    bot.activateBlock = async () => { bot.calls.push('use'); return 'pass' }
    bot.swingArm = () => bot.calls.push('swing')
    return bot
  }

  it('the attack and use keys do not act the tick after a paddle (LocalPlayer.isHandsBusy, from 1.9); held, the dig goes on', async function () {
    for (const version of ['1.9.4', '1.21.8']) {
      const bot = inBoat(version)
      const hands = createHands(bot, version)
      await hands.keys(1, { forward: true })
      assert.strictEqual(hands.state.handsBusy, true, version)
      await hands.keys(2, { forward: true, attack: true, use: true })
      // (startAttack and startUseItem do nothing; continueAttack digs the block the key is held on)
      assert.deepStrictEqual(bot.calls, ['dig'], version)
      await hands.keys(3, {})
      assert.strictEqual(hands.state.handsBusy, false, version)
    }
  })
})

describe('hands: before 1.9', function () {
  it('a use tries the held item alone: there is no off hand', async function () {
    const { Vec3 } = require('vec3')
    for (const [version, expected] of [['1.8.8', ['main']], ['1.9.4', ['main', 'off']]]) {
      const bot = fakeBot({ name: 'stick', count: 1 }, version)
      bot.raycastHitResult = () => ({ type: 'block', block: { position: new Vec3(2, 100, 0), name: 'stone' }, face: 1, intersect: new Vec3(2.5, 101, 0.5) })
      bot.blocks = []
      bot.activateBlock = async (target, face, cursor, offHand) => { bot.blocks.push(offHand ? 'off' : 'main'); return 'pass' }
      bot.activateItem = () => { bot.used++; return 'pass' }
      await createHands(bot, version).keys(1, { use: true })
      assert.deepStrictEqual(bot.blocks, expected, version)
    }
  })
})

describe('hands: the pick key', function () {
  it('picks the block or the entity at the crosshair (Minecraft.pickBlockOrEntity; the client picks before 1.21.4)', async function () {
    const { Vec3 } = require('vec3')
    const block = { position: new Vec3(2, 100, 0), name: 'stone' }
    for (const version of ['1.8.8', '1.21.3', '26.1']) {
      const bot = fakeBot(null, version)
      bot.picks = []
      bot.pickBlock = (target, data) => bot.picks.push(['block', target, data])
      bot.pickEntity = (target, data) => bot.picks.push(['entity', target, data])
      bot.raycastHitResult = () => ({ type: 'block', block, face: 1, intersect: new Vec3(2.5, 101, 0.5) })
      const hands = createHands(bot, version)
      await hands.keys(1, { pickItem: true })
      const cow = { name: 'cow', id: 7 }
      bot.raycastHitResult = () => ({ type: 'entity', entity: cow, intersect: new Vec3(2, 101, 0) })
      await hands.keys(2, {})
      await hands.keys(3, { pickItem: true })
      assert.deepStrictEqual([bot.picks, hands.unsupported], [[['block', block, false], ['entity', cow, false]], []], version)
    }
  })

  it('before 1.21.4 the creative slot the pick sets and the hotbar slot it sends the tick after are the key\'s, not the screen\'s', async function () {
    for (const [version, replayed] of [['1.21.1', 0], ['26.1', 2]]) {
      const bot = fakeBot(null, version)
      const calls = []
      bot.pickBlock = () => calls.push('pick')
      bot.creative = { setInventorySlot: async () => calls.push('creative slot') }
      bot._selectQuickBarSlotBeforeTick = () => calls.push('slot')
      const hands = createHands(bot, version)
      const creativeSlot = { name: 'set_creative_slot', params: { slot: 37, item: { itemCount: 0, components: [], removeComponents: [] } } }
      hands.screen(40, [creativeSlot], { pickItem: true })
      await hands.keys(40, { pickItem: true })
      hands.screen(41, [{ name: 'held_item_slot', params: { slotId: 1 } }], {})
      await hands.keys(41, {})
      // (a creative slot set with no pick: the screen's)
      hands.screen(42, [creativeSlot], {})
      assert.deepStrictEqual(calls.filter(c => c !== 'pick').length, replayed + 1, version)
    }
  })
})

describe('hands: a piercing weapon', function () {
  it('the attack stabs once it is charged, digs nothing held, and spends a swing at nothing (Minecraft.startAttack)', async function () {
    const { Vec3 } = require('vec3')
    const bot = fakeBot({ name: 'wooden_spear', count: 1 }, '26.1')
    let charged = false
    bot.calls = []
    Object.assign(bot, {
      isPiercingWeapon: item => item?.name === 'wooden_spear',
      cannotAttackWithItem: () => !charged,
      stab: () => bot.calls.push('stab'),
      resetAttackStrengthTicker: () => bot.calls.push('reset'),
      dig: async () => bot.calls.push('dig'),
      raycastHitResult: () => ({ type: 'block', block: { position: new Vec3(2, 100, 0), name: 'stone' }, face: 1, intersect: new Vec3(2.5, 101, 0.5) })
    })
    const hands = createHands(bot, '26.1')
    await hands.keys(1, { attack: true })
    assert.deepStrictEqual(bot.calls, [])
    charged = true
    await hands.keys(2, {})
    await hands.keys(3, { attack: true })
    await hands.keys(4, { attack: true })
    assert.deepStrictEqual(bot.calls, ['stab'])
    // another item swung at nothing spends the attack strength
    bot.heldItem = { name: 'stick', count: 1 }
    bot.raycastHitResult = () => ({ type: 'miss' })
    await hands.keys(5, {})
    await hands.keys(6, { attack: true })
    assert.deepStrictEqual(bot.calls, ['stab', 'reset'])
  })
})
