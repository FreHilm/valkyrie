/**
 * Differential check for the Font reader and the `cmap` coverage test.
 *
 * These two are the parts of the import that are hardest to trust from unit
 * tests alone, because both work by looking at bytes rather than by walking a
 * layout. `readFont` searches an object for something that is a font; and
 * `coversCodepoints` decides, from a font's own character map, whether it
 * carries the game's icons. A synthetic fixture proves each handles the shape
 * the fixture was built with — which is the shape the author had in mind, and
 * so proves less than it looks.
 *
 * Ground truth here is a real Mansions install and a real font library:
 *
 *   - every `Font` object in the install is read, and the bytes are checked to
 *     be a font that actually parses, not merely one that starts like one;
 *   - the coverage answer is compared against what the faces really contain.
 *
 * The expected answers below come from `fontTools` run over the same six faces
 * — one covers `U+F200`–`F20F` and five do not, which is the whole basis for
 * importing one font out of six.
 *
 * The install is the user's own and never leaves their machine, so this is
 * skipped when it is absent.
 *
 *   node --experimental-strip-types tools/differential/fonts/compare.mjs [dataDir]
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  ClassID,
  readObject,
  readSerializedFile,
} from '../../../packages/platform/src/unityAssets.ts'
import { coversCodepoints } from '../../../packages/platform/src/sfnt.ts'

const DEFAULT_DATA = join(
  '/Applications/Mansions of Madness Second Edition.app/Wrapper',
  'MansionsofMadnessSecondEdition.app/Data',
)
const dataDir = process.argv[2] ?? DEFAULT_DATA

if (!existsSync(dataDir)) {
  console.log(`no install at ${dataDir} — skipping`)
  process.exit(0)
}

/**
 * What the faces in a Mansions install really carry, per fontTools.
 *
 * Only `MADGaramondPro` fills the private-use range in — it is the face
 * `MoMGameType.GetFont` hands to every piece of text in the Unity build.
 */
const EXPECTED = new Map([
  ['MADGaramondPro', true],
  ['MADGaramondPremier', false],
  ['OldNewspaperTypes', false],
  ['PspimpdeedII', false],
  ['LiberationSans', false],
  ['NotoSansCJKkr-Regular', false],
])

const ICONS = [0xf200, 0xf20f]

/** The sfnt signatures, so a "font" that is none of them is caught. */
const SIGNATURES = new Set([0x00010000, 0x4f54544f, 0x74727565, 0x74746366])

/**
 * Walks a font's own table directory.
 *
 * Independent of `looksLikeSfnt`, deliberately: checking the reader with the
 * reader's own rule would agree with itself no matter what either did.
 */
function parseTables(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const signature = view.getUint32(0, false)
  if (!SIGNATURES.has(signature)) return null
  if (signature === 0x74746366) return ['<collection>']

  const count = view.getUint16(4, false)
  const tags = []
  for (let i = 0; i < count; i++) {
    const record = 12 + i * 16
    if (record + 16 > data.length) return null
    const tag = new TextDecoder('latin1').decode(data.subarray(record, record + 4))
    const offset = view.getUint32(record + 8, false)
    const length = view.getUint32(record + 12, false)
    if (offset + length > data.length) return null
    tags.push(tag)
  }
  return tags
}

let found = 0
let failures = 0
const seen = new Set()

for (const name of readdirSync(dataDir).sort()) {
  if (!name.endsWith('.assets') && name !== 'globalgamemanagers') continue

  const bytes = new Uint8Array(readFileSync(join(dataDir, name)))
  let file
  try {
    file = readSerializedFile(bytes)
  } catch {
    continue
  }

  for (const info of file.objects) {
    if (info.classId !== ClassID.Font) continue
    found++

    const asset = readObject(bytes, info, file.version)
    if (asset === null) {
      console.log(`  FAIL ${name}:${info.pathId} — a Font the reader found nothing in`)
      failures++
      continue
    }

    // The bytes have to be a font by a rule the reader does not share.
    const tables = parseTables(asset.data)
    if (tables === null) {
      console.log(`  FAIL ${asset.name} — extracted bytes are not a readable sfnt`)
      failures++
      continue
    }

    const covers = coversCodepoints(asset.data, ICONS[0], ICONS[1])
    const expected = EXPECTED.get(asset.name)
    if (expected === undefined) {
      console.log(`  note ${asset.name} — not in the expected set; covers=${covers}`)
    } else if (covers !== expected) {
      console.log(`  FAIL ${asset.name} — covers=${covers}, fontTools says ${expected}`)
      failures++
    } else if (!seen.has(asset.name)) {
      console.log(
        `  ok   ${asset.name.padEnd(22)} ${String(asset.data.length).padStart(9)} bytes  ` +
          `icons=${covers}  tables=${tables.length}`,
      )
    }
    seen.add(asset.name)
  }
}

if (found === 0) {
  console.log(`no Font objects under ${dataDir} — nothing to compare`)
  process.exit(0)
}

const missing = [...EXPECTED.keys()].filter((name) => !seen.has(name))
for (const name of missing) {
  console.log(`  FAIL ${name} — expected in the install, never read`)
  failures++
}

console.log(`\n${found} Font objects, ${seen.size} distinct faces, ${failures} failures`)
process.exit(failures === 0 ? 0 : 1)
