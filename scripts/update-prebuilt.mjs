// Refreshes prebuilt/ from the checkouts after building them by hand: mc-assets (`pnpm build`, which needs the
// Minecraft jars) and the engine's WebAssembly (`npx napi build --manifest-path native/Cargo.toml --release --platform
// --target wasm32-wasip1 --output-dir native/artifacts --js native.js --dts native.d.ts`, with rustup's toolchain and
// its wasm32-wasip1 target).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const at = (...parts) => path.join(root, ...parts)

const ENGINE_ARTIFACTS = [
  'index.wasip1-browser.js',
  'index.wasm32-wasip1.wasm',
  'index.wasip1.cjs',
  'index.wasip1.d.cts',
  'index.wasip1-deferred.js',
  'index.wasip1-deferred.d.ts',
]

fs.rmSync(at('prebuilt/mc-assets/dist'), { recursive: true, force: true })
fs.cpSync(at('mc-assets/dist'), at('prebuilt/mc-assets/dist'), { recursive: true })

const artifacts = 'minecraft-physics-native/native/artifacts'
fs.mkdirSync(at('prebuilt', artifacts), { recursive: true })
for (const file of ENGINE_ARTIFACTS) {
  fs.copyFileSync(at(artifacts, file), at('prebuilt', artifacts, file))
}
console.log('prebuilt/ refreshed')
