/**
 * Runs the full import against a real install, outside the browser.
 *
 * A real end-to-end exercise of the pipeline the browser will run: read the
 * install, extract, decode, encode, write. The output goes to a cache outside
 * the repository — it is licensed content and must never be committed.
 *
 *   node tools/ffg/run-import.mjs "<install>" [game] "<download cache>"
 *
 * Point it at the *desktop* install. A wrapped iOS build has its data under
 * `Wrapper/<name>.app/Data` and ships a fraction of the art — no box shots at
 * all — so an import from one succeeds and quietly produces a smaller game
 * than an import from the Steam or standalone build beside it.
 *
 * The download cache is not optional in practice. Current builds keep almost
 * nothing in the install — MoM 2.1.6 fetches its art, audio and text on first
 * run — so importing the install alone yields a handful of textures and looks
 * like a working import that produced nothing. On macOS it is
 * ~/Library/Caches/com.fantasyflightgames.mom.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import sharp from 'sharp'

import { NodeFileSystem } from '../../packages/platform/src/node.ts'
import { importFfgApp, isLossyFormat } from '../../packages/platform/src/ffgImport.ts'

const input = process.argv[2]
const game = process.argv[3] ?? 'MoM'
if (input === undefined) {
  console.error('usage: run-import.mjs <install path> [MoM|D2E] [download cache]')
  console.error('  the download cache holds nearly everything; see the header')
  process.exit(1)
}

const dataDir = statSync(join(input, 'Contents/Resources/Data'), { throwIfNoEntry: false })
  ? join(input, 'Contents/Resources/Data')
  : input

/**
 * The install and the downloaded content cache together.
 *
 * Current builds keep almost nothing in the install: MoM 2.1.6 downloads its
 * scenarios and all of its text on first run. Importing only the install
 * yields images and audio but no localisation.
 */
function sourceOver(directories) {
  const files = new Map()
  const walk = (root, dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(root, full)
      else files.set(full.slice(root.length + 1), full)
    }
  }
  for (const d of directories) if (existsSync(d)) walk(d, d)

  return {
    list: async () => [...files.keys()],
    read: async (name) => new Uint8Array(readFileSync(files.get(name) ?? name)),
  }
}

const cacheDir = process.argv[4]
const source = sourceOver([dataDir, ...(cacheDir === undefined ? [] : [cacheDir])])

const out = join(homedir(), '.cache', 'valkyrie-web-port', 'ffg', `${game}-import`)
const fs = new NodeFileSystem(out)

/**
 * Stands in for the browser's OffscreenCanvas encoder. `sharp` produces the
 * same lossless WebP a browser does; what is being exercised here is the
 * pipeline, not the codec.
 */
const encodeTexture = async (rgba, width, height, sourceFormat) => {
  // Same policy as canvasTextureEncoder: block-compressed sources are already
  // lossy, so q90 costs nothing real and is ~3x smaller; pristine sources
  // (UI art, SDF font atlases) stay lossless.
  const lossy = isLossyFormat(sourceFormat)
  const bytes = await sharp(Buffer.from(rgba), { raw: { width, height, channels: 4 } })
    .webp(lossy ? { quality: 90, effort: 4 } : { lossless: true, effort: 4 })
    .toBuffer()
  return { bytes: new Uint8Array(bytes), extension: '.webp' }
}

const started = Date.now()
let last = 0
const result = await importFfgApp({
  fs,
  source,
  importPath: '/import',
  game,
  encodeTexture,
  onProgress: (done) => {
    if (done - last >= 200) {
      last = done
      console.log(`  ${done} objects...`)
    }
  },
})

const seconds = (Date.now() - started) / 1000
console.log(`\nimported in ${seconds.toFixed(1)}s to ${out}`)
console.log(`  textures : ${result.textures} (${result.emptyTextures} empty, skipped)`)
console.log(`  audio    : ${result.audio}`)
console.log(`  text     : ${result.text}`)
console.log(`  fonts    : ${result.fonts}`)
console.log(`  written  : ${(result.bytesWritten / 1e6).toFixed(1)} MB`)
if (result.skipped.length > 0) {
  console.log(`  skipped  : ${result.skipped.length}`)
  for (const s of result.skipped.slice(0, 5)) console.log(`    ${s.name}: ${s.reason}`)
}
