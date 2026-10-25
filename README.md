# mc-physics-demo

The Minecraft web client with [minecraft-physics-native](https://github.com/mc-zuri/minecraft-physics-native)'s
engine moving the player, the boat it steers and the mob it rides: a Rust engine that matches the vanilla Java client
tick for tick, compiled to WebAssembly, in place of mineflayer-physics-utils. Every fork the client runs on is a
submodule here, on its `mc-physics-demo` branch.

## Run

Needs Node.js 22 or newer (with corepack) and git.

```sh
git clone --recursive --shallow-submodules <this repository> mc-physics-demo
cd mc-physics-demo
npm run setup
npm start
```

Then open http://localhost:3000 and turn on **Options → Controls → Physics → Native Physics (WebAssembly)**, or open
http://localhost:3000/?sp=1&setting=nativePhysics:true for a singleplayer world with it on. It applies from the next
connect; in the browser console `bot.physicsEngine.constructor.name` is `NativePhysics` (`BotcraftPhysics` with it off).

`npm run setup` installs and builds every folder the client takes from, in order (`scripts/setup.mjs`), each with the
pnpm version it pins.

## Folders

| folder | fork | upstream |
| --- | --- | --- |
| `minecraft-web-client` | [mc-zuri/prismarine-web-client](https://github.com/mc-zuri/prismarine-web-client) | zardoy/minecraft-web-client |
| `minecraft-physics-native` | [mc-zuri/minecraft-physics-native](https://github.com/mc-zuri/minecraft-physics-native) | oqzx/minecraft-physics-native |
| `mineflayer` | [mc-zuri/mineflayer](https://github.com/mc-zuri/mineflayer) | PrismarineJS/mineflayer |
| `mineflayer-physics-utils` | [mc-zuri/mineflayer-physics-utils](https://github.com/mc-zuri/mineflayer-physics-utils) | nxg-org/mineflayer-physics-utils |
| `minecraft-pathfinding` | [mc-zuri/minecraft-pathfinding](https://github.com/mc-zuri/minecraft-pathfinding) | Minecraft-Pathfinding/minecraft-pathfinding |
| `mineflayer-survival` | [mc-zuri/mineflayer-survival](https://github.com/mc-zuri/mineflayer-survival) | |
| `mineflayer-mouse` | [mc-zuri/mineflayer-mouse](https://github.com/mc-zuri/mineflayer-mouse) | zardoy/mineflayer-mouse |
| `minecraft-renderer` | [mc-zuri/minecraft-renderer](https://github.com/mc-zuri/minecraft-renderer) | zardoy/minecraft-renderer |
| `mc-assets` | [mc-zuri/mc-assets](https://github.com/mc-zuri/mc-assets) | zardoy/mc-assets |
| `minecraft-data` | [mc-zuri/minecraft-data-node](https://github.com/mc-zuri/minecraft-data-node), its data [mc-zuri/minecraft-data](https://github.com/mc-zuri/minecraft-data) | PrismarineJS/node-minecraft-data |
| `minecraft-protocol` | [mc-zuri/node-minecraft-protocol](https://github.com/mc-zuri/node-minecraft-protocol) | PrismarineJS/node-minecraft-protocol |
| `prismarine-chunk` | [mc-zuri/prismarine-chunk](https://github.com/mc-zuri/prismarine-chunk) | PrismarineJS/prismarine-chunk |
| `prismarine-block` | [mc-zuri/prismarine-block](https://github.com/mc-zuri/prismarine-block) | PrismarineJS/prismarine-block |
| `prismarine-item` | [mc-zuri/prismarine-item](https://github.com/mc-zuri/prismarine-item) | PrismarineJS/prismarine-item |
| `prismarine-windows` | [mc-zuri/prismarine-windows](https://github.com/mc-zuri/prismarine-windows) | PrismarineJS/prismarine-windows |

The root is the pnpm workspace that builds mineflayer-physics-utils, minecraft-pathfinding and mineflayer-survival
against the other forks (`pnpm-workspace.yaml`); the web client, the renderer, mineflayer-mouse and the engine install
on their own.

## Prebuilt

Two builds a clone cannot make are kept in `prebuilt/`, and setup copies them into their folders:

- `prebuilt/mc-assets/dist`: mc-assets' build reads Minecraft's jars;
- `prebuilt/minecraft-physics-native`: the engine's WebAssembly (napi's `wasm32-wasip1` target, no threads), which
  needs Rust.

After building either in its folder, `npm run update-prebuilt` copies it back here.

## Changing a fork

Commit in its folder (on `mc-physics-demo`), push to the fork, then `git add <folder>` and commit here.
