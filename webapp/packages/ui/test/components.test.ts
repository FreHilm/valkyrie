/**
 * @vitest-environment happy-dom
 *
 * Tests for the component set (T-016).
 *
 * There is nothing to port here — 36 of the 37 files in
 * `unity/Assets/Scripts/UI` are uGUI-bound and have no tests. What is asserted
 * is the behaviour the Unity UI does not have: keyboard operation, focus
 * order, and labels that assistive technology can read.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { StringKey, DictionaryI18n, defaultLocalization } from '@valkyrie/core'
import { button, dialog, label, list, panel, searchBox } from '../src/components.js'
import { el } from '../src/dom.js'
import { selectionList } from '../src/selectionList.js'
import { itemsFrom } from '../src/selectionList.js'
import { rawText, text } from '../src/text.js'
import { installUnits, pixelsPerUnit } from '../src/units.js'

/**
 * Components translate through `defaultLocalization`, which the app configures
 * at startup — the same singleton arrangement the C# uses.
 */
function registerDictionary(): void {
  defaultLocalization.addDictionary(
    'val',
    new DictionaryI18n(['.,English', 'GREETING,Hello', 'CLOSE,Close']),
  )
}

beforeEach(() => {
  document.body.replaceChildren()
})

describe('label', () => {
  it('translates a localized key rather than printing it', () => {
    registerDictionary()

    expect(label(text(new StringKey('val', 'GREETING'))).textContent).toBe('Hello')
  })

  it('renders raw content as given', () => {
    expect(label(rawText('Deep Vault')).textContent).toBe('Deep Vault')
  })

  describe('el', () => {
    it('takes a class attribute written as one string', () => {
      // `classList.add` throws on a token containing a space, so this used to
      // take out the element and everything after it — in a browser only, since
      // happy-dom accepts the token happily.
      const node = el('div', { class: 'vk-shell vk-shell--menu' })

      expect([...node.classList]).toEqual(['vk-shell', 'vk-shell--menu'])
    })

    it('takes them as a list too, splitting any that hold more than one', () => {
      const node = el('div', { class: ['vk-a', 'vk-b vk-c'] })

      expect([...node.classList]).toEqual(['vk-a', 'vk-b', 'vk-c'])
    })

    it('ignores an empty or whitespace-only class', () => {
      expect([...el('div', { class: '' }).classList]).toEqual([])
      expect([...el('div', { class: '   ' }).classList]).toEqual([])
    })
  })

  // Sizing is a class, not an inline style, so it stays in the cascade.
  it('carries its size as a class the stylesheet keys off', () => {
    expect(label(rawText('x'), { size: 'large' }).className).toContain('vk-text--large')
    expect(label(rawText('x')).className).toContain('vk-text--small')
  })

  it('renders a heading when asked, so document structure is real', () => {
    expect(label(rawText('x'), { heading: 2 }).tagName).toBe('H2')
  })
})

describe('button', () => {
  it('is a real button element, so the platform handles keyboard activation', () => {
    const node = button(rawText('Go'), { onPress: () => {} })

    expect(node.tagName).toBe('BUTTON')
    expect(node.getAttribute('type')).toBe('button')
  })

  it('calls its handler on click', () => {
    const onPress = vi.fn()
    button(rawText('Go'), { onPress }).click()

    expect(onPress).toHaveBeenCalledOnce()
  })

  it('does not fire when disabled', () => {
    const onPress = vi.fn()
    const node = button(rawText('Go'), { onPress, disabled: true })
    node.click()

    expect(node.disabled).toBe(true)
    expect(onPress).not.toHaveBeenCalled()
  })

  it('takes a spoken label when the visible one is a glyph', () => {
    const node = button(rawText('x'), { onPress: () => {}, describedBy: rawText('Close') })

    expect(node.getAttribute('aria-label')).toBe('Close')
  })
})

describe('panel', () => {
  it('is a labelled region when it has a title', () => {
    const node = panel({ title: rawText('Heroes') })
    const id = node.getAttribute('aria-labelledby')

    expect(node.tagName).toBe('SECTION')
    expect(node.querySelector(`#${id}`)?.textContent).toBe('Heroes')
  })

  it('omits the label when there is no title', () => {
    expect(panel().getAttribute('aria-labelledby')).toBeNull()
  })
})

