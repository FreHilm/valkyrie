/**
 * Differential runner for `Quest.FindLocalisedMultimediaFile`.
 *
 *   node compare.mjs [fuzzCount] [seed]
 */
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { curated, fuzz } from './corpus.mjs'
import { runTs } from './run-ts.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const fuzzCount = Number(process.argv[2] ?? 2000)
const seed = Number(process.argv[3] ?? 1)

const cases = [...curated(), ...fuzz(fuzzCount, seed)]

execFileSync('node', [join(here, 'extract.mjs')], { stdio: 'inherit' })
const raw = execFileSync(
  'dotnet',
  ['run', '--project', join(here, 'multimediaharness.csproj'), '-c', 'Release', '-v', 'quiet'],
  { input: JSON.stringify(cases), maxBuffer: 1 << 28, encoding: 'utf8' },
)

const cs = JSON.parse(raw.slice(raw.indexOf('[')))
const ts = await runTs(cases)

let divergences = 0
for (let i = 0; i < cases.length; i++) {
  const a = cs[i]
  const b = ts[i]
  if (a.value === b.value && a.error === b.error) continue
  divergences++
  if (divergences <= 20) {
    console.log(`\n${cases[i].label}`)
    console.log(`  files   : ${JSON.stringify(cases[i].files)}`)
    console.log(
      `  name    : ${cases[i].name}  lang=${cases[i].currentLang} fallback=${cases[i].fallbackLang} edit=${cases[i].editMode}`,
    )
    console.log(`  C#      : ${a.error ?? a.value}`)
    console.log(`  TS      : ${b.error ?? b.value}`)
  }
}

console.log(`\nmultimedia: ${cases.length} cases, ${divergences} real divergences`)
process.exit(divergences === 0 ? 0 : 1)
