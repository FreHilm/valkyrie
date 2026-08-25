/** Reports the first differing field per case, grouped by field name. */
import { readFileSync } from 'node:fs'

const cs = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const ts = JSON.parse(readFileSync(process.argv[3], 'utf8'))

const j = (v) => JSON.stringify(v)
const findings = []

function compareObjects(name, prefix, a, b) {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])
  for (const k of keys) {
    if (j(a?.[k]) !== j(b?.[k])) {
      findings.push({ name, field: prefix + k, cs: a?.[k], ts: b?.[k] })
    }
  }
}

for (let i = 0; i < cs.length; i++) {
  const a = cs[i]
  const b = ts[i]
  if (j(a.ok) !== j(b.ok) || j(a.error ?? null) !== j(b.error ?? null)) {
    findings.push({ name: a.name, field: `<throw> C#=${a.error} TS=${b.error}` })
    continue
  }
  if (j(a.data) === j(b.data)) continue

  // Component dumps are [[name, fields], ...]; everything else is an object.
  if (Array.isArray(a.data) && Array.isArray(b.data)) {
    const am = new Map(a.data)
    const bm = new Map(b.data)
    for (const key of new Set([...am.keys(), ...bm.keys()])) {
      if (!am.has(key) || !bm.has(key)) {
        findings.push({ name: a.name, field: `<only in ${am.has(key) ? 'C#' : 'TS'}> ${key}` })
        continue
      }
      compareObjects(a.name, `${key}.`, am.get(key), bm.get(key))
    }
  } else {
    compareObjects(a.name, '', a.data, b.data)
  }
}

const byField = new Map()
for (const f of findings) {
  const key = f.field.replace(/^[^.]+\./, '*.')
  if (!byField.has(key)) byField.set(key, [])
  byField.get(key).push(f)
}

console.log(`differing fields: ${findings.length}, distinct shapes: ${byField.size}\n`)
for (const [key, items] of [...byField].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`### ${key}  (${items.length})`)
  for (const item of items.slice(0, 2)) {
    console.log(`    ${item.name.slice(0, 70)}`)
    if ('cs' in item) {
      console.log(`      C#: ${j(item.cs)?.slice(0, 160)}`)
      console.log(`      TS: ${j(item.ts)?.slice(0, 160)}`)
    }
  }
}
