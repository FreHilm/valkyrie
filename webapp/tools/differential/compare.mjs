import { readFileSync } from 'node:fs'
const cs = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const ts = JSON.parse(readFileSync(process.argv[3], 'utf8'))
const j = (v) => JSON.stringify(v)
let same = 0
const diffs = []
for (let i = 0; i < cs.length; i++) {
  const a = cs[i],
    b = ts[i]
  const fields = ['ok', 'data', 'toString', 'error']
  const bad = fields.filter((f) => j(a[f]) !== j(b[f]))
  if (bad.length === 0) {
    same++
    continue
  }
  diffs.push({
    name: a.name,
    bad,
    cs: Object.fromEntries(bad.map((f) => [f, a[f]])),
    ts: Object.fromEntries(bad.map((f) => [f, b[f]])),
  })
}
console.log(`identical: ${same}/${cs.length}`)
console.log(`divergent: ${diffs.length}\n`)
for (const d of diffs) {
  console.log(`### ${d.name}  [${d.bad.join(', ')}]`)
  console.log(`  C#: ${j(d.cs)}`)
  console.log(`  TS: ${j(d.ts)}`)
  console.log()
}
