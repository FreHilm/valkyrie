/**
 * @vitest-environment happy-dom
 *
 * Tests for the quest log and inventory screens (T-018).
 *
 * `LogWindow.cs` and `InventoryWindowMoM.cs` have no tests. What is asserted
 * here is the filtering that decides what a player sees versus what a scenario
 * author sees, and the item inspection that queues a scenario's clue events.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { inventory } from '../src/screens/inventory.js'
import { questLog } from '../src/screens/questLog.js'

beforeEach(() => {
  document.body.replaceChildren()
})

const buttons = (root: HTMLElement): HTMLButtonElement[] => [...root.querySelectorAll('button')]

const press = (root: HTMLElement, name: string): void => {
  const target = buttons(root).find((b) => b.textContent?.includes(name))
  if (target === undefined) throw new Error(`no button matching ${name}`)
  target.click()
}

const ENTRIES = [
  { text: 'You enter the hallway.', editor: false },
  { text: 'Notice: Adding quest var: #round', editor: true },
  { text: 'The door slams shut.', editor: false },
]

describe('questLog', () => {
  function make(options: Parameters<typeof questLog>[0] = { onClose: vi.fn() }) {
    const log = questLog(options)
    document.body.append(log.element)
    log.show({ entries: ENTRIES, variables: [{ name: '#round', value: 3 }] })
    return log
  }

  it('shows the player entries and hides the editor notices', () => {
    const log = make()
    const items = [...log.element.querySelectorAll('li')].map((li) => li.textContent)

    expect(items).toEqual(['You enter the hallway.', 'The door slams shut.'])
  })

  it('reveals the editor notices in the developer view', () => {
    const log = make({ onClose: vi.fn(), developer: true })
    const items = [...log.element.querySelectorAll('li')].map((li) => li.textContent)

    expect(items).toContain('Notice: Adding quest var: #round')
  })

  it('toggles the developer view and announces its state', () => {
    const log = make()
    const toggle = buttons(log.element).find((b) => b.textContent === 'Developer view')

    expect(toggle?.getAttribute('aria-pressed')).toBe('false')
    toggle?.click()
    expect(log.developer()).toBe(true)
    const after = buttons(log.element).find((b) => b.textContent === 'Developer view')
    expect(after?.getAttribute('aria-pressed')).toBe('true')
  })

  it('turns a saved entry’s escaped newlines back into real ones', () => {
    const log = questLog({ onClose: vi.fn() })
    document.body.append(log.element)
    log.show({ entries: [{ text: 'Line one\\nLine two', editor: false }], variables: [] })

    expect(log.element.querySelector('li')?.textContent).toBe('Line one\nLine two')
  })

  it('says so when nothing has happened yet', () => {
    const log = questLog({ onClose: vi.fn() })
    document.body.append(log.element)
    log.show({ entries: [], variables: [] })

    expect(log.element.textContent).toContain('Nothing has happened yet.')
  })

  it('treats a log of only editor notices as empty for a player', () => {
    const log = questLog({ onClose: vi.fn() })
    document.body.append(log.element)
    log.show({ entries: [{ text: 'Notice: something', editor: true }], variables: [] })

    expect(log.element.textContent).toContain('Nothing has happened yet.')
  })

  it('closes', () => {
    const onClose = vi.fn()
    const log = make({ onClose })
    press(log.element, 'Close')

    expect(onClose).toHaveBeenCalledOnce()
  })

  describe('the developer variable editor', () => {
    it('lists variables only in the developer view', () => {
      expect(make().element.textContent).not.toContain('Variables')
      expect(make({ onClose: vi.fn(), developer: true }).element.textContent).toContain('Variables')
    })

    it('reports an edited value', () => {
      const onSetVariable = vi.fn()
      const log = make({ onClose: vi.fn(), developer: true, onSetVariable })
      const input = log.element.querySelector('input')
      if (input === null) throw new Error('no variable input')
      input.value = '7'
      press(log.element, 'Set value')

      expect(onSetVariable).toHaveBeenCalledWith('#round', 7)
    })

    it('treats an unparseable value as zero, as float.TryParse does', () => {
      const onSetVariable = vi.fn()
      const log = make({ onClose: vi.fn(), developer: true, onSetVariable })
      const input = log.element.querySelector('input')
      if (input === null) throw new Error('no variable input')
      input.value = 'not a number'
      press(log.element, 'Set value')

      expect(onSetVariable).toHaveBeenCalledWith('#round', 0)
    })

    it('labels each input, so the name is not carried by position alone', () => {
      const log = make({ onClose: vi.fn(), developer: true })
      const input = log.element.querySelector('input')
      const forLabel = log.element.querySelector('label')

      expect(forLabel?.getAttribute('for')).toBe(input?.id)
      expect(forLabel?.textContent).toBe('#round')
    })
  })
})

describe('inventory', () => {
  const ITEMS = [
    { id: 'QItemKey', name: 'A rusted key' },
    { id: 'QItemDiary', name: 'A water-stained diary', image: 'diary.webp' },
  ]

  function make(onInspect = vi.fn(), onClose = vi.fn()) {
    const view = inventory({ onInspect, onClose })
    document.body.append(view.element)
    view.show(ITEMS)
    return { view, onInspect, onClose }
  }

  it('shows one control per item, carrying its name', () => {
    const { view } = make()
    const cards = [...view.element.querySelectorAll('.vk-inventory__item')]

    expect(cards.map((c) => c.textContent)).toEqual(['A rusted key', 'A water-stained diary'])
  })

  it('inspects by section name, which is what the event engine needs', () => {
    const { view, onInspect } = make()
    press(view.element, 'A water-stained diary')

    expect(onInspect).toHaveBeenCalledWith('QItemDiary')
  })

  it('gives the art an empty alt, because the name is already there', () => {
    const { view } = make()
    const image = view.element.querySelector('img')

    expect(image?.getAttribute('alt')).toBe('')
    expect(image?.getAttribute('src')).toBe('diary.webp')
  })

  it('says so when there is nothing to examine', () => {
    const view = inventory({ onInspect: vi.fn(), onClose: vi.fn() })
    document.body.append(view.element)
    view.show([])

    expect(view.element.textContent).toContain('carrying nothing to examine')
  })

  it('closes', () => {
    const { view, onClose } = make()
    press(view.element, 'Close')

    expect(onClose).toHaveBeenCalledOnce()
  })
})
