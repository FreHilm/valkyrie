/**
 * Differential runner for the selection-list trait filtering.
 *
 *   node compare.mjs [fuzzCount] [seed]
 */
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { TraitGroup, filterModeFor } from '../../../packages/ui/src/traitFilter.ts'

const here = dirname(fileURLToPath(import.meta.url))
const fuzzCount = Number(process.argv[2] ?? 2000)
const seed = Number(process.argv[3] ?? 1)

const item = (key, traits, display = key) => ({ key, display, traits })

function curated() {
  const cases = []
  const add = (label, items, states, sourceWording = 'Source') =>
    cases.push({ label, items, states, sourceWording })

  const pack = [
    item('a', { Type: ['Monster'], Source: ['Base'] }),
    item('b', { Type: ['Monster', 'Boss'], Source: ['FA'] }),
    item('c', { Type: ['Item'], Source: ['Base', 'FA'] }),
    item('d', { Type: ['Item'] }),
    item('e', {}),
  ]

  add('nothing selected', pack, [])
  add('one type selected', pack, [
    { group: 'Type', trait: 'Monster', selected: true, excluded: false },
  ])
  add('two types selected', pack, [
    { group: 'Type', trait: 'Monster', selected: true, excluded: false },
    { group: 'Type', trait: 'Boss', selected: true, excluded: false },
  ])
  add('one type excluded', pack, [
    { group: 'Type', trait: 'Monster', selected: false, excluded: true },
  ])
  add('source excluded, lenient mode', pack, [
    { group: 'Source', trait: 'Base', selected: false, excluded: true },
  ])
  add('source selected, lenient mode', pack, [
    { group: 'Source', trait: 'Base', selected: true, excluded: false },
  ])
  add('source excluded but another selected', pack, [
    { group: 'Source', trait: 'Base', selected: false, excluded: true },
    { group: 'Source', trait: 'FA', selected: true, excluded: false },
  ])
  add('across two groups', pack, [
    { group: 'Type', trait: 'Item', selected: true, excluded: false },
    { group: 'Source', trait: 'FA', selected: true, excluded: false },
  ])
  add('exclude in both groups', pack, [
    { group: 'Type', trait: 'Item', selected: false, excluded: true },
    { group: 'Source', trait: 'Base', selected: false, excluded: true },
  ])

  // The lenient mode hinges on matching the translated wording.
  add(
    'source group under a different wording',
    pack,
    [{ group: 'Source', trait: 'Base', selected: false, excluded: true }],
    'Quelle',
  )
  add(
    'wording matched case-insensitively',
    pack,
    [{ group: 'Source', trait: 'Base', selected: false, excluded: true }],
    '  source  ',
  )

  add('empty list', [], [])
  add('item with no traits at all', [item('lonely', {})], [])
  add('every trait excluded', pack, [
    { group: 'Type', trait: 'Monster', selected: false, excluded: true },
    { group: 'Type', trait: 'Boss', selected: false, excluded: true },
    { group: 'Type', trait: 'Item', selected: false, excluded: true },
  ])
  add(
    'trait shared by everything',
    [item('x', { Type: ['Common'] }), item('y', { Type: ['Common'] })],
    [{ group: 'Type', trait: 'Common', selected: true, excluded: false }],
  )

  return cases
}

function fuzz(count, seedValue) {
  let state = seedValue >>> 0
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
  const pick = (list) => list[Math.floor(next() * list.length)]

  const GROUPS = ['Type', 'Source', 'Expansion']
  const VALUES = {
    Type: ['Monster', 'Boss', 'Item', 'Hero'],
    Source: ['Base', 'FA', 'CotW'],
    Expansion: ['E1', 'E2'],
  }

  const cases = []
  for (let i = 0; i < count; i++) {
    const items = []
    const itemCount = 1 + Math.floor(next() * 6)
    for (let n = 0; n < itemCount; n++) {
      const traits = {}
      for (const group of GROUPS) {
        if (next() < 0.65) {
          const values = VALUES[group].filter(() => next() < 0.5)
          if (values.length > 0) traits[group] = values
        }
      }
      items.push(item(`i${n}`, traits))
    }

    const states = []
    for (const group of GROUPS) {
      for (const value of VALUES[group]) {
        const roll = next()
        if (roll < 0.2) states.push({ group, trait: value, selected: true, excluded: false })
        else if (roll < 0.35) states.push({ group, trait: value, selected: false, excluded: true })
      }
    }

    cases.push({
      label: `fuzz ${i}`,
      items,
      states,
      sourceWording: pick(['Source', 'Quelle', 'source']),
    })
  }
  return cases
}

const cases = [...curated(), ...fuzz(fuzzCount, seed)]

execFileSync('node', [join(here, 'extract.mjs')], { stdio: 'pipe' })
const raw = execFileSync(
  'dotnet',
  ['run', '--project', join(here, 'traitsharness.csproj'), '-c', 'Release', '-v', 'quiet'],
  { input: JSON.stringify(cases), maxBuffer: 1 << 28, encoding: 'utf8' },
)
const cs = JSON.parse(raw.slice(raw.indexOf('[')))

/** The port's equivalent of what Program.cs drives. */
function runTs(c) {
  const items = c.items.map((i) => ({
    key: i.key,
    display: i.display,
    traits: new Map(Object.entries(i.traits)),
  }))

  // Same sequence as Draw(): groups appear in first-seen order, addTraits is
  // called only for the item's own categories, addItem for every pair after.
  const groups = []
  for (const item of items) {
    for (const category of item.traits.keys()) {
      let group = groups.find((g) => g.name === category)
      if (group === undefined) {
        group = new TraitGroup(category, filterModeFor(category, c.sourceWording))
        groups.push(group)
      }
      group.addTraits(item)
    }
  }
  for (const item of items) {
    for (const group of groups) group.addItem(item)
  }

  for (const s of c.states) {
    const group = groups.find((g) => g.name === s.group)
    const trait = group?.traits.get(s.trait)
    if (trait === undefined) continue
    trait.selected = s.selected
    trait.excluded = s.excluded
  }

  return items
    .filter((item) =>
      groups.every((group) => !item.traits.has(group.name) || group.activeItem(item)),
    )
    .map((item) => item.key)
}

let divergences = 0
for (let i = 0; i < cases.length; i++) {
  const expected = cs[i].active
  const actual = runTs(cases[i])
  if (JSON.stringify(expected) === JSON.stringify(actual)) continue

  divergences++
  if (divergences <= 10) {
    console.log(`\n${cases[i].label}  (source wording ${JSON.stringify(cases[i].sourceWording)})`)
    console.log(`  items  : ${JSON.stringify(cases[i].items.map((i) => [i.key, i.traits]))}`)
    console.log(`  states : ${JSON.stringify(cases[i].states)}`)
    console.log(`  C#     : ${JSON.stringify(expected)}`)
    console.log(`  TS     : ${JSON.stringify(actual)}`)
  }
}

console.log(`\ntraits: ${cases.length} cases, ${divergences} real divergences`)
process.exit(divergences === 0 ? 0 : 1)
