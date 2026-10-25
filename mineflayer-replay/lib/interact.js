'use strict'
// The player's hands in a bot replay: each recorded tick's keys (attack, use, hotbar, drop, swap hands, pick item,
// inventory) and screen clicks, handed to mineflayer's own interaction API as vanilla's input layer hands them to its
// game mode (Minecraft.handleKeybinds, startAttack, continueAttack, startUseItem; MultiPlayerGameMode is what
// mineflayer's API stands for). The harness decides only what vanilla's input layer decides: which key press acts this
// tick (rightClickDelay, missTime, a screen in front of the world) and what the crosshair is on (mineflayer's own
// ray trace). What each action sends is left to mineflayer, and compared with what the vanilla client sent.
//
// Where mineflayer has no API for an action at all the action is not faked: it is recorded as `unsupported` (with the
// tick and why), and the packets vanilla sent for it show up as missing.
const { Vec3 } = require('vec3')
const fixtures = require('./fixture')
const { readServerbound } = require('./fakeClient')

// minecraft-protocol's names of the serverbound packets a player's hands send: digging and item actions
// (player_action), use on a block, use of an item, interaction with and attack of an entity, the swing (26.3: punch),
// the selected hotbar slot, and what is done in a screen
const INTERACTION = new Set([
  'block_dig', 'block_place', 'use_item', 'use_entity', 'attack', 'punch', 'arm_animation', 'held_item_slot',
  'window_click', 'close_window', 'transaction', 'set_slot_state', 'set_creative_slot', 'pick_item',
  'pick_item_from_block', 'pick_item_from_entity', 'select_trade', 'name_item', 'enchant_item', 'craft_recipe_request',
  'edit_book', 'update_sign', 'update_command_block', 'update_command_block_minecart', 'set_beacon_effect',
  'select_bundle_item', 'spectate'
])

// The screen's own packets: what the player clicked or typed in a screen, which no key of the recording tells. The
// recorded packet is the click (its slot, button and mode, the trade, the text); mineflayer is asked to make it.
const SCREEN = new Set(['window_click', 'close_window', 'select_trade', 'name_item', 'enchant_item', 'craft_recipe_request',
  'edit_book', 'update_sign', 'update_command_block', 'update_command_block_minecart', 'set_creative_slot',
  'set_beacon_effect', 'select_bundle_item', 'held_item_slot', 'set_slot_state'])
// screen actions mineflayer has no bot-level call for (only whole flows that open the screen themselves)
const NO_SCREEN_API = {
  select_trade: 'no bot-level select_trade: only bot.trade(villagerWindow) from openVillager, which runs the whole trade',
  name_item: 'no bot-level name_item: only openAnvil().rename/combine, which run the whole anvil flow',
  enchant_item: 'no bot-level enchant_item: only openEnchantmentTable().enchant on a table it opened itself',
  craft_recipe_request: 'no bot-level recipe book placement (bot.craft clicks the slots itself)',
  update_command_block_minecart: 'no API for a command block minecart',
  set_beacon_effect: 'no API for a beacon',
  select_bundle_item: 'no API for a bundle',
  set_slot_state: 'no API for a crafter slot'
}

const BLOCK_FACES = [new Vec3(0, -1, 0), new Vec3(0, 1, 0), new Vec3(0, 0, -1), new Vec3(0, 0, 1), new Vec3(-1, 0, 0), new Vec3(1, 0, 0)]
const HOTBAR = ['hotbar1', 'hotbar2', 'hotbar3', 'hotbar4', 'hotbar5', 'hotbar6', 'hotbar7', 'hotbar8', 'hotbar9']
// the keys the recorder clicks as it presses them (BridgeImpl.applyKeys: KeyMapping.clickCount from the use key on)
const CLICK_KEYS = ['use', 'attack', 'drop', 'swapHands', 'inventory', ...HOTBAR, 'pickItem']

