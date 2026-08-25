/**
 * Builds a differential corpus from every Localization file the app ships.
 *
 * Mirrors `DictionaryI18n.AddDataFromFile`: split on \r when present, else \n.
 */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const repo = process.argv[2]
const out = process.argv[3]

const files = execSync(`find "${repo}/unity/Assets/StreamingAssets" -name "Localization*.txt"`, {
  encoding: 'utf8',
})
  .trim()
  .split('\n')
  .filter(Boolean)

const splitFile = (text) => (text.includes('\r') ? text.split('\r') : text.split('\n'))

const cases = []
let totalKeys = 0

for (const file of files) {
  const text = readFileSync(file, 'utf8')
  const lines = splitFile(text)
  const short = file.slice(repo.length + 1)

  // Round-trip the whole file through addData + serializeMultiple.
  cases.push({ name: `${short}#raw`, kind: 'addData', blocks: [lines] })

  // Resolve every key the file declares.
  const keys = []
  for (let i = 1; i < lines.length; i++) {
    const at = lines[i].indexOf(',')
    if (at > 0) keys.push(lines[i].slice(0, at))
  }
  const unique = [...new Set(keys)]
  totalKeys += unique.length
  cases.push({ name: `${short}#keys`, kind: 'getValueMany', blocks: [lines], keys: unique })
}

// Cross-language resolution: load every language of the base UI text into one
// dictionary and resolve each key under several language configurations.
const uiFiles = files.filter((f) => f.includes('/StreamingAssets/text/'))
const uiBlocks = uiFiles.map((f) => splitFile(readFileSync(f, 'utf8')))
const englishFile = uiFiles.find((f) => f.endsWith('Localization.English.txt'))
const englishKeys = [
  ...new Set(
    splitFile(readFileSync(englishFile, 'utf8'))
      .slice(1)
      .map((l) => (l.indexOf(',') > 0 ? l.slice(0, l.indexOf(',')) : null))
      .filter(Boolean),
  ),
]

const CONFIGS = [
  { currentLanguage: 'German' },
  { currentLanguage: 'Italian', fallbackLanguage: 'German' },
  { currentLanguage: 'Klingon', fallbackLanguage: 'French' },
  { currentLanguage: 'Japanese' },
]

for (const [n, config] of CONFIGS.entries()) {
  cases.push({
    name: `multi-${n}`,
    kind: 'getValueMany',
    blocks: uiBlocks,
    keys: englishKeys,
    ...config,
  })
}

writeFileSync(out, JSON.stringify(cases))
console.log(
  `${files.length} files, ${totalKeys} keys, ${CONFIGS.length} language configs -> ${cases.length} cases`,
)
