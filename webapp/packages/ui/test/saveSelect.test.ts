/**
 * @vitest-environment happy-dom
 *
 * Tests for the save slot screen (T-026), replacing `SaveSelectScreen.cs`.
 *
 * One screen serves both directions, and the difference between them is the
 * part worth asserting: what may be written to is not what may be opened.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { saveSelect } from '../src/screens/saveSelect.js'
import type { SaveSlotView } from '../src/screens/saveSelect.js'

beforeEach(() => {
  document.body.replaceChildren()
})

const SLOTS: SaveSlotView[] = [
  { slot: 0, save: { questName: 'Exotic Material', time: '28 Aug, 20:00' } },
  { slot: 1, save: { questName: 'House Lynch', time: '27 Aug, 19:00' } },
  { slot: 2, save: null },
  { slot: 3, save: null },
]

function make(mode: 'save' | 'load', slots: readonly SaveSlotView[] = SLOTS) {
  const onSelect = vi.fn()
  const onBack = vi.fn()
  const screen = saveSelect({ mode, onSelect, onBack })
  document.body.append(screen.element)
  screen.show(slots)
  return { screen, onSelect, onBack }
}

const rows = (root: HTMLElement) => [...root.querySelectorAll<HTMLButtonElement>('.vk-saves__slot')]

describe('saveSelect', () => {
  it('lists every slot when loading, autosave first', () => {
    const { screen } = make('load')

    expect(rows(screen.element).map((r) => r.textContent)).toEqual([
      'AutosaveExotic Material28 Aug, 20:00',
      'Save 1House Lynch27 Aug, 19:00',
      'Save 2Empty',
      'Save 3Empty',
    ])
  })

  it('withholds the autosave when saving', () => {
    // `if (i == 0 && save) continue`: the autosave is the game's own, and not
    // somewhere to put a save by hand.
    const { screen } = make('save')

    expect(rows(screen.element).map((r) => r.textContent?.slice(0, 6))).toEqual([
      'Save 1',
      'Save 2',
      'Save 3',
    ])
  })

  it('will not open an empty slot', () => {
    const { screen } = make('load')

    expect(rows(screen.element)[2]?.disabled).toBe(true)
    expect(rows(screen.element)[0]?.disabled).toBe(false)
  })

  it('will write into an empty slot', () => {
    const { screen, onSelect } = make('save')

    const empty = rows(screen.element).find((r) => r.textContent?.includes('Empty'))
    expect(empty?.disabled).toBe(false)
    empty?.click()
    expect(onSelect).toHaveBeenCalled()
  })

  it('reports which slot was chosen', () => {
    const { screen, onSelect } = make('load')
    rows(screen.element)[1]?.click()

    expect(onSelect).toHaveBeenCalledWith(1)
  })

  it('shows a save it cannot open, and refuses to open it', () => {
    // Better than hiding it: the slot is taken, and saying why beats an empty
    // row the player will try to write over expecting nothing to be lost.
    const { screen } = make('load', [
      {
        slot: 1,
        save: { questName: 'House Lynch', time: '27 Aug' },
        rejection: 'Saved by a newer version',
      },
    ])

    const row = rows(screen.element)[0]
    expect(row?.disabled).toBe(true)
    expect(row?.textContent).toContain('Saved by a newer version')
  })

  it('shows a thumbnail when the save carried one', () => {
    const { screen } = make('load', [
      { slot: 1, save: { questName: 'House Lynch', time: null, image: 'blob:shot' } },
    ])

    expect(screen.element.querySelector('.vk-saves__thumb')?.getAttribute('src')).toBe('blob:shot')
  })

  it('goes back', () => {
    const { screen, onBack } = make('load')
    ;[...screen.element.querySelectorAll('button')]
      .find((b) => b.textContent === 'Back')
      ?.click()

    expect(onBack).toHaveBeenCalled()
  })
})
