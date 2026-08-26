/**
 * Tests for choosing the items behind a scenario's `QItem` sections.
 *
 * A scenario says "a weapon" and the game picks one, so what is asserted is
 * the choosing: that traits narrow it, that two sections never land on the
 * same item, that fame gates apply, and that the iteration settles sections
 * which name each other rather than looping forever.
 */

import { describe, expect, it, vi } from 'vitest'

import {
  attemptItemMatch,
  fameLevel,
  generateItemSelection,
  startingItems,
} from '../src/quest/itemSelection.js'
import type { ItemSelectionContext, QItemView, SelectableItem } from '../src/quest/itemSelection.js'

const item = (traits: string[], minFame = -1, maxFame = -1): SelectableItem => ({
  traits,
  minFame,
  maxFame,
})

const ITEMS = new Map<string, SelectableItem>([
  ['ItemAxe', item(['weapon', 'common'])],
  ['ItemShotgun', item(['weapon', 'common'])],
  ['ItemLantern', item(['lightsource', 'common'])],
  ['ItemRelic', item(['weapon', 'rare'], 3, 6)],
])

function context(over: Partial<ItemSelectionContext> = {}): ItemSelectionContext {
  return { items: ITEMS, fame: 1, held: [], random: () => 0, ...over }
}

const q = (over: Partial<QItemView> & { sectionName: string }): QItemView => ({
  itemName: [],
  traits: [],
  traitpool: [],
  ...over,
})

describe('attemptItemMatch', () => {
  it('takes a named content item when the section has no traits', () => {
    const selected = new Map<string, string>()

    attemptItemMatch(q({ sectionName: 'QItemKey', itemName: ['ItemAxe'] }), selected, context())

    expect(selected.get('QItemKey')).toBe('ItemAxe')
  })

  it('follows a name that is another section already settled', () => {
    const selected = new Map([['QItemFirst', 'ItemAxe']])

    attemptItemMatch(
      q({ sectionName: 'QItemSecond', itemName: ['QItemFirst'] }),
      selected,
      context(),
    )

    expect(selected.get('QItemSecond')).toBe('ItemAxe')
  })

  it('waits on a section that is not settled yet', () => {
    const selected = new Map<string, string>()

    const settled = attemptItemMatch(
      q({ sectionName: 'QItemSecond', itemName: ['QItemFirst', 'ItemAxe'] }),
      selected,
      context(),
    )

    // The answer depends on QItemFirst, so there is nothing to decide.
    expect(settled).toBe(false)
    expect(selected.size).toBe(0)
  })

  it('narrows by every trait the section requires', () => {
    const selected = new Map<string, string>()

    attemptItemMatch(
      q({ sectionName: 'QItemLight', traits: ['lightsource', 'common'] }),
      selected,
      context(),
    )

    expect(selected.get('QItemLight')).toBe('ItemLantern')
  })

  it('needs only one of a trait pool', () => {
    const selected = new Map<string, string>()

    attemptItemMatch(
      q({ sectionName: 'QItemAny', traitpool: ['lightsource', 'nothing'] }),
      selected,
      context(),
    )

    expect(selected.get('QItemAny')).toBe('ItemLantern')
  })

  it('does not hand out an item another section already took', () => {
    const selected = new Map([['QItemFirst', 'ItemAxe']])

    attemptItemMatch(
      q({ sectionName: 'QItemSecond', traits: ['weapon', 'common'] }),
      selected,
      context(),
    )

    expect(selected.get('QItemSecond')).toBe('ItemShotgun')
  })

  it('does not hand out something the investigators already hold', () => {
    const selected = new Map<string, string>()

    attemptItemMatch(
      q({ sectionName: 'QItemWeapon', traits: ['weapon', 'common'] }),
      selected,
      context({ held: ['ItemAxe'] }),
    )

    expect(selected.get('QItemWeapon')).toBe('ItemShotgun')
  })

  it('respects a fame gate', () => {
    const selected = new Map<string, string>()

    attemptItemMatch(
      q({ sectionName: 'QItemRare', traits: ['rare'] }),
      selected,
      context({ fame: 1 }),
    )
    expect(selected.size).toBe(0)

    attemptItemMatch(
      q({ sectionName: 'QItemRare', traits: ['rare'] }),
      selected,
      context({ fame: 4 }),
    )
    expect(selected.get('QItemRare')).toBe('ItemRelic')
  })

  it('warns rather than throwing when nothing matches', () => {
    const warn = vi.fn()
    const selected = new Map<string, string>()

    const settled = attemptItemMatch(
      q({ sectionName: 'QItemImpossible', traits: ['nonesuch'] }),
      selected,
      context({ warn }),
    )

    expect(settled).toBe(false)
    expect(String(warn.mock.calls[0]?.[0])).toContain('QItemImpossible')
  })

  it('leaves a section that is already settled alone', () => {
    const selected = new Map([['QItemKey', 'ItemAxe']])

    expect(
      attemptItemMatch(
        q({ sectionName: 'QItemKey', itemName: ['ItemShotgun'] }),
        selected,
        context(),
      ),
    ).toBe(false)
    expect(selected.get('QItemKey')).toBe('ItemAxe')
  })
})

