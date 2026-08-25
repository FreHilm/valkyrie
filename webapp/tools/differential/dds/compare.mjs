/**
 * Differential check for the DDS/DXT decoder.
 *
 * Ground truth is Pillow, an independent implementation, decoding the same
 * files. The inputs are real textures exported from a licensed FFG install by
 * `tools/ffg/probe`; they live outside the repository and are never committed,
 * so this run is skipped when the cache is absent.
 *
 * Whole images are compared by SHA-256 — 470 textures of pixel data will not
 * fit through a pipe as JSON — and any mismatch is then re-run pixel by pixel
 * so the failure is diagnosable.
 *
 *   node tools/differential/dds/compare.mjs [cacheDir]
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { decodeDds } from '../../../packages/platform/src/dds.ts'

const cache = process.argv[2] ?? join(homedir(), '.cache', 'valkyrie-web-port', 'ffg', 'MoM', 'img')

if (!existsSync(cache)) {
  console.log(`dds: no exported textures at ${cache} — skipped (needs a licensed FFG install)`)
  process.exit(0)
}

const files = readdirSync(cache)
  .filter((f) => f.endsWith('.dds'))
  .sort()
console.log(`dds: comparing ${files.length} real textures against Pillow`)

const HASH_SCRIPT = join(tmpdir(), 'valk-dds-hash.py')
writeFileSync(
  HASH_SCRIPT,
  `
import sys, json, hashlib
from PIL import Image
out = {}
for path in json.load(sys.stdin):
    try:
        im = Image.open(path); im.load()
        im = im.convert('RGBA')
        raw = im.tobytes()
        out[path] = {'w': im.size[0], 'h': im.size[1],
                     'sha': hashlib.sha256(raw).hexdigest()}
    except Exception as e:
        # Pillow refuses a header-only DDS; recorded so the port must agree
        # there is nothing in it rather than inventing pixels.
        out[path] = {'unreadable': type(e).__name__}
sys.stdout.write(json.dumps(out))
`,
)

const PIXEL_SCRIPT = join(tmpdir(), 'valk-dds-pixels.py')
writeFileSync(
  PIXEL_SCRIPT,
  `
import sys, json
from PIL import Image
im = Image.open(sys.argv[1]); im.load()
sys.stdout.write(json.dumps(list(im.convert('RGBA').tobytes())))
`,
)

const paths = files.map((f) => join(cache, f))
const truth = JSON.parse(
  execFileSync('python3', [HASH_SCRIPT], {
    input: JSON.stringify(paths),
    maxBuffer: 1 << 28,
    encoding: 'utf8',
  }),
)

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')

/** Re-reads one file through Pillow and reports the first differing pixel. */
function explain(path, actual) {
  const expected = JSON.parse(
    execFileSync('python3', [PIXEL_SCRIPT, path], { maxBuffer: 1 << 28, encoding: 'utf8' }),
  )
  let mismatched = 0
  let firstAt = -1
  let worst = 0
  for (let i = 0; i < expected.length; i++) {
    const delta = Math.abs((actual.rgba[i] ?? 0) - expected[i])
    if (delta === 0) continue
    mismatched++
    worst = Math.max(worst, delta)
    if (firstAt === -1) firstAt = i
  }
  const pixel = Math.floor(firstAt / 4)
  console.log(`  ${mismatched} of ${expected.length} bytes differ, worst delta ${worst}`)
  console.log(
    `  first at pixel ${pixel} (x=${pixel % actual.width}, y=${Math.floor(pixel / actual.width)}) channel ${firstAt % 4}`,
  )
  console.log(`  Pillow: ${expected.slice(firstAt, firstAt + 8).join(',')}`)
  console.log(`  TS    : ${[...actual.rgba.slice(firstAt, firstAt + 8)].join(',')}`)
}

let divergences = 0
let compared = 0
let empty = 0
const byFormat = new Map()

for (const path of paths) {
  const expected = truth[path]
  if (expected === undefined) continue
  const name = path.split('/').pop()
  const format = name.replace(/^.*\.([A-Za-z0-9]+)\.dds$/, '$1')

  let actual
  try {
    actual = decodeDds(new Uint8Array(readFileSync(path)))
  } catch (error) {
    divergences++
    console.log(`\n${name}\n  TS threw: ${error.message}`)
    continue
  }

  if (expected.unreadable !== undefined) {
    if (actual.rgba.length === 0) {
      empty++
      continue
    }

    // Pillow has no support for DDPF_ALPHA (8bpp, alpha mask only), which is
    // what the TextMeshPro SDF atlases use. For that format the file's own
    // payload is a stronger reference than Pillow anyway: it is exactly one
    // alpha byte per pixel, in order, so it can be checked directly.
    if (format === 'Alpha8') {
      const raw = new Uint8Array(readFileSync(path)).subarray(128)
      const pixels = actual.width * actual.height
      let bad = -1
      if (raw.length !== pixels || actual.rgba.length !== pixels * 4) {
        bad = 0
      } else {
        for (let i = 0; i < pixels; i++) {
          if (
            actual.rgba[i * 4] !== 0 ||
            actual.rgba[i * 4 + 1] !== 0 ||
            actual.rgba[i * 4 + 2] !== 0 ||
            actual.rgba[i * 4 + 3] !== raw[i]
          ) {
            bad = i
            break
          }
        }
      }

      if (bad === -1) {
        compared++
        byFormat.set(format, (byFormat.get(format) ?? 0) + 1)
        continue
      }
      divergences++
      console.log(`\n${name}\n  Alpha8 mismatch at pixel ${bad}`)
      continue
    }

    divergences++
    console.log(`\n${name}\n  Pillow: unreadable; TS produced ${actual.rgba.length} bytes`)
    continue
  }

  if (actual.width !== expected.w || actual.height !== expected.h) {
    divergences++
    console.log(
      `\n${name}\n  size: Pillow ${expected.w}x${expected.h}, TS ${actual.width}x${actual.height}`,
    )
    continue
  }

  if (sha(actual.rgba) !== expected.sha) {
    divergences++
    console.log(`\n${name}  ${actual.width}x${actual.height} ${actual.fourCC || format}`)
    if (divergences <= 5) explain(path, actual)
    continue
  }

  compared++
  byFormat.set(format, (byFormat.get(format) ?? 0) + 1)
}

console.log(
  `\ndds: ${compared} textures pixel-exact, ${empty} empty, ${divergences} real divergences`,
)
console.log(`  by format: ${[...byFormat].map(([f, n]) => `${f} ${n}`).join(', ')}`)
process.exit(divergences === 0 ? 0 : 1)
