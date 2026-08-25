/**
 * Differential runner for `RemoteContentPack.cs`.
 *
 *   node compare.mjs [fuzzCount] [seed] [culture]
 */
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Source, not dist: a stale build would validate the wrong code.
import { RemoteContentPack } from '../../../packages/core/src/content/RemoteContentPack.ts'

import { curated, fuzz, realManifests } from './corpus.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const fuzzCount = Number(process.argv[2] ?? 2000)
const seed = Number(process.argv[3] ?? 1)
const culture = process.argv[4] ?? ''

const real = realManifests()
const cases = [...curated(), ...real, ...fuzz(fuzzCount, seed)]

const raw = execFileSync(
  'dotnet',
  [
    'run',
    '--project',
    join(here, 'remoteharness.csproj'),
    '-c',
    'Release',
    '-v',
    'quiet',
    '--',
    ...(culture.length > 0 ? [culture] : []),
  ],
  {
    input: JSON.stringify(cases),
    maxBuffer: 1 << 28,
    encoding: 'utf8',
    env: { ...process.env, TZ: 'UTC' },
  },
)

const cs = JSON.parse(raw.slice(raw.indexOf('[')))

const asObject = (map) => Object.fromEntries(map)

function runTs(entry) {
  const pack = new RemoteContentPack(entry.identifier, entry.fields)
  const languages = ['English', 'German', 'Spanish', 'French', 'Missing']
  const titles = {}
  const descriptions = {}
  for (const lang of languages) {
    titles[lang] = pack.getTitle(lang)
    descriptions[lang] = pack.getDescription(lang)
  }
  return {
    identifier: pack.identifier,
    valid: pack.valid,
    type: pack.type,
    image: pack.image,
    version: pack.version,
    package_url: pack.packageUrl,
    latest_update: pack.latestUpdate,
    names: asObject(pack.languagesName),
    descriptions_map: asObject(pack.languagesDescription),
    titles,
    descriptions,
  }
}

const FIELDS = [
  'identifier',
  'valid',
  'type',
  'image',
  'version',
  'package_url',
  'latest_update',
  'names',
  'descriptions_map',
  'titles',
  'descriptions',
]

/**
 * Values whose C# result depends on the machine's culture or timezone, so
 * there is no single behaviour to match. `culture-probe.mjs` measures the
 * spread: "07/03/2026" is July 3 on en-US and March 7 on de-DE.
 *
 * The port reads these as UTC or refuses them; see the deviations doc.
 */
const localeDependent = (entry) => {
  const value = entry.fields.latest_update
  if (value === undefined) return false
  const trimmed = value.trim()
  // A slash date is ambiguous; a zone-less one is read as local time.
  return trimmed.includes('/') || (trimmed.length > 0 && !/(Z|[+-]\d{2}:?\d{2})$/.test(trimmed))
}

let divergences = 0
let expected = 0
let locale = 0

for (let i = 0; i < cases.length; i++) {
  const a = cs[i]
  const b = runTs(cases[i])

  if (a.error !== null && a.error !== undefined) {
    expected++
    console.log(`### ${cases[i].label}: C# threw ${a.error}, TS succeeded`)
    continue
  }

  const differing = FIELDS.filter((field) => JSON.stringify(a[field]) !== JSON.stringify(b[field]))
  if (differing.length === 0) continue

  if (differing.length === 1 && differing[0] === 'latest_update' && localeDependent(cases[i])) {
    locale++
    if (locale <= 5) {
      console.log(
        `### ${cases[i].label}: locale-dependent, C# ${a.latest_update} vs TS ${b.latest_update}`,
      )
    }
    continue
  }

  divergences++
  if (divergences <= 15) {
    console.log(`\n${cases[i].label}`)
    console.log(`  fields: ${JSON.stringify(cases[i].fields)}`)
    for (const field of differing) {
      console.log(`  ${field}:`)
      console.log(`    C# : ${JSON.stringify(a[field])}`)
      console.log(`    TS : ${JSON.stringify(b[field])}`)
    }
  }
}

const label = culture.length > 0 ? ` [culture ${culture}]` : ''
console.log(
  `\nremote${label}: ${cases.length} cases (${real.length} real), ${divergences} real divergences, ${locale} locale-dependent, ${expected} C# throws`,
)
process.exit(divergences === 0 ? 0 : 1)