describe('list', () => {
  const items = ['one', 'two', 'three']
  const render = (item: string): Node => label(rawText(item))

  it('is a plain list when it is not selectable', () => {
    const node = list({ items, render, label: rawText('Items') })

    expect(node.getAttribute('role')).toBeNull()
    expect(node.querySelectorAll('li')).toHaveLength(3)
  })

  it('is a listbox when it is selectable, and is named', () => {
    const node = list({ items, render, label: rawText('Items'), onSelect: () => {} })

    expect(node.getAttribute('role')).toBe('listbox')
    expect(node.getAttribute('aria-label')).toBe('Items')
    expect(node.querySelectorAll('[role="option"]')).toHaveLength(3)
  })

  it('is one tab stop, with only the first row reachable', () => {
    const node = list({ items, render, label: rawText('Items'), onSelect: () => {} })
    const rows = [...node.querySelectorAll<HTMLElement>('[role="option"]')]

    expect(rows.map((row) => row.getAttribute('tabindex'))).toEqual(['0', '-1', '-1'])
  })

  it.each(['Enter', ' '])('selects with the %s key', (key) => {
    const onSelect = vi.fn()
    const node = list({ items, render, label: rawText('Items'), onSelect })
    document.body.append(node)

    node
      .querySelector('[role="option"]')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))

    expect(onSelect).toHaveBeenCalledWith('one', 0)
  })

  it('moves focus with the arrow keys', () => {
    const node = list({ items, render, label: rawText('Items'), onSelect: () => {} })
    document.body.append(node)
    const rows = [...node.querySelectorAll<HTMLElement>('[role="option"]')]
    rows[0]?.focus()

    node.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))

    expect(document.activeElement).toBe(rows[1])
    expect(rows[1]?.tabIndex).toBe(0)
    expect(rows[0]?.tabIndex).toBe(-1)
  })

  it('stops at the ends rather than wrapping', () => {
    const node = list({ items, render, label: rawText('Items'), onSelect: () => {} })
    document.body.append(node)
    const rows = [...node.querySelectorAll<HTMLElement>('[role="option"]')]
    rows[0]?.focus()

    node.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))

    expect(document.activeElement).toBe(rows[0])
  })

  it('shows an empty message instead of a bare list', () => {
    const node = list({ items: [], render, label: rawText('Items'), emptyMessage: rawText('None') })

    expect(node.textContent).toBe('None')
  })
})

describe('dialog', () => {
  it('is a labelled modal', () => {
    const d = dialog({ title: rawText('Confirm') })
    const id = d.element.getAttribute('aria-labelledby')

    expect(d.element.tagName).toBe('DIALOG')
    expect(d.element.querySelector(`#${id}`)?.textContent).toBe('Confirm')
  })

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn()
    const d = dialog({ title: rawText('Confirm'), onClose })
    document.body.append(d.element)

    d.element.dispatchEvent(new Event('cancel', { cancelable: true }))

    expect(onClose).toHaveBeenCalledOnce()
  })

  // A dialog that cannot be dismissed must not be dismissible by Escape either.
  it('refuses Escape when there is no way to close it', () => {
    const d = dialog({ title: rawText('Loading') })
    document.body.append(d.element)
    const event = new Event('cancel', { cancelable: true })

    d.element.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
  })
})

describe('searchBox', () => {
  it('ties its label to the input', () => {
    const node = searchBox({ label: rawText('Search'), onChange: () => {} })
    const input = node.querySelector('input')

    expect(node.querySelector('label')?.getAttribute('for')).toBe(input?.id)
    expect(input?.id).not.toBe('')
  })

  it('reports what was typed', () => {
    const onChange = vi.fn()
    const node = searchBox({ label: rawText('Search'), onChange })
    const input = node.querySelector('input')
    if (input !== null) {
      input.value = 'vault'
      input.dispatchEvent(new Event('input'))
    }

    expect(onChange).toHaveBeenCalledWith('vault')
  })
})

