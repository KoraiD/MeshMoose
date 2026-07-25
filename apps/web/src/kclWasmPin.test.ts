import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** Must match @kittycad/lib@4.3.12 embedded WebRTC worker ABI. */
const PINNED_KCL_WASM = '0.1.168'
const WORKER_ON_OPERATION = '__wbg_onOperation_9fa751e9adb89f31'

function repoRoot(): string {
  const cwd = process.cwd()
  // Vitest runs with cwd = apps/web
  if (existsSync(join(cwd, 'package.json')) && existsSync(join(cwd, '../..', 'package.json'))) {
    const webPkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as {
      name?: string
    }
    if (webPkg.name === 'meshmoose-web') return join(cwd, '../..')
  }
  return cwd
}

describe('kcl-wasm Live Engine ABI pin', () => {
  const root = repoRoot()
  const webDir = join(root, 'apps/web')

  it(`pins @kittycad/kcl-wasm-lib to ${PINNED_KCL_WASM}`, () => {
    const webPkg = JSON.parse(readFileSync(join(webDir, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
    }
    const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      overrides?: Record<string, string>
    }
    expect(webPkg.dependencies['@kittycad/kcl-wasm-lib']).toBe(PINNED_KCL_WASM)
    expect(rootPkg.overrides?.['@kittycad/kcl-wasm-lib']).toBe(PINNED_KCL_WASM)

    const installed = JSON.parse(
      readFileSync(join(root, 'node_modules/@kittycad/kcl-wasm-lib/package.json'), 'utf8'),
    ) as { version: string }
    expect(installed.version).toBe(PINNED_KCL_WASM)
  })

  it('serves public wasm that matches the installed package', () => {
    const publicWasm = join(webDir, 'public/kcl_wasm_lib_bg.wasm')
    const pkgWasm = join(root, 'node_modules/@kittycad/kcl-wasm-lib/kcl_wasm_lib_bg.wasm')
    expect(existsSync(publicWasm)).toBe(true)
    expect(existsSync(pkgWasm)).toBe(true)
    expect(statSync(publicWasm).size).toBe(statSync(pkgWasm).size)
    expect(statSync(publicWasm).size).toBeGreaterThan(1_000_000)
  })

  it('keeps @kittycad/lib worker glue aligned with public wasm imports', () => {
    const libJs = readFileSync(
      join(root, 'node_modules/@kittycad/lib/dist/mjs/index.js'),
      'utf8',
    )
    const match = libJs.match(/var Fn=Pn\("([^"]+)"/)
    expect(match).toBeTruthy()
    const worker = Buffer.from(match![1], 'base64').toString('utf8')
    expect(worker).toContain(WORKER_ON_OPERATION)
    expect(worker).toContain('/kcl_wasm_lib_bg.wasm')

    const glue = readFileSync(
      join(root, 'node_modules/@kittycad/kcl-wasm-lib/kcl_wasm_lib.js'),
      'utf8',
    )
    expect(glue).toContain(WORKER_ON_OPERATION)
  })
})
