/**
 * @vitest-environment happy-dom
 *
 * Tests for the content selection screen.
 *
 * What matters is that it cannot lie about what the player owns, and that the
 * base pack cannot be turned off — a scenario tests `#<packId>` to decide what
 * to ask for, so a wrong answer here reaches the table.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { contentSelect } from '../src/screens/contentSelect.js'
import type { ContentSelectView } from '../src/screens/contentSelect.js'

const VIEW: ContentSelectView = {
  packs: [
    { id: 'MoMBase', name: 'Mansions of Madness', type: 'box' },
    { id: 'BtT', name: 'Beyond the Threshold', type: 'box' },
    { id: 'MoM1ET', name: 'First Edition Tiles', type: 'ck' },
  ],
  selected: new Set(['BtT']),
  baseId: 'MoMBase',
}

function make(view: ContentSelectView = VIEW) {
  const toggled: string[] = []
  const onClose = vi.fn()
  const screen = contentSelect({ onToggle: (id) => toggled.push(id), onClose })
  screen.show(view)
  document.body.append(screen.element)
  return { screen, toggled, onClose }
}

const cards = (): HTMLButtonElement[] => [...document.querySelectorAll('.vk-pack')]

describe('contentSelect', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('lists every pack that was found', () => {
    make()

    expect(cards()).toHaveLength(3)
    expect(cards().map((c) => c.textContent)).toEqual([
      expect.stringContaining('Mansions of Madness'),
      expect.stringContaining('Beyond the Threshold'),
      expect.stringContaining('First Edition Tiles'),
    ])
  })

  it('shows which ones the player owns', () => {
    make()

    expect(cards()[1]?.getAttribute('aria-checked')).toBe('true')
    expect(cards()[2]?.getAttribute('aria-checked')).toBe('false')
  })

  it('announces each as a switch rather than a plain button', () => {
    make()

    expect(cards()[1]?.getAttribute('role')).toBe('switch')
  })

  it('reports a toggle by id', () => {
    const { toggled } = make()

    cards()[2]?.click()

    expect(toggled).toEqual(['MoM1ET'])
  })

  it('will not let the base pack be turned off', () => {
    // `Select` returns early for it, and the game loads it before this screen
    // exists — so it is shown as on and cannot be pressed.
    const { toggled } = make()

    expect(cards()[0]?.disabled).toBe(true)
    expect(cards()[0]?.getAttribute('aria-checked')).toBe('true')

    cards()[0]?.click()
    expect(toggled).toEqual([])
  })

  it('shows the base pack as included even when the config omits it', () => {
    make({ ...VIEW, selected: new Set() })

    expect(cards()[0]?.getAttribute('aria-checked')).toBe('true')
  })

  it('says so when there is no content at all', () => {
    make({ packs: [], selected: new Set(), baseId: 'MoMBase' })

    expect(cards()).toHaveLength(0)
    expect(document.body.textContent).toContain('No content packs found')
  })

  it('closes', () => {
    const { onClose } = make()
    const close = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Close'),
    )

    close?.click()

    expect(onClose).toHaveBeenCalled()
  })
})
