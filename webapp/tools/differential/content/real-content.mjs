/**
 * Builds a differential corpus from every content pack the app ships.
 *
 * Each pack is loaded the way ContentLoader does it: every ini it declares,
 * section by section, into one registry. That exercises priority resolution
 * and set merging against real data rather than synthetic cases.
 */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const repo = process.argv[2]
const out = process.argv[3]

const packIniPaths = execSync(
  `find "${repo}/unity/Assets/StreamingAssets/content" -name content_pack.ini`,
  { encoding: 'utf8' },
)
  .trim()
  .split('\n')
  .filter(Boolean)

const splitLines = (text) => text.split(/\r\n|\r|\n/)

const cases = []
let sectionCount = 0

for (const packIni of packIniPaths) {
  const packDir = dirname(packIni)
  const short = packDir.slice(repo.length + 1)

  // Which inis does the pack declare? Mirror ContentPack.iniFiles.
  const packLines = splitLines(readFileSync(packIni, 'utf8'))
  const declared = ['content_pack.ini']
  let section = ''
  for (const raw of packLines) {
    const line = raw.trim()
    if (line.startsWith('[')) {
      section = line.replace(/^\[|\]$/g, '')
      continue
    }
    if (section !== 'ContentPackData' || line.length === 0 || line.startsWith('#')) continue
    const key = line.includes('=') ? line.slice(0, line.indexOf('=')).trim() : line
    if (key.length > 0) declared.push(key)
  }

  const files = []
  for (const name of declared) {
    let text
    try {
      text = readFileSync(`${packDir}/${name}`, 'utf8')
    } catch {
      continue // declared but absent; the C# tolerates it
    }
    const lines = splitLines(text)
    sectionCount += lines.filter((l) => l.trimStart().startsWith('[')).length
    files.push({ path: packDir, packId: short, lines })
  }

  if (files.length > 0) {
    cases.push({ name: `${short}#load`, kind: 'loadIni', files })
  }

  // And the pack metadata itself.
  cases.push({ name: `${short}#pack`, kind: 'pack', ini: packLines, path: packDir })
}

writeFileSync(out, JSON.stringify(cases))
console.log(`${packIniPaths.length} packs, ~${sectionCount} sections -> ${cases.length} cases`)
