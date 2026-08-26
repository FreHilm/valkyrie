/**
 * Tests for content-pack selection.
 *
 * The behaviour worth pinning is what a scenario can see. Loading every pack
 * found on disk answers `#MoM1ET` with a yes the player never gave, which is
 * how House Lynch came to warn that first-edition content was *not* selected
 * while its tiles were loaded anyway.
 */

import { describe, expect, it } from 'vitest'

import { packsToLoad, packVariables } from '../src/content/packSelection.js'
import type { SelectablePack } from '../src/content/packSelection.js'

const pack = (id: string, clone: string[] = []): SelectablePack => ({ id, clone })

const MOM: SelectablePack[] = [
  pack('MoMBase'),
  pack('MoM1ET'),
  pack('MoM1EI'),
  pack('MoM1EM'),
  pack('BtT'),
  pack('SoA', ['MoMBase']),
]

describe('packsToLoad', () => {
  it('loads the base pack with nothing selected', () => {
    expect([...packsToLoad(MOM, [], 'MoMBase')]).toEqual(['MoMBase'])
  })

  it('loads what the player selected, and nothing else', () => {
    const loaded = packsToLoad(MOM, ['BtT'], 'MoMBase')

    expect([...loaded].sort()).toEqual(['BtT', 'MoMBase'])
    expect(loaded.has('MoM1ET')).toBe(false)
  })

  it('keeps the base pack whatever the selection says', () => {
    // `Select` refuses to deselect it, and it is loaded before the menu is
    // drawn — so a config without it is still a game with it.
    expect(packsToLoad(MOM, ['BtT'], 'MoMBase').has('MoMBase')).toBe(true)
  })

  it('brings in the packs a selected one names', () => {
    expect([...packsToLoad(MOM, ['SoA'], 'MoMBase')].sort()).toEqual(['MoMBase', 'SoA'])
  })

  it('ignores a selection for a pack that is not installed', () => {
    // The config outlives the content: removing an expansion should not stop
    // the game starting.
    expect([...packsToLoad(MOM, ['Absent'], 'MoMBase')]).toEqual(['MoMBase'])
  })

  it('terminates on a pack that names itself', () => {
    const looping = [pack('A', ['B']), pack('B', ['A'])]

    expect([...packsToLoad(looping, ['A'], '')].sort()).toEqual(['A', 'B'])
  })
})

describe('packVariables', () => {
  it('sets one variable per loaded pack', () => {
    expect(packVariables(['MoMBase', 'BtT'])).toEqual(
      new Map([
        ['#MoMBase', 1],
        ['#BtT', 1],
      ]),
    )
  })

  it('sets the older alias once every pack behind it is loaded', () => {
    // Quest formats below 6 test `#MoM1E` rather than the three ids.
    const all = packVariables(['MoM1ET', 'MoM1EI', 'MoM1EM'])

    expect(all.get('#MoM1E')).toBe(1)
  })

  it('leaves the alias unset while any of them is missing', () => {
    expect(packVariables(['MoM1ET', 'MoM1EI']).has('#MoM1E')).toBe(false)
  })

  it('knows the other two sets that were sold as one', () => {
    expect(packVariables(['CotWT', 'CotWI', 'CotWM']).get('#CotW')).toBe(1)
    expect(packVariables(['FAT', 'FAI', 'FAM']).get('#FA')).toBe(1)
  })

  it('does not set a variable called "#" for an empty id', () => {
    expect(packVariables(['']).has('#')).toBe(false)
  })
})
