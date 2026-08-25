/**
 * Round-trip check for the quest editor's writer.
 *
 * The acceptance criterion for T-019 is that a quest authored in the web
 * editor still loads in the Unity build. At the file level that means two
 * things, and this checks both over real published scenarios:
 *
 * 1. **Semantic round-trip** — parse, write, re-parse, and get the same
 *    sections and values back.
 * 2. **No spurious diff** — the line ending is preserved, so saving a quest
 *    does not rewrite every line of a file tracked in git.
 *
 * The quests are downloaded by `tools/differential/quest/fetch-real.mjs` and
 * live outside the repository, so this skips when they are absent.
 *
 *   node tools/differential/questwrite/compare.mjs [questDir]
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { readFromString } from '../../../packages/core/src/ini/IniRead.ts'
import { rewriteIni } from '../../../packages/core/src/ini/IniWriter.ts'

/**
 * Counts line endings directly, without using the module under test.
 *
 * Calling `detectNewline` on both sides would only prove the writer is
 * self-consistent: a detector that always answered LF would make a
 * normalising writer look correct. A mutation test showed exactly that, so
 * the reference measurement lives here instead.
 */
function endingOf(text) {
  let crlf = 0
  let lf = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '\n') continue
    if (i > 0 && text[i - 1] === '\r') crlf++
    else lf++
  }
  if (crlf === 0 && lf === 0) return 'none'
  return crlf > lf ? 'CRLF' : 'LF'
}

const questDir = process.argv[2] ?? join(homedir(), '.cache', 'valkyrie-web-port', 'quests')

if (!existsSync(questDir)) {
  console.log(`questwrite: no quests at ${questDir} — skipped (run quest/fetch-real.mjs)`)
  process.exit(0)
}

const files = []
const walk = (directory) => {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) walk(path)
    else if (name.endsWith('.ini')) files.push(path)
  }
}
walk(questDir)

let matched = 0
let divergences = 0
const endings = {}
const reasons = new Map()

for (const path of files) {
  const original = readFileSync(path, 'utf8')
  const name = path.slice(questDir.length + 1)

  const fail = (why, detail) => {
    divergences++
    reasons.set(why, (reasons.get(why) ?? 0) + 1)
    if (divergences <= 8) console.log(`\n${name}\n  ${why}: ${detail}`)
  }

  let parsed
  try {
    parsed = readFromString(original)
  } catch (error) {
    fail('parse', error.message)
    continue
  }

  const newline = endingOf(original)
  endings[newline] = (endings[newline] ?? 0) + 1

  const written = rewriteIni(original, parsed)

  // The line ending must survive, or every line shows as changed in a diff.
  const writtenEnding = endingOf(written)
  if (newline !== 'none' && writtenEnding !== newline) {
    fail('line ending', `was ${newline}, became ${writtenEnding}`)
    continue
  }

  let reparsed
  try {
    reparsed = readFromString(written)
  } catch (error) {
    fail('reparse', error.message)
    continue
  }

  const before = [...parsed.data].map(([name, entries]) => [name, [...entries]])
  const reparsedSections = [...reparsed.data].map(([name, entries]) => [name, [...entries]])
  if (JSON.stringify(before) !== JSON.stringify(reparsedSections)) {
    const lost = before
      .filter(([name]) => !reparsedSections.some(([other]) => other === name))
      .map(([name]) => name)
    fail(
      'round trip',
      lost.length > 0
        ? `sections lost: ${lost.slice(0, 3).join(', ')}`
        : `${before.length} sections in, ${reparsedSections.length} out, values differ`,
    )
    continue
  }

  matched++
}

console.log(
  `\nquestwrite: ${matched} of ${files.length} real quest files round-trip, ${divergences} real divergences`,
)
console.log(
  `  line endings seen: ${Object.entries(endings)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ')}`,
)
if (reasons.size > 0) {
  console.log(`  failures: ${[...reasons].map(([r, n]) => `${r} ${n}`).join(', ')}`)
}
process.exit(divergences === 0 ? 0 : 1)
