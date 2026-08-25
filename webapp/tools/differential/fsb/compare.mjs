/**
 * Differential check for the FSB5 → Ogg Vorbis conversion.
 *
 * Ground truth is the unmodified `FSBExport.cs` compiled against the vendored
 * .NET Ogg Vorbis Encoder, run over the same real FSB files. Byte-for-byte or
 * it fails.
 *
 * The inputs come from a licensed FFG install and live outside the repository,
 * so this is skipped when the cache is absent.
 *
 *   node tools/differential/fsb/compare.mjs
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { fsbToOgg, readFsb } from '../../../packages/platform/src/fsb.ts'

const cache = join(homedir(), '.cache', 'valkyrie-web-port', 'ffg')
const inDir = join(cache, 'MoM', 'audio')
const csDir = join(cache, 'MoM-ogg-cs')

if (!existsSync(inDir) || !existsSync(csDir)) {
  console.log('fsb: no exported audio or C# reference — skipped (needs a licensed FFG install)')
  process.exit(0)
}

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const files = readdirSync(inDir)
  .filter((f) => f.endsWith('.fsb'))
  .sort()

let matched = 0
let divergences = 0
let unsupported = 0

for (const file of files) {
  const bytes = new Uint8Array(readFileSync(join(inDir, file)))
  const reference = join(csDir, file.replace(/\.fsb$/, '.ogg'))
  if (!existsSync(reference)) continue

  const expected = new Uint8Array(readFileSync(reference))

  let actual
  try {
    actual = fsbToOgg(bytes)
  } catch (error) {
    divergences++
    console.log(`\n${file}\n  TS threw: ${error.message}`)
    continue
  }

  if (actual === null) {
    // The port refuses a stream whose setup header is not one of the three
    // known ones. The C# writes a file anyway, using whatever GetHeader
    // returned — which for an unknown CRC is null, so its output is broken.
    const crc = readFsb(bytes).samples[0]?.crc32
    unsupported++
    if (unsupported <= 3) {
      console.log(
        `\n${file}\n  unsupported setup header (crc ${crc}); C# wrote ${expected.length} bytes anyway`,
      )
    }
    continue
  }

  if (sha(actual) === sha(expected)) {
    matched++
    continue
  }

  divergences++
  if (divergences <= 5) {
    let at = 0
    while (at < actual.length && at < expected.length && actual[at] === expected[at]) at++
    console.log(`\n${file}`)
    console.log(
      `  lengths: C# ${expected.length}, TS ${actual.length}; first difference at byte ${at}`,
    )
    console.log(
      `  C# : ${Buffer.from(expected.subarray(Math.max(0, at - 4), at + 12)).toString('hex')}`,
    )
    console.log(
      `  TS : ${Buffer.from(actual.subarray(Math.max(0, at - 4), at + 12)).toString('hex')}`,
    )
  }
}

console.log(
  `\nfsb: ${matched} of ${files.length} streams byte-identical to FSBExport, ` +
    `${divergences} real divergences, ${unsupported} with an unsupported setup header`,
)
process.exit(divergences === 0 ? 0 : 1)
