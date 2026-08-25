/** Summarises the quest differential: identical count and divergence classes. */
import { readFileSync } from 'node:fs'

const cs = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const ts = JSON.parse(readFileSync(process.argv[3], 'utf8'))

const j = (v) => JSON.stringify(v)
const FIELDS = ['ok', 'error', 'data']

let same = 0
const diffs = []

for (let i = 0; i < cs.length; i++) {
  const a = cs[i]
  const b = ts[i]
  const bad = FIELDS.filter((f) => j(a[f] ?? null) !== j(b[f] ?? null))
  if (bad.length === 0) {
    same++
    continue
  }

  // Application.Quit surfaces as HarnessQuitException; the port throws
  // instead, which is a documented deviation rather than a divergence.
  const cls =
    a.error === 'HarnessQuitException'
      ? 'C# called Application.Quit, TS threw'
      : a.ok === false && b.ok === false
        ? `both threw (C# ${a.error}, TS ${b.error})`
        : a.ok === false && b.ok === true
          ? `C# threw ${a.error}`
          : a.ok === true && b.ok === false
            ? `TS threw ${b.error}  <-- BUG`
            : 'both ok, disagree  <-- BUG'

  diffs.push({ name: a.name, cls, bad, a, b })
}

console.log(`identical: ${same}/${cs.length}`)
const byClass = {}
for (const d of diffs) byClass[d.cls] = (byClass[d.cls] ?? 0) + 1
for (const [k, v] of Object.entries(byClass)) console.log(`  ${String(v).padStart(4)}  ${k}`)
console.log(`real divergences: ${diffs.filter((d) => d.cls.includes('BUG')).length}`)
console.log()

for (const d of diffs.filter((x) => x.cls.includes('BUG')).slice(0, 5)) {
  console.log(`### ${d.name}  [${d.bad.join(', ')}]  ${d.cls}`)
  for (const f of d.bad) {
    console.log(`    C# ${f}: ${j(d.a[f] ?? null)?.slice(0, 300)}`)
    console.log(`    TS ${f}: ${j(d.b[f] ?? null)?.slice(0, 300)}`)
  }
}
