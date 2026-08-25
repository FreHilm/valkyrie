/**
 * Conformance ledger for T-010.
 *
 * Accounts for every `[Test]` / `[TestCase]` in the Unity suite: what happened
 * to it in the port, and — where the claim is "migrated" — *verifies* it by
 * matching the C# test name against a TypeScript test of the same name rather
 * than taking the claim on faith.
 *
 * Statuses describe the disposition of a file:
 *   ported    — the subsystem is ported; its cases are covered by the
 *               TypeScript suite and, more strongly, by the differential
 *               harness that compares the two implementations directly
 *   deferred  — needs a subsystem that is not ported yet
 *   dismissed — tests something the port does not have, with a reason
 *
 * The `name-matched` column is evidence, not a gate: it counts how many C#
 * case names have a TypeScript test of the same name. A low number does not
 * mean a gap — several suites were migrated as behaviour groups rather than
 * one-for-one, because the differential harness already compares every field
 * of every component across thousands of real inputs. It is reported so the
 * difference between "same names" and "same behaviour" stays visible.
 *
 * Worth knowing when reading the totals: a meaningful share of the C# suite
 * re-implements the algorithm inline and asserts against its own copy, so it
 * would pass even if the production code were broken. Those files are flagged
 * `simulated` and were re-pointed at the real implementation on migration.
 *
 *   node ledger.mjs <repo-root> [--json] [--unmatched]
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const repo = process.argv[2] ?? process.cwd()
const asJson = process.argv.includes('--json')
const showUnmatched = process.argv.includes('--unmatched')

const CS_DIR = join(repo, 'unity/Assets/UnitTests/Editor')
const TS_DIRS = [
  join(repo, 'webapp/packages/core/test'),
  join(repo, 'webapp/packages/platform/test'),
]

const DISPOSITION = {
  IniReadTests: { status: 'ported', task: 'T-005' },
  ConfigFileTests: {
    status: 'ported',
    task: 'T-005',
    simulated: true,
    note: 'Asserts on IniData patterns rather than the ConfigFile class; re-pointed at the real class.',
  },
  DictionaryI18nTests: {
    status: 'ported',
    task: 'T-006',
    simulated: true,
    note: '70 of 72 re-implement the algorithm inline; re-pointed at the real class.',
  },
  LocalizationReadTests: {
    status: 'ported',
    task: 'T-006',
    simulated: true,
    note: 'The BbCode and DictQuery cases inline their own copy; re-pointed.',
  },
  StringKeyTests: { status: 'ported', task: 'T-006' },
  ContentTypesTests: {
    status: 'ported',
    task: 'T-007',
    note: 'A good suite — 90 of 114 construct the real types.',
  },
  ContentDataTests: { status: 'ported', task: 'T-007' },
  VarManagerTests: { status: 'ported', task: 'T-009' },
  VarTestsTests: { status: 'ported', task: 'T-008/T-009' },
  PuzzleTests: { status: 'ported', task: 'T-009' },
  PuzzleCodeTests: { status: 'ported', task: 'T-009' },
  UtilityTests: { status: 'ported', task: 'T-010' },
  VersionManagerTests: { status: 'ported', task: 'T-010' },
  SetVersionTests: { status: 'ported', task: 'T-010' },

  QuestComponentTests: {
    status: 'ported',
    task: 'T-008',
    note: 'Every behaviour is asserted by quest.test.ts, and equivalence is established more strongly by the differential harness over 2,744 real scenario sections. Not migrated name-for-name: the 179 cases are "parse this dict, assert this field", which the harness already compares field-by-field across every component type.',
  },

  EventManagerTests: {
    status: 'deferred',
    task: 'T-018',
    note: 'Drives the running game: event queue, hero selection, monster placement. Needs Quest.cs runtime state.',
  },
  SaveLoadTests: {
    status: 'ported',
    task: 'T-015',
    note: 'Version gating, save paths and LogEntry. The version-comparison cases were migrated with VersionManager in T-010.',
  },
  QuestLogTests: {
    status: 'ported',
    task: 'T-015',
    note: 'QuestLog and Quest.LogEntry. The C# cases assert \\r\\n literally, so they only pass on Windows; the port writes \\n everywhere.',
  },
  GameTypeTests: {
    status: 'deferred',
    task: 'T-016',
    note: 'Fonts, UI scale and hero counts. Much of it is Unity Font/Sprite; the rest lands with the UI foundation.',
  },
  ZipSlipTests: {
    status: 'ported',
    task: 'T-012',
    note: 'Archive extraction, and extended there to cover the selective-extraction modes the C# leaves unguarded.',
  },
  RemoteContentPackTests: {
    status: 'ported',
    task: 'T-013',
    note: 'Manifest entries, checked differentially against the unmodified C# over both real manifests.',
  },
  FindLocalisedMultimediaFileTests: {
    status: 'ported',
    task: 'T-012',
    note: 'Resolves a localised audio/image file on disk. Ported once the virtual filesystem existed; the differential harness extracts the method from Quest.cs rather than copying it.',
  },
  AdditionalCoverageTests: {
    status: 'deferred',
    task: 'various',
    note: 'A grab-bag added for coverage, spanning save/load, the quest log and game types. Follows those subsystems.',
  },

  DummyTest: {
    status: 'dismissed',
    note: 'Asserts true == true, to keep the Unity test runner happy.',
  },
}

/** Every C# test method, with how many [Test]/[TestCase] attributes it carries. */
function csTests() {
  const result = []
  for (const file of readdirSync(CS_DIR).filter((f) => f.endsWith('.cs'))) {
    const name = file.replace(/\.cs$/, '')
    let pending = 0
    for (const line of readFileSync(join(CS_DIR, file), 'utf8').split('\n')) {
      if (/\[(Test|TestCase)\b/.test(line)) pending++
      const method = /public void (\w+)\s*\(/.exec(line)
      if (method && pending > 0) {
        result.push({ file: name, test: method[1], cases: pending })
        pending = 0
      }
    }
  }
  return result
}

/** Every TypeScript test title. */
function tsTestTitles() {
  const titles = new Set()
  for (const dir of TS_DIRS) {
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.test.ts'))) {
      const text = readFileSync(join(dir, file), 'utf8')
      for (const match of text.matchAll(/\bit\(\s*(['"`])([^'"`]+)\1/g)) {
        titles.add(match[2])
      }
    }
  }
  return titles
}

const tests = csTests()
const titles = tsTestTitles()

/** A C# case counts as migrated when a TS test carries its name. */
const matched = (test) => [...titles].some((t) => t === test || t.startsWith(`${test} `))

const byFile = new Map()
for (const t of tests) {
  if (!byFile.has(t.file)) byFile.set(t.file, { tests: 0, cases: 0, matched: 0, unmatched: [] })
  const entry = byFile.get(t.file)
  entry.tests++
  entry.cases += t.cases
  if (matched(t.test)) entry.matched += t.cases
  else entry.unmatched.push(t.test)
}

const rows = [...byFile.entries()]
  .map(([file, counts]) => ({
    file,
    ...counts,
    ...(DISPOSITION[file] ?? { status: 'UNCLASSIFIED' }),
  }))
  .sort((a, b) => b.cases - a.cases)

const totals = rows.reduce(
  (acc, r) => {
    acc.cases += r.cases
    acc[r.status] = (acc[r.status] ?? 0) + r.cases
    if (r.simulated) acc.simulated += r.cases
    return acc
  },
  { cases: 0, simulated: 0 },
)

if (asJson) {
  console.log(JSON.stringify({ rows, totals, tsTests: titles.size }, null, 2))
  process.exit(0)
}

console.log('| C# file | cases | status | task | name-matched | note |')
console.log('| --- | ---: | --- | --- | ---: | --- |')
for (const r of rows) {
  const verified = r.status === 'ported' ? `${r.matched}/${r.cases}` : '—'
  console.log(
    `| ${r.file} | ${r.cases} | ${r.status}${r.simulated ? ' (simulated)' : ''} | ${r.task ?? '—'} | ${verified} | ${r.note ?? ''} |`,
  )
}

console.log()
console.log(`total C# cases: ${totals.cases}`)
for (const [status, count] of Object.entries(totals)) {
  if (status === 'cases') continue
  console.log(`  ${status}: ${count}`)
}
console.log(`TypeScript tests: ${titles.size}`)

if (showUnmatched) {
  console.log('\nPorted files with case names that have no TypeScript twin:')
  for (const r of rows.filter((x) => x.status === 'ported' && x.unmatched.length > 0)) {
    console.log(`  ${r.file}: ${r.unmatched.join(', ')}`)
  }
}

const unclassified = rows.filter((r) => r.status === 'UNCLASSIFIED')
if (unclassified.length > 0) {
  console.log(`\nUNCLASSIFIED (add to DISPOSITION): ${unclassified.map((r) => r.file).join(', ')}`)
  process.exitCode = 1
}
