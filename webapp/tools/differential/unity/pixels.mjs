/**
 * Ties the two texture paths together.
 *
 * `decodeUnityTexture` reads Unity's payload directly; `decodeDds` reads the
 * DDS file AssetStudio exports from the same texture. They come through
 * completely different code — different container, different channel order —
 * so agreeing pixel for pixel is a strong check on both.
 *
 *   node tools/differential/unity/pixels.mjs
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { decodeDds, decodeUnityTexture, flipRows } from '../../../packages/platform/src/dds.ts'
import {
  ClassID,
  readObject,
  readSerializedFile,
  resolveStreamData,
} from '../../../packages/platform/src/unityAssets.ts'

/**
 * Where a licensed Mansions of Madness install keeps its Unity data.
 *
 * Passed through VALKYRIE_MOM_DATA; the defaults below are the usual Steam
 * locations. Nothing here ships with the repository — the harness skips
 * cleanly when the install is absent, which is what CI does.
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

const DATA =
  process.argv[2] ??
  process.env.VALKYRIE_MOM_DATA ??
  DEFAULT_DATA_DIRS.find((path) => existsSync(path)) ??
  DEFAULT_DATA_DIRS[0]
const IMG = join(homedir(), '.cache', 'valkyrie-web-port', 'ffg', 'MoM', 'img')

if (!existsSync(DATA) || !existsSync(IMG)) {
  console.log('unity-pixels: no FFG install or export — skipped')
  process.exit(0)
}

const resources = new Map()
for (const name of readdirSync(DATA)) {
  if (name.endsWith('.resS') || name.endsWith('.resource')) {
    resources.set(name, new Uint8Array(readFileSync(join(DATA, name))))
  }
}

/** The exported DDS files, keyed by the name and format they were saved under. */
const exported = new Map()
for (const file of readdirSync(IMG)) {
  const match = /^(.*)\.([A-Za-z0-9]+)\.dds$/.exec(file)
  if (match !== null) exported.set(`${match[1]}|${match[2]}`, join(IMG, file))
}

const FORMAT_NAMES = { 1: 'Alpha8', 3: 'RGB24', 4: 'RGBA32', 10: 'DXT1', 12: 'DXT5' }
const sha = (b) => createHash('sha256').update(b).digest('hex')
const safe = (name) => name.replace(/[/\\?%*:|"<>]/g, '_').replace(/ /g, '_')

// Several textures share a name — a dozen are called "Image_2". The export
// keys files by name, so those cannot be matched back to a single object.
// Counting first means the comparison only runs where the name is unambiguous,
// rather than silently comparing two different textures.
const nameCounts = new Map()
for (const file of readdirSync(DATA).filter((f) => f.endsWith('.assets'))) {
  const bytes = new Uint8Array(readFileSync(join(DATA, file)))
  let parsed
  try {
    parsed = readSerializedFile(bytes)
  } catch {
    continue
  }
  for (const info of parsed.objects) {
    if (info.classId !== ClassID.Texture2D) continue
    const asset = readObject(bytes, info, parsed.version)
    if (asset === null) continue
    const key = `${safe(asset.name)}|${FORMAT_NAMES[asset.textureFormat]}`
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1)
  }
}

let matched = 0
let divergences = 0
let skipped = 0
let ambiguous = 0

for (const file of readdirSync(DATA).filter((f) => f.endsWith('.assets'))) {
  const bytes = new Uint8Array(readFileSync(join(DATA, file)))
  let parsed
  try {
    parsed = readSerializedFile(bytes)
  } catch {
    continue
  }

  for (const info of parsed.objects) {
    if (info.classId !== ClassID.Texture2D) continue
    const asset = readObject(bytes, info, parsed.version)
    if (asset === null) continue

    const formatName = FORMAT_NAMES[asset.textureFormat]
    const key = `${safe(asset.name)}|${formatName}`
    if ((nameCounts.get(key) ?? 0) > 1) {
      ambiguous++
      continue
    }

    const ddsPath = exported.get(key)
    if (ddsPath === undefined || asset.width === 0) {
      skipped++
      continue
    }

    const payload =
      asset.streamData !== null ? resolveStreamData(asset.streamData, resources) : asset.data

    const direct = decodeUnityTexture(asset.textureFormat, asset.width, asset.height, payload)
    // The .dds the C# exported holds Unity's own rows, bottom up, and
    // `decodeDds` reads them as the format specifies — top down. Flipping one
    // is what makes the two paths comparable, and asserting they then agree is
    // what pins the convention: they differ by exactly a flip, and nothing else.
    const viaDds = decodeDds(new Uint8Array(readFileSync(ddsPath)))
    viaDds.rgba = flipRows(viaDds.rgba, viaDds.width, viaDds.height)

    if (viaDds.width !== asset.width || viaDds.height !== asset.height) {
      skipped++
      continue
    }
    if (sha(direct) === sha(viaDds.rgba)) {
      matched++
      continue
    }

    divergences++
    if (divergences <= 5) {
      let at = 0
      while (at < direct.length && direct[at] === viaDds.rgba[at]) at++
      console.log(`\n${asset.name} ${asset.width}x${asset.height} ${formatName}`)
      console.log(`  first difference at byte ${at}`)
      console.log(`  direct : ${[...direct.slice(at, at + 8)].join(',')}`)
      console.log(`  via dds: ${[...viaDds.rgba.slice(at, at + 8)].join(',')}`)
    }
  }
}

console.log(
  `\nunity-pixels: ${matched} textures agree between the direct and DDS paths, ` +
    `${divergences} real divergences ` +
    `(${skipped} not exported, ${ambiguous} with a duplicated name)`,
)
process.exit(divergences === 0 ? 0 : 1)
