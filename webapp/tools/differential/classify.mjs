import { readFileSync } from 'node:fs'
const cs = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const ts = JSON.parse(readFileSync(process.argv[3], 'utf8'))
const corpus = JSON.parse(readFileSync(process.argv[4], 'utf8'))
const j = (v) => JSON.stringify(v)
const buckets = new Map()
const realDiffs = []
for (let i = 0; i < cs.length; i++) {
  const a = cs[i],
    b = ts[i]
  if (['ok', 'data', 'toString', 'error'].every((f) => j(a[f]) === j(b[f]))) continue
  let cls
  if (a.ok === false && b.ok === true) cls = `C# threw ${a.error}, TS succeeded`
  else if (a.ok === true && b.ok === false) cls = `TS threw ${b.error}, C# succeeded  <-- BUG`
  else cls = 'both succeeded but disagree  <-- BUG'
  buckets.set(cls, (buckets.get(cls) ?? 0) + 1)
  if (cls.includes('BUG')) realDiffs.push({ i, case: corpus[i], cs: a, ts: b })
}
for (const [k, v] of [...buckets].sort((x, y) => y[1] - x[1]))
  console.log(`${String(v).padStart(5)}  ${k}`)
console.log(`\nreal divergences: ${realDiffs.length}`)
for (const d of realDiffs.slice(0, 10)) {
  console.log(`\n--- ${d.case.name} ---`)
  console.log(
    'input:',
    j(d.case.input ?? d.case.lines),
    d.case.section !== undefined ? `section=${j(d.case.section)}` : '',
  )
  console.log('  C#:', j({ ok: d.cs.ok, data: d.cs.data, error: d.cs.error }))
  console.log('  TS:', j({ ok: d.ts.ok, data: d.ts.data, error: d.ts.error }))
}
