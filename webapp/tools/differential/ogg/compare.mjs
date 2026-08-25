/**
 * Differential runner for the Ogg muxing and Vorbis header construction.
 *
 * Compiles the vendored `.NET Ogg Vorbis Encoder` unmodified and drives it
 * exactly as `FSBExport.WriteFile` does, then compares the resulting bytes
 * against the port's ~200-line replacement. Byte-for-byte or it fails.
 *
 *   node compare.mjs [fuzzCount] [seed]
 */
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Imported from source, not the package entry point: the built `dist/` can be
// stale, and a harness that validates yesterday's output is worse than none.
import {
  OggStream,
  buildCommentPacket,
  buildInfoPacket,
} from '../../../packages/platform/src/ogg.ts'

const here = dirname(fileURLToPath(import.meta.url))
const fuzzCount = Number(process.argv[2] ?? 300)
const seed = Number(process.argv[3] ?? 1)

const b64 = (bytes) => Buffer.from(bytes).toString('base64')

/**
 * Stands in for the fixed setup-header blob. Its contents do not affect the
 * muxing, only its length, so the corpus varies the length instead of carrying
 * the real 590-line tables.
 */
const setupHeader = (length) => {
  const bytes = new Uint8Array(length)
  for (let i = 0; i < length; i++) bytes[i] = (i * 31 + 7) & 0xff
  return bytes
}

/** A Vorbis audio packet. Bit 1 of the first byte selects the long block. */
const audioPacket = (length, longBlock) => {
  const bytes = new Uint8Array(Math.max(length, 1))
  bytes[0] = longBlock ? 0x02 : 0x00
  for (let i = 1; i < bytes.length; i++) bytes[i] = (i * 17 + 3) & 0xff
  return bytes
}

function curated() {
  const cases = []
  const add = (label, c) =>
    cases.push({
      label,
      channels: 2,
      frequency: 44100,
      loopStart: 0,
      loopEnd: 0,
      serial: 1,
      setupHeaderLength: 3000,
      ...c,
    })

  add('single short packet', { packetLengths: [[100, false]] })
  add('single long packet', { packetLengths: [[100, true]] })
  add('mono', { channels: 1, packetLengths: [[100, false]] })
  add('with loop points', { loopStart: 1000, loopEnd: 200000, packetLengths: [[50, false]] })

  for (const rate of [4000, 8000, 11000, 22050, 24000, 32000, 44100, 48000, 96000]) {
    add(`rate ${rate}`, { frequency: rate, packetLengths: [[64, false]] })
  }

  // Lacing boundaries: 255 needs a trailing zero segment, 254 and 256 do not.
  for (const size of [1, 2, 254, 255, 256, 509, 510, 511, 765, 1000]) {
    add(`packet of ${size} bytes`, { packetLengths: [[size, false]] })
  }

  // Setup-header length drives how the first pages lace.
  for (const length of [1, 254, 255, 256, 3000, 5000, 65535]) {
    add(`setup header of ${length} bytes`, {
      setupHeaderLength: length,
      packetLengths: [[100, false]],
    })
  }

  // Granule positions come from alternating block sizes.
  add('alternating block sizes', {
    packetLengths: [
      [64, false],
      [64, true],
      [64, false],
      [64, true],
      [64, false],
    ],
  })
  add('all long blocks', { packetLengths: Array.from({ length: 8 }, () => [128, true]) })

  // The 4-packet / 4096-byte page heuristic.
  add('many small packets', { packetLengths: Array.from({ length: 40 }, () => [16, false]) })
  add('large packets', { packetLengths: Array.from({ length: 6 }, () => [2000, true]) })

  add('serial number varies', { serial: 0x7fffffff, packetLengths: [[100, false]] })
  add('negative-looking serial', { serial: -2, packetLengths: [[100, false]] })

  return cases
}

