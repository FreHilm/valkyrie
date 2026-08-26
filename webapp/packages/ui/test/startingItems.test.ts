/**
 * @vitest-environment happy-dom
 *
 * Tests for the starting-items screen.
 *
 * It is read at the table while people find cards in a box, so what matters is
 * that everything granted appears, grouped by the deck it comes from and in a
 * stable order.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { startingItemsScreen } from '../src/screens/startingItems.js'
import type { StartingItemView } from '../src/screens/startingItems.js'

const ITEMS: StartingItemView[] = [
  { id: 'ItemCommonLantern', name: 'Lantern', group: 'Common Item' },
  { id: 'ItemUniqueSigil', name: 'Cult Sigil', group: 'Unique Item' },
  { id: 'ItemCommonAxe', name: 'Axe', group: 'Common Item' },
]

function make(items: readonly StartingItemView[] = ITEMS) {
  const onConfirm = vi.fn()
  const screen = startingItemsScreen({ onConfirm })
  screen.show(items)
  document.body.append(screen.element)
  return { screen, onConfirm }
}

describe('startingItemsScreen', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('lists everything the investigators begin with', () => {
    make()

    expect(document.querySelectorAll('.vk-starting__item')).toHaveLength(3)
  })

  it('groups by the deck each card comes from', () => {
    make()
    const groups = [...document.querySelectorAll('.vk-starting__group h3')]

    expect(groups.map((g) => g.textContent)).toEqual(['Common Item', 'Unique Item'])
  })

  it('orders within a group, so two people read the same list', () => {
    make()
    const first = document.querySelector('.vk-starting__group')
    const names = [...(first?.querySelectorAll('.vk-starting__name') ?? [])]

    expect(names.map((n) => n.textContent)).toEqual(['Axe', 'Lantern'])
  })

  it('says so when the party begins with nothing', () => {
    make([])

    expect(document.querySelectorAll('.vk-starting__item')).toHaveLength(0)
    expect(document.body.textContent).toContain('begin with nothing')
  })

  it('confirms', () => {
    const { onConfirm } = make()
    const ready = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Ready'),
    )

    ready?.click()

    expect(onConfirm).toHaveBeenCalled()
  })

  it('replaces the list rather than appending on a second show', () => {
    const { screen } = make()
    screen.show([{ id: 'ItemX', name: 'X', group: 'Common Item' }])

    expect(document.querySelectorAll('.vk-starting__item')).toHaveLength(1)
  })
})
