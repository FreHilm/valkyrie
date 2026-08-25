/**
 * Tests for trait filtering (T-016).
 *
 * The real assurance is `tools/differential/traits`, which extracts the
 * `TraitGroup` class from the Unity source and compares it against this port
 * over thousands of cases. These document the semantics readably.
 */

import { describe, expect, it } from 'vitest'

import {
  FilterMode,
  filterItems,
  filterModeFor,
  groupsFrom,
  sortItems,
} from '../src/traitFilter.js'
import type { SelectionItem } from '../src/traitFilter.js'

const item = (key: string, traits: Record<string, string[]> = {}): SelectionItem => ({
  key,
  display: key,
  traits: new Map(Object.entries(traits)),
})

const PACK: SelectionItem[] = [
  item('a', { Type: ['Monster'], Source: ['Base'] }),
  item('b', { Type: ['Monster', 'Boss'], Source: ['FA'] }),
  item('c', { Type: ['Item'], Source: ['Base', 'FA'] }),
  item('d', { Type: ['Item'] }),
  item('e', {}),
]

const keys = (items: readonly SelectionItem[]): string[] => items.map((i) => i.key)

describe('filterModeFor', () => {
  it('makes the Source group lenient', () => {
    expect(filterModeFor('Source', 'Source')).toBe(FilterMode.AT_LEAST_ONE_SELECTED)
  })

  it('matches the wording case-insensitively and trimmed', () => {
    expect(filterModeFor('source', '  Source  ')).toBe(FilterMode.AT_LEAST_ONE_SELECTED)
  })

  // The C# compares against the *translated* SOURCE string, so the mode
  // depends on the user's language.
  it('is strict when the translated wording does not match', () => {
    expect(filterModeFor('Source', 'Quelle')).toBe(FilterMode.STRICT)
  })
})

describe('filterItems', () => {
  it('shows everything when nothing is selected', () => {
    expect(keys(filterItems(PACK, groupsFrom(PACK)))).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('requires every selected trait', () => {
    const groups = groupsFrom(PACK)
    groups[0]?.toggleSelected('Monster')
    groups[0]?.toggleSelected('Boss')

    expect(keys(filterItems(PACK, groups))).toEqual(['b', 'e'])
  })

  it('drops items carrying an excluded trait, in strict mode', () => {
    const groups = groupsFrom(PACK)
    groups[0]?.toggleExcluded('Monster')

    expect(keys(filterItems(PACK, groups))).toEqual(['c', 'd', 'e'])
  })

  // An item with no trait in a group is not filtered by that group at all,
  // which is how 'd' (no Source) survives a Source filter.
  it('ignores a group the item has no trait in', () => {
    const groups = groupsFrom(PACK)
    groups[1]?.toggleSelected('Base')

    expect(keys(filterItems(PACK, groups))).toContain('d')
    expect(keys(filterItems(PACK, groups))).toContain('e')
  })

  it('selecting and excluding are mutually exclusive', () => {
    const groups = groupsFrom(PACK)
    groups[0]?.toggleSelected('Monster')
    groups[0]?.toggleExcluded('Monster')

    expect(groups[0]?.traits.get('Monster')).toEqual({ selected: false, excluded: true })
  })

  it('applies the search box case-insensitively', () => {
    const items = [item('Deep Vault'), item('Shallow Grave')]

    expect(keys(filterItems(items, [], { search: 'vAuLt' }))).toEqual(['Deep Vault'])
  })

  it('clear() resets a group', () => {
    const groups = groupsFrom(PACK)
    groups[0]?.toggleExcluded('Monster')
    groups[0]?.clear()

    expect(keys(filterItems(PACK, groups))).toHaveLength(5)
  })
})

describe('lenient Source mode', () => {
  const groups = (): ReturnType<typeof groupsFrom> => groupsFrom(PACK, 'Source')

  it('exclusion bites when nothing in the group is selected', () => {
    const g = groups()
    const source = g.find((group) => group.name === 'Source')
    source?.toggleExcluded('Base')

    // 'c' survives: it also carries FA, which is not excluded.
    expect(keys(filterItems(PACK, g))).toEqual(['b', 'c', 'd', 'e'])
  })

  it('an item needs a selected trait once anything is selected', () => {
    const g = groups()
    const source = g.find((group) => group.name === 'Source')
    source?.toggleSelected('FA')

    expect(keys(filterItems(PACK, g))).toEqual(['b', 'c', 'd', 'e'])
  })
})

describe('sortItems', () => {
  it('sorts by display text', () => {
    expect(keys(sortItems([item('Zeta'), item('Alpha')]))).toEqual(['Alpha', 'Zeta'])
  })

  it('pins alwaysOnTop items above the rest', () => {
    const pinned = { ...item('Zeta'), alwaysOnTop: true }

    expect(keys(sortItems([item('Alpha'), pinned]))).toEqual(['Zeta', 'Alpha'])
  })
})

describe('groupsFrom', () => {
  it('creates one group per trait category, in first-seen order', () => {
    expect(groupsFrom(PACK).map((g) => g.name)).toEqual(['Type', 'Source'])
  })

  it('files an item with no trait in a group as ungrouped', () => {
    const group = groupsFrom(PACK)[1]

    expect(group?.ungrouped.map((i) => i.key)).toEqual(['d', 'e'])
  })

  it('handles an empty item set', () => {
    expect(groupsFrom([])).toEqual([])
  })
})
