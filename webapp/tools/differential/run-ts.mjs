import { readFileSync, writeFileSync } from 'node:fs'
import { readFromString, readSectionFromStringArray } from '../../packages/core/src/ini/IniRead.ts'

const corpus = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const results = corpus.map((c) => {
  const r = { name: c.name }
  try {
    if (c.kind === 'readFromString') {
      const d = readFromString(c.input)
      r.ok = true
      r.data = [...d.data].map(([k, v]) => [k, [...v]])
      r.toString = d.toString()
    } else {
      const s = readSectionFromStringArray(c.lines, 'test.ini', c.section)
      r.ok = true
      r.data = [...s]
    }
  } catch (e) {
    r.ok = false
    r.error = e.constructor.name
  }
  return r
})
writeFileSync(process.argv[3], JSON.stringify(results))
console.log('ts cases:', results.length)
