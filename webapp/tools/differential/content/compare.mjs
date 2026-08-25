import { readFileSync } from 'node:fs'
const cs = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const ts = JSON.parse(readFileSync(process.argv[3], 'utf8'))
const j = (v) => JSON.stringify(v)
const FIELDS = [
  'ok',
  'error',
  'value',
  'data',
  'languages',
  'exists',
  'extractAll',
  'dict',
  'key',
  'fullKey',
  'toString',
  'isKey',
  'regex',
  'emptyIfNotFound',
]
let same = 0
const diffs = []
for (let i = 0; i < cs.length; i++) {
  const a = cs[i],
    b = ts[i]
  const bad = FIELDS.filter((f) => j(a[f] ?? null) !== j(b[f] ?? null))
  if (!bad.length) {
    same++
    continue
  }
  const cls =
    a.ok === false && b.ok === true
      ? `C# threw ${a.error}`
      : a.ok === true && b.ok === false
        ? `TS threw ${b.error}  <-- BUG`
        : 'both ok, disagree  <-- BUG'
  diffs.push({ name: a.name, cls, bad, a, b })
}
console.log(`identical: ${same}/${cs.length}`)
const byClass = {}
for (const d of diffs) byClass[d.cls] = (byClass[d.cls] ?? 0) + 1
for (const [k, v] of Object.entries(byClass)) console.log(`  ${String(v).padStart(3)}  ${k}`)
// Same wording as the ini harness so CI can grep one pattern for both.
console.log(`real divergences: ${diffs.filter((d) => d.cls.includes('BUG')).length}`)
console.log()
for (const d of diffs) {
  console.log(`### ${d.name}  [${d.bad.join(', ')}]  ${d.cls}`)
  for (const f of d.bad) {
    console.log(`    C# ${f}: ${j(d.a[f] ?? null)}`)
    console.log(`    TS ${f}: ${j(d.b[f] ?? null)}`)
  }
}
