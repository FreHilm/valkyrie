/**
 * Differential check for the Unity SerializedFile reader.
 *
 * Ground truth is the real AssetStudio, run by `tools/ffg/probe` over a
 * licensed FFG install and dumped as a manifest of every Texture2D, AudioClip
 * and TextAsset with its identity and a SHA-256 of its payload.
 *
 * The install is the user's own and never leaves their machine; the manifest
 * lives outside the repository, so this is skipped when it is absent.
 *
 *   node tools/differential/unity/compare.mjs [dataDir] [manifest]
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import {
  ClassID,
  readObject,
  readSerializedFile,
  resolveStreamData,
} from '../../../packages/platform/src/unityAssets.ts'

/**
 * Where a licensed Mansions of Madness install keeps its Unity data.
 *
 * Passed as an argument or through VALKYRIE_MOM_DATA; the defaults below are
 * the usual Steam locations. Nothing here ships with the repository — the
 * harness skips cleanly when the install is absent, which is what CI does.
 */
const DEFAULT_DATA_DIRS = [
  join(
    homedir(),
    'Library/Application Support/Steam/steamapps/common/Mansions of Madness',
    'Mansions of Madness.app/Contents/Resources/Data',
  ),
  join(homedir(), '.steam/steam/steamapps/common/Mansions of Madness/Mansions of Madness_Data'),
  'C:/Program Files (x86)/Steam/steamapps/common/Mansions of Madness/Mansions of Madness_Data',
]

const dataDir =
  process.argv[2] ??
  process.env.VALKYRIE_MOM_DATA ??
  DEFAULT_DATA_DIRS.find((path) => existsSync(path)) ??
  DEFAULT_DATA_DIRS[0]
const manifestPath =
  process.argv[3] ?? join(homedir(), '.cache', 'valkyrie-web-port', 'ffg', 'MoM', 'manifest.json')

if (!existsSync(manifestPath) || !existsSync(dataDir)) {
  console.log('unity: no FFG install or manifest — skipped (needs a licensed install)')
  process.exit(0)
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')

/** Every sibling file a streamed asset might point into. */
const resources = new Map()
for (const name of readdirSync(dataDir)) {
  if (name.endsWith('.resS') || name.endsWith('.resource')) {
    resources.set(name, new Uint8Array(readFileSync(join(dataDir, name))))
  }
}

const CLASS_NAMES = {
  [ClassID.Texture2D]: 'Texture2D',
  [ClassID.AudioClip]: 'AudioClip',
  [ClassID.TextAsset]: 'TextAsset',
}

/**
 * AssetStudio mutates `image_data_bytes` in place for the uncompressed colour
 * formats, swapping R and B so the bytes suit DDS's BGRA convention
 * (`Texture2D.cs`, the RGB24 / RGBA32 / BGRA32 cases). The port keeps Unity's
 * raw order, because a canvas wants RGBA and that round trip exists only to
 * satisfy the C#'s DDS intermediate.
 *
 * The same swizzle is applied here so payloads still compare byte for byte,
 * rather than relaxing the check to "close enough".
 */
function swizzleLikeAssetStudio(format, bytes) {
  const out = Uint8Array.from(bytes)
  if (format === 'RGB24') {
    for (let i = 0; i + 2 < out.length; i += 3) {
      const b0 = out[i]
      out[i] = out[i + 2]
      out[i + 2] = b0
    }
  } else if (format === 'RGBA32') {
    for (let i = 0; i + 3 < out.length; i += 4) {
      const b0 = out[i]
      out[i] = out[i + 2]
      out[i + 2] = b0
    }
  } else if (format === 'BGRA32') {
    for (let i = 0; i + 3 < out.length; i += 4) {
      const b0 = out[i]
      const b1 = out[i + 1]
      out[i] = out[i + 3]
      out[i + 1] = out[i + 2]
      out[i + 2] = b1
      out[i + 3] = b0
    }
  }
  return out
}

const files = [...new Set(manifest.map((e) => e.file))].sort()
const actual = new Map()

for (const file of files) {
  const path = join(dataDir, file)
  if (!existsSync(path)) continue
  const bytes = new Uint8Array(readFileSync(path))
  const serialized = readSerializedFile(bytes)

  // Each asset file has its own .resS next to it.
  const local = new Map(resources)
  local.set(`${file}.resS`, resources.get(`${file}.resS`) ?? new Uint8Array(0))

  for (const info of serialized.objects) {
    if (CLASS_NAMES[info.classId] === undefined) continue
    let asset
    try {
      asset = readObject(bytes, info, serialized.version)
    } catch (error) {
      actual.set(`${file}:${info.pathId}`, { error: error.message })
      continue
    }
    if (asset === null) continue

    const payload =
      asset.kind === 'TextAsset'
        ? asset.data
        : asset.streamData !== null
          ? resolveStreamData(asset.streamData, local)
          : asset.data

    actual.set(`${file}:${info.pathId}`, { asset, payload })
  }
}

let matched = 0
let divergences = 0
const byClass = new Map()
const reasons = new Map()

for (const expected of manifest) {
  const key = `${expected.file}:${expected.pathId}`
  const got = actual.get(key)

  const fail = (why, detail) => {
    divergences++
    reasons.set(why, (reasons.get(why) ?? 0) + 1)
    if (divergences <= 8)
      console.log(`\n${key} ${expected.cls} "${expected.name}"\n  ${why}: ${detail}`)
  }

  if (got === undefined) {
    fail('missing', 'the port produced no object here')
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
  if (expected.cls === 'Texture2D') {
    if (asset.width !== expected.width || asset.height !== expected.height) {
      fail(
        'size',
        `expected ${expected.width}x${expected.height}, got ${asset.width}x${asset.height}`,
      )
      continue
    }
  }
  if (expected.cls === 'AudioClip') {
    if (asset.channels !== expected.channels || asset.frequency !== expected.frequency) {
      fail(
        'audio',
        `expected ${expected.channels}ch/${expected.frequency}Hz, got ${asset.channels}ch/${asset.frequency}Hz`,
      )
      continue
    }
  }
  if (payload.length !== expected.size) {
    fail('payload size', `expected ${expected.size}, got ${payload.length}`)
    continue
  }
  const comparable =
    expected.cls === 'Texture2D' ? swizzleLikeAssetStudio(expected.format, payload) : payload

  if (expected.size > 0 && sha(comparable) !== expected.sha) {
    fail(
      'payload bytes',
      `sha mismatch over ${expected.size} bytes (format ${expected.format ?? '-'})`,
    )
    continue
  }

  matched++
  byClass.set(expected.cls, (byClass.get(expected.cls) ?? 0) + 1)
}

console.log(
  `\nunity: ${matched} of ${manifest.length} objects match AssetStudio, ${divergences} real divergences`,
)
console.log(`  by class: ${[...byClass].map(([c, n]) => `${c} ${n}`).join(', ')}`)
if (reasons.size > 0)
  console.log(`  failures: ${[...reasons].map(([r, n]) => `${r} ${n}`).join(', ')}`)
process.exit(divergences === 0 ? 0 : 1)
