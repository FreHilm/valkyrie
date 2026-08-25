/**
 * Differential check for the AssetBundle reader and the LZ4 decompressor.
 *
 * Ground truth is AssetStudio, run by `tools/ffg/probe` over the content cache
 * a real FFG install downloads, and dumped as a manifest of every Texture2D,
 * AudioClip and TextAsset with a SHA-256 of its payload.
 *
 * This covers what `tools/differential/unity` cannot: those files come from
 * the install and are read directly, while these are LZ4-compressed inside
 * `UnityFS` bundles. A single wrong byte anywhere in the decompressor changes
 * a hash, so the payload comparison exercises it end to end.
 *
 * The cache belongs to the user's licensed install and never leaves their
 * machine, so this skips when it is absent.
 *
 *   node tools/differential/bundle/compare.mjs [cacheDir] [manifest]
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { isUnityBundle, readBundle } from '../../../packages/platform/src/unityBundle.ts'
import {
  readObject,
  readSerializedFile,
  resolveStreamData,
} from '../../../packages/platform/src/unityAssets.ts'

const cacheDir =
  process.argv[2] ?? join(homedir(), 'Library', 'Caches', 'com.fantasyflightgames.mom')
const manifestPath =
  process.argv[3] ??
  join(homedir(), '.cache', 'valkyrie-web-port', 'ffg', 'MoM-cache', 'manifest.json')

if (!existsSync(cacheDir) || !existsSync(manifestPath)) {
  console.log(
    'bundle: no downloaded content cache or manifest — skipped (needs a licensed install)',
  )
  process.exit(0)
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')

/** Every `__data` bundle under the cache. */
const bundles = []
const walk = (directory) => {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) walk(path)
    else if (name === '__data') bundles.push(path)
  }
}
walk(cacheDir)

/**
 * AssetStudio swizzles R and B for the uncompressed colour formats, to suit
 * DDS's convention. The port keeps Unity's order; the same swizzle is applied
 * here so payloads still compare byte for byte.
 */
function swizzleLikeAssetStudio(format, bytes) {
  const out = Uint8Array.from(bytes)
  const stride = format === 'RGB24' ? 3 : 4
  if (format !== 'RGB24' && format !== 'RGBA32' && format !== 'BGRA32') return out

  for (let i = 0; i + stride - 1 < out.length; i += stride) {
    if (format === 'BGRA32') {
      const b0 = out[i]
      const b1 = out[i + 1]
      out[i] = out[i + 3]
      out[i + 1] = out[i + 2]
      out[i + 2] = b1
      out[i + 3] = b0
    } else {
      const b0 = out[i]
      out[i] = out[i + 2]
      out[i + 2] = b0
    }
  }
  return out
}

const actual = new Map()
let bundlesRead = 0
let assetFiles = 0

for (const path of bundles) {
  const bytes = new Uint8Array(readFileSync(path))
  if (!isUnityBundle(bytes)) continue

  let entries
  try {
    entries = readBundle(bytes)
    bundlesRead++
  } catch (error) {
    console.log(`\n${path.split('/').slice(-2)[0]}\n  bundle failed: ${error.message}`)
    continue
  }

  // Resource blobs are raw payloads, not SerializedFiles.
  const resources = new Map(
    entries
      .filter((entry) => /\.(resource|resS)$/.test(entry.path))
      .map((entry) => [entry.path, entry.data]),
  )

  for (const entry of entries) {
    if (/\.(resource|resS)$/.test(entry.path)) continue
    let parsed
    try {
      parsed = readSerializedFile(entry.data)
      assetFiles++
    } catch {
      continue
    }

    for (const info of parsed.objects) {
      let asset
      try {
        asset = readObject(entry.data, info, parsed.version)
      } catch (error) {
        actual.set(`${entry.path}:${info.pathId}`, { error: error.message })
        continue
      }
      if (asset === null) continue

      const payload =
        asset.kind === 'TextAsset'
          ? asset.data
          : asset.streamData !== null
            ? resolveStreamData(asset.streamData, resources)
            : asset.data

      // Path IDs are unique within a file, not across the cache — several
      // bundles reuse the same ids — so the file name is part of the key.
      actual.set(`${entry.path}:${info.pathId}`, { asset, payload })
    }
  }
}

let matched = 0
let divergences = 0
const byClass = new Map()
const reasons = new Map()

for (const expected of manifest) {
  const got = actual.get(`${expected.file}:${expected.pathId}`)
  const fail = (why, detail) => {
    divergences++
    reasons.set(why, (reasons.get(why) ?? 0) + 1)
    if (divergences <= 8) {
      console.log(`\n${expected.cls} "${expected.name}" (${expected.file})\n  ${why}: ${detail}`)
    }
  }

  if (got === undefined) {
    fail('missing', 'the port produced no object with this path id')
    continue
  }
  if (got.error !== undefined) {
    fail('threw', got.error)
    continue
  }

  const { asset, payload } = got
  if (asset.kind !== expected.cls) {
    fail('class', `expected ${expected.cls}, got ${asset.kind}`)
    continue
  }
  if (asset.name !== expected.name) {
    fail('name', `expected "${expected.name}", got "${asset.name}"`)
    continue
  }
  if (payload.length !== expected.size) {
    fail('payload size', `expected ${expected.size}, got ${payload.length}`)
    continue
  }

  const comparable =
    expected.cls === 'Texture2D' ? swizzleLikeAssetStudio(expected.format, payload) : payload
  if (expected.size > 0 && sha(comparable) !== expected.sha) {
    fail('payload bytes', `sha mismatch over ${expected.size} bytes`)
    continue
  }

  matched++
  byClass.set(expected.cls, (byClass.get(expected.cls) ?? 0) + 1)
}

console.log(
  `\nbundle: ${matched} of ${manifest.length} objects match AssetStudio, ${divergences} real divergences`,
)
console.log(`  read ${bundlesRead} bundles, ${assetFiles} asset files inside them`)
console.log(`  by class: ${[...byClass].map(([c, n]) => `${c} ${n}`).join(', ')}`)
if (reasons.size > 0) {
  console.log(`  failures: ${[...reasons].map(([r, n]) => `${r} ${n}`).join(', ')}`)
}
process.exit(divergences === 0 ? 0 : 1)
