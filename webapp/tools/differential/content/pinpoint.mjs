/** Reports the first differing field per case, instead of whole registries. */
import { readFileSync } from 'node:fs'

const cs = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const ts = JSON.parse(readFileSync(process.argv[3], 'utf8'))

const j = (v) => JSON.stringify(v)
const findings = []

function walkRegistry(name, a, b) {
  const aTypes = new Map(a.map(([t, e]) => [t, new Map(e)]))
  const bTypes = new Map(b.map(([t, e]) => [t, new Map(e)]))

  for (const t of new Set([...aTypes.keys(), ...bTypes.keys()])) {
    const ae = aTypes.get(t)
    const be = bTypes.get(t)
    if (!ae || !be) {
      findings.push({ name, detail: `type ${t} present only in ${ae ? 'C#' : 'TS'}` })
      continue
    }
    for (const k of new Set([...ae.keys(), ...be.keys()])) {
      const av = ae.get(k)
      const bv = be.get(k)
      if (!av || !bv) {
        findings.push({ name, detail: `${t}/${k} present only in ${av ? 'C#' : 'TS'}` })
        continue
      }
      for (const f of new Set([...Object.keys(av), ...Object.keys(bv)])) {
        if (j(av[f]) !== j(bv[f])) {
          findings.push({ name, detail: `${t}/${k}.${f}`, cs: av[f], ts: bv[f] })
        }
      }
    }
  }
}

for (let i = 0; i < cs.length; i++) {
  const a = cs[i]
  const b = ts[i]
  if (j(a.ok) !== j(b.ok) || j(a.error ?? null) !== j(b.error ?? null)) {
    findings.push({ name: a.name, detail: `ok/error: C#=${a.ok}/${a.error} TS=${b.ok}/${b.error}` })
    continue
  }
  if (j(a.data) === j(b.data)) continue

  if (Array.isArray(a.data) && Array.isArray(b.data)) walkRegistry(a.name, a.data, b.data)
  else {
    for (const f of new Set([...Object.keys(a.data ?? {}), ...Object.keys(b.data ?? {})])) {
      if (j(a.data?.[f]) !== j(b.data?.[f])) {
        findings.push({ name: a.name, detail: f, cs: a.data?.[f], ts: b.data?.[f] })
      }
    }
  }
}

// Group by the field that differs, so one root cause reads as one line.
const byField = new Map()
for (const f of findings) {
  const key = f.detail.replace(/^[^/]+\/[^.]+\./, '*.').replace(/^[^/]+\//, '*/')
  if (!byField.has(key)) byField.set(key, [])
  byField.get(key).push(f)
}

console.log(`differing entries: ${findings.length}, distinct shapes: ${byField.size}\n`)
for (const [key, items] of [...byField].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`### ${key}  (${items.length} occurrences)`)
  for (const item of items.slice(0, 3)) {
    console.log(`    ${item.name.split('/').slice(-2).join('/')}  ${item.detail}`)
    if ('cs' in item) {
      console.log(`      C#: ${j(item.cs)}`)
      console.log(`      TS: ${j(item.ts)}`)
    }
  }
  console.log()
}
