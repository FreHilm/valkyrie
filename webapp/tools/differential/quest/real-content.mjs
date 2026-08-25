/**
 * Builds a differential corpus from real published scenarios.
 *
 * No quest content ships with the repository — scenarios are downloaded at
 * runtime from `valkyrie-store` and `valkyrie-questdata`. `fetch-real.mjs`
 * pulls a sample into a local directory; this turns whatever is there into
 * corpus cases. If the directory is absent the corpus is simply empty, so the
 * harness still runs offline.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
const out = process.argv[3]

const cases = []
let sections = 0

if (existsSync(dir)) {
  // Manifests are one [scenario] section per published quest — exactly the
  // metadata format Quest.Populate consumes.
  for (const file of readdirSync(dir).filter((f) => f.endsWith('-manifest.ini'))) {
    const text = readFileSync(join(dir, file), 'utf8')
    const isMoM = file.startsWith('mom')
    for (const [identifier, fields] of parseIni(text)) {
      cases.push({
        name: `manifest:${file}:${identifier}`,
        kind: 'quest',
        identifier,
        fields,
        isMoM,
        gameType: isMoM ? 'MoM' : 'D2E',
        maxHeroes: isMoM ? 5 : 4,
        defaultHeroes: isMoM ? 5 : 4,
      })
      sections++
    }
  }

  // Extracted .valkyrie packages: the real component content.
  const packages = join(dir, 'extracted')
  if (existsSync(packages)) {
    for (const pkg of readdirSync(packages)) {
      const isMoM = pkg.startsWith('MoM')
      for (const file of readdirSync(join(packages, pkg)).filter((f) => f.endsWith('.ini'))) {
        const lines = readFileSync(join(packages, pkg, file), 'utf8').split(/\r\n|\r|\n/)
        cases.push({
          name: `pkg:${pkg}/${file}`,
          kind: 'loadIni',
          lines,
          source: file,
          format: 21,
          gameType: isMoM ? 'MoM' : 'D2E',
          maxHeroes: isMoM ? 5 : 4,
          defaultHeroes: isMoM ? 5 : 4,
        })
        sections += lines.filter((l) => l.startsWith('[')).length
      }
    }
  }
}

/** Minimal ini split, only good enough to slice the manifest into sections. */
function parseIni(text) {
  const result = []
  let current = null
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.trim()
    if (line.length === 0 || line.startsWith('#') || line.startsWith(';')) continue
    if (line.startsWith('[')) {
      current = [line.replace(/^\[|\]$/g, ''), {}]
      result.push(current)
      continue
    }
    if (current === null) continue
    const at = line.indexOf('=')
    if (at === -1) current[1][line] = ''
    else current[1][line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  return result
}

writeFileSync(out, JSON.stringify(cases))
console.log(`real quest cases: ${cases.length} (~${sections} sections)`)