// Rideables: a use on them is bot.mount
const RIDEABLE = /boat|raft|minecart|horse|donkey|mule|camel|llama|^pig$|strider|happy_ghast|nautilus/
// (a boat or a raft, with a chest too; Boat before 1.11)
const BOAT = /(^|_)(boat|raft)$|^Boat$/

// ItemStack.isItemEnabled: 1.20.5 - 1.20.6 hold 1.21's items behind the update_1_21 experiment, off on the recording
// servers
const UPDATE_1_21_ITEMS = new Set(['wind_charge', 'mace', 'breeze_rod', 'heavy_core', 'trial_key', 'ominous_trial_key', 'ominous_bottle'])

// The sequence the recorded client's next block interaction would have (BlockStatePredictionHandler.currentSequence
// went on counting through the session before the case): its first non-zero sequence, minus one; null when the case
// has none.
function recordedSequenceStart (version, rows) {
  for (const row of rows) {
    for (const entry of row.events.clientPackets ?? []) {
      const packet = readServerbound(version, fixtures.bytesOf(entry.bytes))
      if (packet && /^(block_dig|block_place|use_item)$/.test(packet.name) && packet.params.sequence > 0) return packet.params.sequence - 1
    }
  }
  return null
}

function createHands (bot, version) {
  const registry = bot.registry
  const mineflayerPath = require.resolve('mineflayer')
  const { RaycastIterator } = require(require.resolve('prismarine-world', { paths: [mineflayerPath] })).iterators
  const Item = require(require.resolve('prismarine-item', { paths: [mineflayerPath] }))(registry)
  const state = {
    held: {}, // keys down the tick before
    rightClickDelay: 0,
    missTime: 0,
    // the screen in front of the world: null, 'inventory' (the player's own, which sends nothing to open), 'book' (a
    // book and quill's editor, which neither), 'window'
    screen: null,
    // a screen the keys opened this tick released every key (Minecraft.setScreen: KeyMapping.releaseAll): the rest of
    // the tick, the player's movement too, runs without them
    keysReleased: false,
    // the player paddled the boat it steers last tick (LocalPlayer.rideTick: handsBusy, from 1.9): neither attack nor
    // use act
    handsBusy: false,
    // a call that resolves later was made this tick: the replay lets it run before the tick
    pending: false,
    // the clicks of keys pressed while a screen was open (KeyMapping.clickCount: the recorder counts a press whatever is
    // in front of the world, and handleKeybinds, which consumes them, runs only once no screen is), by key
    queued: {}
  }
  const unsupported = []
  const gap = (t, action, reason) => unsupported.push({ t, action, reason })
  // A screen the server opens releases every key (Minecraft.setScreen: KeyMapping.releaseAll: up, their clicks
  // dropped): a key the recorder holds again at the next tick counts as a new press
  bot.on('windowOpen', () => {
    state.screen = 'window'
    state.held = {}
    state.queued = {}
  })
  bot.on('windowClose', () => { state.screen = null })
  // A screen the client opens itself as its keys act (handleKeybinds): the player's inventory, a book and quill's
  // editor. Opening it releases every key (KeyMapping.releaseAll: up, their clicks dropped) for the rest of the tick;
  // the recorder holds the recorded keys down again at the next tick's start, a held one then counting as a new press.
  // (A screen the server opens comes between ticks, before the recorder holds the keys again: the tick's keys hold on,
  // and only the clicks count anew.)
  const openOwnScreen = name => {
    state.screen = name
    state.keysReleased = true
    state.queued = {}
  }

  const quiet = promise => { if (promise?.catch) { state.pending = true; promise.catch(() => {}) } }
  // The bot is already looking where the client looked (the replay sets its view each tick); mineflayer's activateBlock
  // and activateEntity(At) first turn it to the block's or entity's centre with an unforced lookAt, which only finishes
  // over the ticks after and moves the view the movement packets report. While they run the view is held, so what
  // they send is what they send at the client's crosshair.
  const holdingView = fn => {
    const lookAt = bot.lookAt
    bot.lookAt = async () => {}
    try { return fn() } finally { bot.lookAt = lookAt }
  }

  const creative = () => bot.game.gameMode === 'creative'
  const spectator = () => bot.game.gameMode === 'spectator'
  const itemEnabled = item => !(item && UPDATE_1_21_ITEMS.has(item.name) && registry.version['<']('1.21'))

  // The crosshair (Minecraft.pick / GameRenderer.pick): the entity within reach in front of the first block, else the
  // block, by mineflayer's own ray traces. Reach: 4.5 blocks and 3 to an entity, in creative 5 and 5 (6 before 1.20.5).
  function pick () {
    const blockReach = creative() ? 5 : 4.5
    const entityReach = creative() ? (registry.version['>=']('1.20.5') ? 5 : 6) : 3
    if (bot.raycastHitResult) {
      // mineflayer's own pick, as vanilla's (LocalPlayer.raycastHitResult): where the crosshair meets the entity too
      const hit = bot.raycastHitResult(blockReach, entityReach)
      if (hit.type === 'entity') return { type: 'entity', entity: hit.entity, at: hit.intersect }
      if (hit.type === 'block') return { type: 'block', block: hit.block, face: hit.face, cursor: hit.intersect.minus(hit.block.position) }
      return { type: 'miss' }
    }
    const entity = bot.entityAtCursor(entityReach)
    if (entity) return { type: 'entity', entity, at: entityHitPoint(entity) }
    const block = bot.blockAtCursor(blockReach)
    if (block) return { type: 'block', block, face: block.face, cursor: block.intersect.minus(block.position) }
    return { type: 'miss' }
  }

  // where the view ray meets the entity's box, as entityAtCursor finds it (it gives only the entity)
  function entityHitPoint (entity) {
    const { yaw, pitch } = bot.entity
    const dir = new Vec3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch))
    const iterator = new RaycastIterator(bot.entity.position.offset(0, bot.entity.eyeHeight, 0), dir.normalize(), 8)
    const w = entity.width / 2
    const hit = iterator.intersect([[-w, 0, -w, w, entity.height, w]], entity.position)
    return hit?.pos ?? entity.position.offset(0, entity.height / 2, 0)
  }

  // mineflayer's dig times the break itself and aborts a dig of another block first (ABORT, then START); held on from
  // another block (continueAttack) it starts with the tick, after the delay a break leaves
  function startDig (t, hit, held = false) {
    quiet(bot.dig(hit.block, 'ignore', 'auto', hit.face, { held }))
  }

  // Minecraft.startAttack: an entity is attacked, a block starts being dug, the air is swung at
  function startAttack (t) {
    if (state.missTime > 0) return false
    if (state.handsBusy) return false
    if (spectator()) {
      gap(t, 'attack (spectator)', 'no API for spectating an entity')
      return false
    }
    if (!itemEnabled(bot.heldItem)) return false
    // an item that needs a charge the attack strength lacks (a spear's): nothing (Player.cannotAttackWithItem)
    if (bot.cannotAttackWithItem?.(bot.heldItem, 0)) return false
    // a piercing weapon stabs, whatever the crosshair is on, and ends the attack (MultiPlayerGameMode.piercingAttack)
    if (bot.isPiercingWeapon?.(bot.heldItem)) {
      bot.stab()
      return true
    }
    const hit = pick()
    if (hit.type === 'entity') {
      bot.attack(hit.entity)
    } else if (hit.type === 'block') {
      startDig(t, hit)
      // a block broken at once (creative, or an instant break) ends the attack: the held key does not go on this tick
      if (bot.blockAt(hit.block.position)?.type === 0) return true
    } else {
      if (!creative()) state.missTime = 10
      bot.resetAttackStrengthTicker?.()
      bot.swingArm()
    }
    return false
  }

  // Minecraft.continueAttack: while the key is held on a block it goes on being dug (mineflayer's dig, ticking by
  // itself), a new block or face at the crosshair is dug instead, and letting go (or looking away) stops it, a dig the
  // server's break ended too (MultiPlayerGameMode.stopDestroyBlock: isDestroying)
  function continueAttack (t, down) {
    if (!down) state.missTime = 0
    if (state.missTime > 0 || bot.usingHeldItem) return
    // (a piercing weapon digs nothing)
    if (bot.isPiercingWeapon?.(bot.heldItem)) return
    const hit = down ? pick() : null
    if (hit?.type === 'block') {
      const target = bot.targetDigBlock
      if (target && target.position.equals(hit.block.position) && bot.targetDigFace === hit.face) return
      startDig(t, hit, true)
    } else if (bot.targetDigBlock || bot.isDestroying) {
      bot.stopDigging()
    }
  }

  // Minecraft.pickBlockOrEntity: the block or the entity at the crosshair, which the server picks from 1.21.4, the
  // client before (Minecraft.pickBlock: mineflayer's pickBlock / pickEntity pick it alike). The recordings hold no
  // control key: no data asked for.
  function pickItem (t) {
    if (!bot.pickBlock) return gap(t, 'pickItem', 'no API for the pick key')
    const hit = pick()
    if (hit.type === 'block') bot.pickBlock(hit.block, false)
    else if (hit.type === 'entity') bot.pickEntity(hit.entity, false)
  }

  // Minecraft.startUseItem: the entity, else the block, else the item, with the main hand and then the off hand
  async function startUseItem (t) {
    // (MultiPlayerGameMode.isDestroying: a dig started and not broken yet)
    if (bot.isDestroying ?? bot.targetDigBlock) return
    state.rightClickDelay = 4
    if (state.handsBusy) return
    // (a spectator's use goes on too: on a block it is sent, a CONSUME, before 1.21.2 a SUCCESS that swings,
    // MultiPlayerGameMode.performUseItemOn)
    const hit = pick()
    // (before 1.9 there is no off hand: Minecraft.rightClickMouse tries the held item alone)
    const hands = [[bot.heldItem, false]]
    if (registry.version['>=']('1.9')) hands.push([bot.inventory.slots[45], true])
    for (const [item, offHand] of hands) {
      if (!itemEnabled(item)) return
      if (hit.type === 'entity') {
        const result = RIDEABLE.test(hit.entity.name ?? '')
          ? bot.mount(hit.entity, offHand)
          : await holdingView(() => bot.activateEntityAt(hit.entity, hit.at, offHand))
        // a use the entity takes ends startUseItem (InteractionResult.Success, a CONSUME too); one it passes on goes to
        // the item in that hand, then to the off hand (mineflayer predicts which, as the client does)
        if (result !== 'pass') return
      }
      if (hit.type === 'block') {
        const result = await holdingView(() => bot.activateBlock(hit.block, BLOCK_FACES[hit.face], hit.cursor, offHand))
        // a use on the block that acts (a Success, a CONSUME too) or fails ends startUseItem; one that passes goes on to
        // the item in that hand, then to the off hand (mineflayer predicts which, as the client does). Before 1.13 a
        // FAIL went on too (Minecraft.rightClickMouse stopped only for a SUCCESS).
        if (result !== 'pass' && !(result === 'fail' && registry.version['<']('1.13'))) return
      }
      if (item) {
        const result = bot.activateItem(offHand)
        // a book and quill opens its editor on the client (WritableBookItem.use: LocalPlayer.openItemGui)
        if (item.name === 'writable_book') openOwnScreen('book')
        // an item that does something in the air ends the use (InteractionResult.Success); one that passes or fails
        // goes on to the off hand
        if (result === 'success' || result === 'success_server' || result === 'consume') return
      }
    }
  }

  // The keys of a tick, before it (Minecraft.tick: rightClickDelay, then handleKeybinds while no screen is open). The
  // use key: while an item is in use, letting go releases it; otherwise a press uses, and so does the held key once
  // rightClickDelay is back to 0. (What an item used up leaves in the hand is mineflayer's: it finishes the item on the
  // client as LivingEntity.completeUsingItem does.)
  async function keys (t, input) {
    state.keysReleased = false
    const down = key => !state.keysReleased && !!input[key]
    const pressed = key => down(key) && !state.held[key]
    // the key's clicks handleKeybinds consumes this tick: its press, and those made while a screen was open (none once
    // a screen the keys opened released them)
    const clicks = key => state.keysReleased ? 0 : (pressed(key) ? 1 : 0) + (state.queued[key] ?? 0)
    if (state.rightClickDelay > 0) state.rightClickDelay--
    if (state.screen) {
      state.missTime = 10000
      for (const key of CLICK_KEYS) if (pressed(key)) state.queued[key] = (state.queued[key] ?? 0) + 1
    } else {
      HOTBAR.forEach((key, slot) => {
        if (clicks(key) && !spectator()) bot.setQuickBarSlot(slot)
      })
      if (clicks('inventory')) {
        // a rider of a mount with an inventory asks the server to open it (openEntity); otherwise the player's own
        // inventory opens, which sends nothing
        const custom = bot._hasCustomInventoryScreen ? bot._hasCustomInventoryScreen(bot.vehicle) : !!bot.vehicle
        if (bot.vehicle && custom) quiet(bot.openEntity(bot.vehicle))
        else openOwnScreen('inventory')
      }
      if (clicks('swapHands') && !spectator()) {
        if (bot.swapHands) bot.swapHands()
        else gap(t, 'swapHands', 'no API swaps the hands (SWAP_ITEM_WITH_OFFHAND)')
      }
      for (let n = clicks('drop'); n > 0 && !spectator(); n--) {
        // the held item dropped from the hand (DROP_ITEM; with control the stack, which no recording tells)
        if (bot.dropHeldItem) bot.dropHeldItem(false)
        else if (bot.heldItem) quiet(bot.toss(bot.heldItem.type, null, 1))
      }
      let instantAttack = false
      if (bot.usingHeldItem) {
        if (!down('use')) bot.deactivateItem()
      } else {
        for (let n = clicks('attack'); n > 0; n--) instantAttack = startAttack(t) || instantAttack
        for (let n = clicks('use'); n > 0 && clicks('use'); n--) await startUseItem(t)
        if (clicks('pickItem')) pickItem(t)
      }
      state.queued = {}
      if (down('use') && state.rightClickDelay === 0 && !bot.usingHeldItem) await startUseItem(t)
      continueAttack(t, !instantAttack && down('attack'))
      if (state.missTime > 0) state.missTime--
    }
    state.held = state.keysReleased ? {} : { ...input }
    // (the tick's ride: the boat takes the movement keys, and paddling with them keeps the hands busy)
    const vehicle = bot.vehicle
    const steers = vehicle && BOAT.test(vehicle.name ?? '') && (vehicle.passengers?.[0] ?? bot.entity) === bot.entity
    state.handsBusy = !!steers && registry.version['>=']('1.9') && ['left', 'right', 'forward', 'back'].some(down)
  }

  // The client ticks again after a pause: in singleplayer a pausing screen stops its ticks until it closes, so a book
  // editor, which tells the server nothing when it closes unchanged (BookEditScreen.saveChanges), has closed
  function resumed () {
    if (state.screen === 'book') state.screen = null
  }

  // What the player did in a screen this tick, as the client sent it: the same click or text, made through mineflayer.
  // (input: the tick's keys, which the screen's actions come before)
  function screen (t, packets, input = {}) {
    // before 1.21.4 the pick key sets the creative slot it picks into this tick, and its hotbar slot is sent the tick
    // after: the key's, not the screen's (mineflayer's pickBlock / pickEntity send them)
    const clientPicks = registry.version['<']('1.21.4')
    const picking = clientPicks && !state.screen && !!input.pickItem && !state.held.pickItem
    for (const { name, params } of packets) {
      if (!SCREEN.has(name)) continue
      if (name === 'set_creative_slot' && picking) continue
      if (name === 'held_item_slot') {
        // a hotbar key (or a pick) sends its slot the tick after (MultiPlayerGameMode.tick); a slot sent without one is
        // the screen's
        if (HOTBAR.some(key => state.held[key]) || (clientPicks && state.held.pickItem)) continue
        // (picked in the frame before the tick: sent with it)
        if (bot._selectQuickBarSlotBeforeTick) bot._selectQuickBarSlotBeforeTick(params.slotId)
        else bot.setQuickBarSlot(params.slotId)
      } else if (name === 'window_click') {
        quiet(bot.clickWindow(params.slot, params.mouseButton, params.mode))
      } else if (name === 'close_window') {
        const window = bot.currentWindow?.id === params.windowId ? bot.currentWindow : params.windowId === 0 ? bot.inventory : (bot.currentWindow ?? bot.inventory)
        bot.closeWindow(window)
        state.screen = null
      } else if (name === 'update_sign') {
        const block = bot.blockAt(new Vec3(params.location.x, params.location.y, params.location.z))
        const lines = [params.text1, params.text2, params.text3, params.text4].map(line => {
          try { return line?.startsWith('"') ? JSON.parse(line) : line ?? '' } catch { return line ?? '' }
        })
        if (block) bot.updateSign(block, lines.join('\n').replace(/\n+$/, ''), params.isFrontText === false)
        else gap(t, name, 'the sign is not in the bot\'s world')
      } else if (name === 'update_command_block') {
        const flags = params.flags ?? 0
        try {
          bot.setCommandBlock(new Vec3(params.location.x, params.location.y, params.location.z), params.command,
            { mode: params.mode, trackOutput: !!(flags & 1), conditional: !!(flags & 2), alwaysActive: !!(flags & 4) })
        } catch (err) { gap(t, name, `setCommandBlock refused: ${err.message}`) }
      } else if (name === 'edit_book') {
        editBook(t, params)
      } else if (name === 'select_trade' && bot.selectTrade) {
        bot.selectTrade(params.slot)
      } else if (name === 'name_item' && bot.setAnvilItemName) {
        bot.setAnvilItemName(params.name)
      } else if (name === 'enchant_item' && bot.clickEnchantment) {
        bot.clickEnchantment(params.enchantment)
      } else if (name === 'set_creative_slot') {
        let item = null
        try { item = Item.fromNotch(params.item) } catch { item = null }
        quiet(bot.creative.setInventorySlot(params.slot, item))
      } else {
        gap(t, name, NO_SCREEN_API[name] ?? 'no API')
      }
    }
  }

  // The book and quill's editor saved as it closes, or signed (BookEditScreen.saveChanges): bot.writeBook / bot.signBook
  // on the book in hand, which send just that while it is in the selected hotbar slot. From 1.17.1 the packet says the
  // book's slot (40 the off hand), its pages and the title signed; before, the book as edited and the hand.
  function editBook (t, params) {
    const book = params.new_book ? Item.fromNotch(params.new_book) : null
    const tags = book?.nbt?.value ?? {}
    const pages = params.pages ?? tags.pages?.value?.value ?? []
    const offHand = params.new_book ? params.hand === 1 : params.hand === 40
    const signing = params.new_book ? !!params.signing : params.title != null
    const title = params.title ?? tags.title?.value
    state.screen = null
    if (offHand) return gap(t, 'edit_book', 'bot.writeBook takes a book in the inventory (slots 0 - 44), not in the off hand')
    const slot = bot.QUICK_BAR_START + bot.quickBarSlot
    // (before 1.17.1 the book signed carries its author, the recorded player's name: the bot's own is the replay's)
    quiet(signing ? bot.signBook(slot, pages, tags.author?.value ?? bot.username, title) : bot.writeBook(slot, pages))
  }

  // a tick whose screen action could not be read (minecraft-protocol cannot decode the client's packet)
  function unreadable (t, count) {
    gap(t, 'unreadable client packet', `${count} recorded packet(s) minecraft-protocol cannot decode`)
  }

  return { keys, screen, resumed, unreadable, unsupported, state }
}

module.exports = { INTERACTION, SCREEN, createHands, recordedSequenceStart }
