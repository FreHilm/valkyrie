/**
 * Bundle size budget.
 *
 * The whole point of the web port is that a user opens a URL instead of
 * downloading an installer, and that only holds if the download stays small.
 * Size regressions arrive one dependency at a time and are invisible without a
 * number to fail against.
 *
 * Budgets live in `tools/size/budget.json`, committed so a change to one shows
 * up in review rather than sliding past.
 *
 *   node tools/size/check.mjs [--update]
 */
import { gzipSync } from 'node:zlib'
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '../..')
const budgetPath = join(here, 'budget.json')
const update = process.argv.includes('--update')

/** Every .js file under a built package, so a new module cannot hide. */
function walk(directory) {
  const found = []
  let entries
  try {
    entries = readdirSync(directory)
  } catch {
    return found
  }
  for (const entry of entries) {
    const full = join(directory, entry)
    if (statSync(full).isDirectory()) found.push(...walk(full))
    else if (entry.endsWith('.js')) found.push(full)
  }
  return found
}

const TARGETS = [
  { name: '@valkyrie/core', path: 'packages/core/dist' },
  { name: '@valkyrie/platform', path: 'packages/platform/dist' },
  { name: '@valkyrie/ui', path: 'packages/ui/dist' },
  { name: '@valkyrie/app', path: 'packages/app/dist' },
]

const measured = {}
for (const target of TARGETS) {
  const files = walk(join(root, target.path))
  if (files.length === 0) {
    console.error(`${target.name}: nothing built at ${target.path} — run npm run build first`)
    process.exit(1)
  }
  const raw = files.reduce((sum, file) => sum + statSync(file).size, 0)
  const gzip = files.reduce((sum, file) => sum + gzipSync(readFileSync(file)).length, 0)
  measured[target.name] = { raw, gzip, files: files.length }
}

if (update) {
  writeFileSync(budgetPath, `${JSON.stringify(measured, null, 2)}\n`)
  console.log(`budget updated:\n${JSON.stringify(measured, null, 2)}`)
  process.exit(0)
}

let budget
try {
  budget = JSON.parse(readFileSync(budgetPath, 'utf8'))
} catch {
  console.error(`no budget at ${relative(root, budgetPath)} — run with --update to create one`)
  process.exit(1)
}

/** How much a target may grow before the build fails. */
const TOLERANCE = 0.05

let failed = false
for (const [name, actual] of Object.entries(measured)) {
  const allowed = budget[name]
  if (allowed === undefined) {
    console.log(`${name}: new target, ${kb(actual.gzip)} gzipped — add it with --update`)
    failed = true
    continue
  }

  const limit = Math.ceil(allowed.gzip * (1 + TOLERANCE))
  const delta = actual.gzip - allowed.gzip
  const sign = delta >= 0 ? '+' : ''
  const status = actual.gzip > limit ? 'OVER' : 'ok  '
  console.log(
    `${status} ${name}: ${kb(actual.gzip)} gzipped ` +
      `(${sign}${kb(delta)} vs budget ${kb(allowed.gzip)}, limit ${kb(limit)}) ` +
      `across ${actual.files} files`,
  )
  if (actual.gzip > limit) failed = true
}

if (failed) {
  console.error(
    '\nBundle size exceeded its budget. If the growth is intended, run ' +
      '`node tools/size/check.mjs --update` and commit the new budget.',
  )
  process.exit(1)
}

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} kB`
}
