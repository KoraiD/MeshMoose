#!/usr/bin/env node
/** Copy Zoo KCL wasm into apps/web/public for @kittycad/web-view. */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const candidates = [
  join(root, 'node_modules/@kittycad/kcl-wasm-lib/kcl_wasm_lib_bg.wasm'),
  join(root, 'apps/web/node_modules/@kittycad/kcl-wasm-lib/kcl_wasm_lib_bg.wasm'),
  join(root, 'node_modules/web/node_modules/@kittycad/kcl-wasm-lib/kcl_wasm_lib_bg.wasm'),
]
const src = candidates.find((p) => existsSync(p))
if (!src) {
  console.warn('[copy-wasm] kcl_wasm_lib_bg.wasm not found — install @kittycad/web-view first')
  process.exit(0)
}
const destDir = join(root, 'apps/web/public')
mkdirSync(destDir, { recursive: true })
const dest = join(destDir, 'kcl_wasm_lib_bg.wasm')
copyFileSync(src, dest)
console.log(`[copy-wasm] ${src} → ${dest}`)
