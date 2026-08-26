/**
 * Tests for the deck a starting card is filed under.
 *
 * `InvestigatorItems` groups by the section-name prefix to sort the list and
 * never shows it. This shows it, so the prefix has to survive being read by a
 * person looking for the cards in a box.
 */

import { describe, expect, it } from 'vitest'

import { itemGroup } from '../src/partySetup.js'

describe('itemGroup', () => {
  it('names the deck a card comes from', () => {
    expect(itemGroup('ItemCommonCandles')).toBe('Common')
    expect(itemGroup('ItemUniqueSigil')).toBe('Unique')
    expect(itemGroup('ItemSpellHealing')).toBe('Spell')
  })

  it('keeps digits in the card name out of the deck name', () => {
    // The split stops at a capital, and `18` is not one, so the raw prefix is
    // `ItemCommon18` — a deck nobody has.
    expect(itemGroup('ItemCommon18Derringer')).toBe('Common')
  })

  it('leaves a name that does not start with Item alone', () => {
    expect(itemGroup('QItemThing')).toBe('QItem')
  })
})
