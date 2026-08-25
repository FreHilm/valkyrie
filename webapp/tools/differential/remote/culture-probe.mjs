/**
 * Shows what `DateTime.TryParse` makes of the same manifest value under
 * different machine cultures and timezones. This is a measurement, not a
 * claim: the C# has no single answer to match.
 */
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const VALUES = ['07/03/2026', '2026-03-07T05:32:25Z', '2026-03-07', '2026-03-07T05:32:25']
const cases = VALUES.map((v) => ({ label: v, identifier: 'p', fields: { latest_update: v } }))

const run = (culture, tz) => {
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
      culture,
    ],
    { input: JSON.stringify(cases), encoding: 'utf8', env: { ...process.env, TZ: tz } },
  )
  return JSON.parse(raw.slice(raw.indexOf('[')))
}

const SETUPS = [
  ['en-US', 'UTC'],
  ['de-DE', 'UTC'],
  ['sv-SE', 'UTC'],
  ['en-US', 'America/New_York'],
  ['de-DE', 'Europe/Berlin'],
]

const rows = SETUPS.map(([culture, tz]) => [culture, tz, run(culture, tz)])

for (const [i, value] of VALUES.entries()) {
  console.log(`\n${JSON.stringify(value)}`)
  for (const [culture, tz, results] of rows) {
    console.log(
      `  ${culture.padEnd(6)} ${tz.padEnd(18)} -> ${results[i].latest_update}  (${results[i].latest_update_kind})`,
    )
  }
}