describe('generateItemSelection', () => {
  it('settles every section, giving each a different item', () => {
    // House Lynch's three starting items are exactly this shape.
    const selected = generateItemSelection(
      [
        q({ sectionName: 'QItemWeapon', traits: ['weapon', 'common'] }),
        q({ sectionName: 'QItemLight', traits: ['lightsource', 'common'] }),
      ],
      context(),
    )

    expect(selected.get('QItemWeapon')).toBe('ItemAxe')
    expect(selected.get('QItemLight')).toBe('ItemLantern')
  })

  it('settles a section that names one settled later', () => {
    // The first pass cannot place QItemCopy; the second, once QItemReal is
    // settled, can.
    const selected = generateItemSelection(
      [
        q({ sectionName: 'QItemCopy', itemName: ['QItemReal'] }),
        q({ sectionName: 'QItemReal', itemName: ['ItemAxe'] }),
      ],
      context(),
    )

    expect(selected.get('QItemCopy')).toBe('ItemAxe')
  })

  it('stops waiting for pool entries that will never settle', () => {
    // House Lynch's starting items are exactly this: traits to match, and a
    // pool naming ten `QItem`s that are not sections of their own. Without
    // the forced pass none of the three would ever be handed out.
    const selected = generateItemSelection(
      [
        q({
          sectionName: 'QItemStartWeapon',
          itemName: ['QItemCultSigil', 'QItemSilverKey'],
          traits: ['weapon', 'common'],
        }),
      ],
      context(),
    )

    expect(selected.get('QItemStartWeapon')).toBe('ItemAxe')
  })

  it('terminates when a section can never be settled', () => {
    const selected = generateItemSelection(
      [q({ sectionName: 'QItemNowhere', itemName: ['QItemAbsent'] })],
      context(),
    )

    expect(selected.size).toBe(0)
  })
})

describe('fameLevel', () => {
  it('tops out when a quest sets none of the thresholds', () => {
    // Every comparison is `0 >= 0`, so it reaches 6 rather than staying at 1.
    // That is the C#'s behaviour and it is harmless: the level only gates
    // items declaring `minFame`, which no Mansions item does.
    expect(fameLevel(() => 0)).toBe(6)
  })

  it('climbs through the thresholds', () => {
    const vars: Record<string, number> = {
      '$%fame': 30,
      '$%famenoteworthy': 10,
      '$%fameimpressive': 20,
      '$%famecelebrated': 30,
      '$%fameheroic': 40,
      '$%famelegendary': 50,
    }
    expect(fameLevel((n) => vars[n] ?? 0)).toBe(4)
  })
})

describe('startingItems', () => {
  const base = {
    items: ITEMS,
    selected: new Map([['QItemWeapon', 'ItemShotgun']]),
  }
  const questItem = (over = {}) => ({
    sectionName: 'QItemWeapon',
    itemName: [],
    traits: [],
    traitpool: [],
    starting: true,
    passes: true,
    inspect: '',
    ...over,
  })

  it('takes the item on each investigator card', () => {
    const result = startingItems({
      ...base,
      heroes: [{ heroName: 'HeroA', item: 'ItemAxe' }],
      questItems: [],
    })

    expect(result.items).toEqual(['ItemAxe'])
  })

  it('ignores a card item the content does not have', () => {
    const result = startingItems({
      ...base,
      heroes: [{ heroName: 'HeroA', item: 'ItemAbsent' }],
      questItems: [],
    })

    expect(result.items).toEqual([])
  })

  it('adds what the scenario grants, resolved', () => {
    const result = startingItems({ ...base, heroes: [], questItems: [questItem()] })

    expect(result.items).toEqual(['ItemShotgun'])
  })

  it('leaves out a QItem that is not a starting one', () => {
    const result = startingItems({
      ...base,
      heroes: [],
      questItems: [questItem({ starting: false })],
    })

    expect(result.items).toEqual([])
  })

  it('leaves out a QItem whose tests fail', () => {
    const result = startingItems({
      ...base,
      heroes: [],
      questItems: [questItem({ passes: false })],
    })

    expect(result.items).toEqual([])
  })

  it('carries the event that examines an item', () => {
    const result = startingItems({
      ...base,
      heroes: [],
      questItems: [questItem({ inspect: 'EventReadIt' })],
    })

    expect(result.inspect.get('ItemShotgun')).toBe('EventReadIt')
  })
})