describe('installUnits', () => {
  it('sets the unit custom property from the viewport', () => {
    const listeners: Record<string, () => void> = {}
    const view = {
      innerWidth: 1920,
      innerHeight: 1080,
      addEventListener: ((name: string, fn: () => void) => {
        listeners[name] = fn
      }) as Window['addEventListener'],
      removeEventListener: (() => {}) as Window['removeEventListener'],
    }

    const stop = installUnits(document.documentElement, view)

    expect(document.documentElement.style.getPropertyValue('--u')).toBe('36px')
    expect(document.documentElement.style.getPropertyValue('--width-units')).toBe('53.333')

    // The C# explicitly gives up on resizing; this follows the window.
    view.innerHeight = 720
    listeners.resize?.()
    expect(document.documentElement.style.getPropertyValue('--u')).toBe(
      `${pixelsPerUnit({ widthPx: 1920, heightPx: 720 })}px`,
    )

    stop()
  })
})

describe('selectionList', () => {
  const items = itemsFrom([
    { key: 'a', display: 'Alpha', traits: { Type: ['Monster'] } },
    { key: 'b', display: 'Beta', traits: { Type: ['Item'] } },
    { key: 'c', display: 'Gamma', traits: { Type: ['Monster'] } },
  ])

  const make = (onSelect = vi.fn()): ReturnType<typeof selectionList> =>
    selectionList({
      items,
      onSelect,
      label: rawText('Quests'),
      searchLabel: rawText('Search'),
      emptyMessage: rawText('Nothing matches'),
    })

  it('shows everything before any filtering', () => {
    expect(
      make()
        .visibleItems()
        .map((i) => i.key),
    ).toEqual(['a', 'b', 'c'])
  })

  it('renders a filter control per trait', () => {
    const ui = make()

    expect([...ui.element.querySelectorAll('.vk-trait')].map((n) => n.textContent)).toEqual([
      'Monster',
      'Item',
    ])
  })

  it('cycles a trait through neutral, required and excluded', () => {
    const ui = make()
    const monster = ui.element.querySelector<HTMLButtonElement>('.vk-trait')

    monster?.click()
    expect(ui.visibleItems().map((i) => i.key)).toEqual(['a', 'c'])

    ui.element.querySelector<HTMLButtonElement>('.vk-trait')?.click()
    expect(ui.visibleItems().map((i) => i.key)).toEqual(['b'])

    ui.element.querySelector<HTMLButtonElement>('.vk-trait')?.click()
    expect(ui.visibleItems().map((i) => i.key)).toEqual(['a', 'b', 'c'])
  })

  it('filters by the search box', () => {
    const ui = make()
    const input = ui.element.querySelector('input')
    if (input !== null) {
      input.value = 'gam'
      input.dispatchEvent(new Event('input'))
    }

    expect(ui.element.querySelector('.vk-list')?.textContent).toBe('Gamma')
  })

  it('announces the result count politely', () => {
    const ui = make()

    expect(ui.element.querySelector('[aria-live="polite"]')?.textContent).toBe('3')
  })

  it('shows the empty message when nothing matches', () => {
    const ui = make()
    const input = ui.element.querySelector('input')
    if (input !== null) {
      input.value = 'nothing like this'
      input.dispatchEvent(new Event('input'))
    }

    expect(ui.element.querySelector('.vk-list--empty')?.textContent).toBe('Nothing matches')
  })

  it('reports the chosen item', () => {
    const onSelect = vi.fn()
    const ui = make(onSelect)
    ui.element.querySelector<HTMLElement>('[role="option"]')?.click()

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ key: 'a' }))
  })

  it('applies initial exclusions before the first render', () => {
    const ui = selectionList({
      items,
      onSelect: () => {},
      label: rawText('Quests'),
      searchLabel: rawText('Search'),
      emptyMessage: rawText('Nothing matches'),
      initialExclusions: new Map([['Type', ['Monster']]]),
    })

    expect(ui.visibleItems().map((i) => i.key)).toEqual(['b'])
  })
})