function fuzz(count, seedValue) {
  let state = seedValue >>> 0
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
  const pick = (list) => list[Math.floor(next() * list.length)]

  const cases = []
  for (let i = 0; i < count; i++) {
    const packetCount = 1 + Math.floor(next() * 12)
    const packetLengths = []
    for (let p = 0; p < packetCount; p++) {
      packetLengths.push([1 + Math.floor(next() * 900), next() < 0.5])
    }
    cases.push({
      label: `fuzz ${i}`,
      channels: pick([1, 2]),
      frequency: pick([8000, 22050, 44100, 48000]),
      loopStart: next() < 0.3 ? Math.floor(next() * 100000) : 0,
      loopEnd: next() < 0.3 ? Math.floor(next() * 1000000) : 0,
      serial: Math.floor(next() * 0x7fffffff),
      setupHeaderLength: 1 + Math.floor(next() * 4000),
      packetLengths,
    })
  }
  return cases
}

const cases = [...curated(), ...fuzz(fuzzCount, seed)]

const payload = cases.map((c) => ({
  label: c.label,
  channels: c.channels,
  frequency: c.frequency,
  loopStart: c.loopStart,
  loopEnd: c.loopEnd,
  serial: c.serial,
  setupHeader: b64(setupHeader(c.setupHeaderLength)),
  packets: c.packetLengths.map(([length, long]) => b64(audioPacket(length, long))),
}))

const raw = execFileSync(
  'dotnet',
  ['run', '--project', join(here, 'oggharness.csproj'), '-c', 'Release', '-v', 'quiet'],
  { input: JSON.stringify(payload), maxBuffer: 1 << 28, encoding: 'utf8' },
)
const cs = JSON.parse(raw.slice(raw.indexOf('[')))

/** The port's equivalent of FSBExport.WriteFile. */
function runTs(c) {
  const stream = new OggStream(c.serial)
  const comments = []
  if (c.loopStart > 0 && c.loopEnd > 0) {
    comments.push(`LOOP_START=${c.loopStart}`, `LOOP_END=${c.loopEnd}`)
  }

  stream.packetIn({
    data: buildInfoPacket({ channels: c.channels, sampleRate: c.frequency }),
    granulePosition: 0,
  })
  stream.packetIn({ data: buildCommentPacket(comments), granulePosition: 0 })
  stream.packetIn({ data: setupHeader(c.setupHeaderLength), granulePosition: 0 })

  const out = []
  let granulePos = 0
  let prevSamples = 0

  c.packetLengths.forEach(([length, long], i) => {
    const data = audioPacket(length, long)
    const noSamples = (data[0] & 2) !== 0 ? 2048 : 256
    if (prevSamples !== 0) granulePos += Math.trunc((prevSamples + noSamples) / 4)
    prevSamples = noSamples

    stream.packetIn({
      data,
      granulePosition: granulePos,
      endOfStream: i === c.packetLengths.length - 1,
    })

    const page = stream.pageOut(true)
    if (page !== null) out.push(page.header, page.body)
  })

  const total = out.reduce((sum, block) => sum + block.length, 0)
  const joined = new Uint8Array(total)
  let at = 0
  for (const block of out) {
    joined.set(block, at)
    at += block.length
  }
  return b64(joined)
}

let divergences = 0
for (let i = 0; i < cases.length; i++) {
  const expected = cs[i]
  if (expected.error !== null && expected.error !== undefined) {
    console.log(`### ${cases[i].label}: C# threw ${expected.error}`)
    continue
  }

  const actual = runTs(cases[i])
  if (actual === expected.bytes) continue

  divergences++
  if (divergences <= 5) {
    const a = Buffer.from(expected.bytes, 'base64')
    const b = Buffer.from(actual, 'base64')
    let at = 0
    while (at < a.length && at < b.length && a[at] === b[at]) at++
    console.log(`\n${cases[i].label}`)
    console.log(`  lengths: C# ${a.length}, TS ${b.length}; first difference at byte ${at}`)
    console.log(`  C# : ${a.subarray(Math.max(0, at - 4), at + 12).toString('hex')}`)
    console.log(`  TS : ${b.subarray(Math.max(0, at - 4), at + 12).toString('hex')}`)
  }
}

console.log(`\nogg: ${cases.length} cases, ${divergences} real divergences`)
process.exit(divergences === 0 ? 0 : 1)
