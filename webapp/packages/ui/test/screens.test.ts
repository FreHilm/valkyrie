/**
 * @vitest-environment happy-dom
 *
 * Tests for the play-mode screens (T-018).
 *
 * The Unity originals are sprite hierarchies with no tests and no keyboard
 * path. What is asserted here is what the port adds: real controls, announced
 * state, and the text handling an event's body needs.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { eventDialog } from '../src/screens/eventDialog.js'
import { heroSelection } from '../src/screens/heroSelection.js'
import { mainMenu, questDetails, questSelection } from '../src/screens/mainMenu.js'
import { itemsFrom } from '../src/selectionList.js'
import { rawText } from '../src/text.js'

beforeEach(() => {
  document.body.replaceChildren()
})

describe('eventDialog', () => {
  it('splits the body on blank lines, as the quest text intends', () => {
    const dialog = eventDialog()
    dialog.show({ text: 'First para.\n\nSecond para.', buttons: [] })

    const paragraphs = dialog.element.querySelectorAll('.vk-event__text p')
    expect([...paragraphs].map((p) => p.textContent)).toEqual(['First para.', 'Second para.'])
  })

  it('ignores empty paragraphs from trailing newlines', () => {
    const dialog = eventDialog()
    dialog.show({ text: 'Only one.\n\n\n\n', buttons: [] })

    expect(dialog.element.querySelectorAll('.vk-event__text p')).toHaveLength(1)
  })

  it('renders each choice as a real button', () => {
    const onPress = vi.fn()
    const dialog = eventDialog()
    dialog.show({ text: 'Choose.', buttons: [{ text: 'Open it', onPress }] })

    const control = dialog.element.querySelector<HTMLButtonElement>('.vk-event__buttons button')
    expect(control?.tagName).toBe('BUTTON')
    control?.click()
    expect(onPress).toHaveBeenCalledOnce()
  })

  it('shows a choice whose condition fails, but disabled', () => {
    const dialog = eventDialog()
    dialog.show({ text: 'x', buttons: [{ text: 'Locked', onPress: () => {}, disabled: true }] })

    expect(dialog.element.querySelector<HTMLButtonElement>('button')?.disabled).toBe(true)
  })

  // The dialog is reused across hundreds of events; rebuilding it would lose
  // focus and flicker.
  it('replaces its contents rather than appending on the next event', () => {
    const dialog = eventDialog()
    dialog.show({ text: 'First', buttons: [{ text: 'A', onPress: () => {} }] })
    dialog.show({ text: 'Second', buttons: [{ text: 'B', onPress: () => {} }] })

    expect(dialog.element.querySelectorAll('.vk-event__text p')).toHaveLength(1)
    expect(dialog.element.querySelectorAll('.vk-event__buttons button')).toHaveLength(1)
    expect(dialog.element.textContent).toContain('Second')
  })

  it('announces itself politely, so new text is read out', () => {
    expect(eventDialog().element.getAttribute('aria-live')).toBe('polite')
  })
})

describe('heroSelection', () => {
  const available = [
    { id: 'a', name: 'Agnes Baker' },
    { id: 'b', name: 'Bob Jenkins' },
    { id: 'c', name: 'Carolyn Fern' },
  ]

  const make = (onConfirm = vi.fn(), minimum = 2, maximum = minimum) =>
    heroSelection({
      available,
      minimum,
      maximum,
      title: rawText('Choose investigators'),
      confirmLabel: rawText('Start'),
      countLabel: (chosen, low, high) => `${chosen} of ${low}-${high}`,
      onConfirm,
    })

  it('announces each portrait as a toggle, not just a coloured border', () => {
    const ui = make()
    const first = ui.element.querySelector('.vk-hero')

    expect(first?.getAttribute('aria-pressed')).toBe('false')
  })

  it('selects and deselects', () => {
    const ui = make()
    const first = () => ui.element.querySelector<HTMLButtonElement>('.vk-hero')

    first()?.click()
    expect(ui.chosen()).toEqual(['a'])
    expect(first()?.getAttribute('aria-pressed')).toBe('true')

    first()?.click()
    expect(ui.chosen()).toEqual([])
  })

  it('refuses to select more than the quest has room for', () => {
    const ui = make(vi.fn(), 1, 2)
    for (const tile of ui.element.querySelectorAll<HTMLButtonElement>('.vk-hero')) tile.click()

    expect(ui.chosen()).toHaveLength(2)
  })

  it('lets a party anywhere inside the quest’s range play', () => {
    // `HeroCanvas.EndSelection` refuses below `minhero` and enforces nothing
    // above: the ceiling is how many slots the quest made. A three-to-five
    // scenario is playable by three, and by five.
    const ui = make(vi.fn(), 1, 3)
    const tiles = () => ui.element.querySelectorAll<HTMLButtonElement>('.vk-hero')
    const confirm = () => [...ui.element.querySelectorAll<HTMLButtonElement>('button')].at(-1)

    expect(confirm()?.disabled).toBe(true)
    tiles()[0]?.click()
    expect(confirm()?.disabled).toBe(false)
    tiles()[1]?.click()
    expect(confirm()?.disabled).toBe(false)
    tiles()[2]?.click()
    expect(ui.chosen()).toHaveLength(3)
    expect(confirm()?.disabled).toBe(false)
  })

  it('keeps the confirm button disabled until there are enough', () => {
    const ui = make()
    const confirm = () => [...ui.element.querySelectorAll<HTMLButtonElement>('button')].at(-1)

    expect(confirm()?.disabled).toBe(true)
    ui.element.querySelector<HTMLButtonElement>('.vk-hero')?.click()
    expect(confirm()?.disabled).toBe(true)
    ui.element.querySelectorAll<HTMLButtonElement>('.vk-hero')[1]?.click()
    expect(confirm()?.disabled).toBe(false)
  })

  it('reports the chosen heroes', () => {
    const onConfirm = vi.fn()
    const ui = make(onConfirm)
    const tiles = ui.element.querySelectorAll<HTMLButtonElement>('.vk-hero')
    tiles[0]?.click()
    tiles[2]?.click()
    ;[...ui.element.querySelectorAll<HTMLButtonElement>('button')].at(-1)?.click()

    expect(onConfirm).toHaveBeenCalledWith(['a', 'c'])
  })

  it('announces the running count politely', () => {
    const ui = make()
    expect(ui.element.querySelector('[aria-live="polite"]')?.textContent).toBe('0 of 2-2')
  })
})

describe('mainMenu', () => {
  it('renders one button per action', () => {
    const play = vi.fn()
    const menu = mainMenu({
      title: rawText('Valkyrie'),
      actions: [
        { label: rawText('Play'), onPress: play },
        { label: rawText('Editor'), onPress: () => {} },
      ],
    })

    const buttons = menu.querySelectorAll<HTMLButtonElement>('button')
    expect(buttons).toHaveLength(2)
    buttons[0]?.click()
    expect(play).toHaveBeenCalledOnce()
  })

  it('disables an action that is not available yet', () => {
    const menu = mainMenu({
      title: rawText('Valkyrie'),
      actions: [{ label: rawText('Continue'), onPress: () => {}, disabled: true }],
    })

    expect(menu.querySelector<HTMLButtonElement>('button')?.disabled).toBe(true)
  })
})

describe('questSelection', () => {
  const quests = itemsFrom([
    { key: 'q1', display: 'The Deep Vault', traits: { Type: ['Official'] } },
    { key: 'q2', display: 'Gangs of Arkham', traits: { Type: ['Community'] } },
  ])

  it('lists the quests and reports the one picked', () => {
    const onPick = vi.fn()
    const screen = questSelection({
      quests,
      onPick,
      title: rawText('Quests'),
      searchLabel: rawText('Search'),
      emptyMessage: rawText('None'),
    })

    expect(screen.textContent).toContain('The Deep Vault')
    // Rows are sorted by display text, so Gangs of Arkham leads.
    screen.querySelector<HTMLElement>('[role="option"]')?.click()
    expect(onPick).toHaveBeenCalledWith('q2')
  })

  it('offers the trait filters the ported logic provides', () => {
    const screen = questSelection({
      quests,
      onPick: () => {},
      title: rawText('Quests'),
      searchLabel: rawText('Search'),
      emptyMessage: rawText('None'),
    })

    expect([...screen.querySelectorAll('.vk-trait')].map((n) => n.textContent)).toEqual([
      'Official',
      'Community',
    ])
  })
})

describe('questSelection as a gallery', () => {
  // The art is how a player recognises a scenario, so the gallery has to keep
  // the cover attached to the right card through the filtering — and stay the
  // same listbox underneath, because that is where the keyboard support is.
  const quests = [
    {
      key: 'vault',
      display: 'The Deep Vault',
      traits: new Map([['Type', ['Official']]]),
      image: 'blob:vault',
      detail: '90–120 min · 3–5 investigators',
    },
    {
      key: 'gangs',
      display: 'Gangs of Arkham',
      traits: new Map([['Type', ['Community']]]),
      detail: '60 min · 2 investigators',
      missingPacks: ['SoT'],
      status: 'Downloaded',
    },
  ]

  const gallery = (overrides = {}) =>
    questSelection({
      quests,
      onPick: () => {},
      title: rawText('Scenarios'),
      searchLabel: rawText('Search'),
      emptyMessage: rawText('None'),
      gallery: true,
      ...overrides,
    })

  it('draws each scenario as a card with its cover', () => {
    const screen = gallery()
    const art = screen.querySelector<HTMLImageElement>('.vk-quest-card__art')

    expect(screen.querySelectorAll('.vk-quest-card')).toHaveLength(2)
    expect(art?.getAttribute('src')).toBe('blob:vault')
    // Decorative: the title beside it already names the scenario.
    expect(art?.getAttribute('alt')).toBe('')
  })

  it('keeps a card without a cover the same shape as one with', () => {
    // A hole in the grid where one scenario ships no art reads as broken.
    const screen = gallery()
    const cards = [...screen.querySelectorAll('.vk-quest-card')]

    expect(cards.every((card) => card.querySelector('.vk-quest-card__frame') !== null)).toBe(true)
    expect(screen.querySelector('.vk-quest-card__initial')?.textContent).toBe('G')
  })

  it('puts the cover on the card it belongs to, whatever the sort order', () => {
    // The list sorts by name, so the cards come back in the other order from
    // the one they were given in. A card showing another scenario's cover is
    // the failure this guards.
    const screen = gallery()
    const cards = [...screen.querySelectorAll('.vk-quest-card')]
    const withArt = cards.find((card) => card.querySelector('.vk-quest-card__art') !== null)

    expect(withArt?.querySelector('.vk-quest-card__name')?.textContent).toBe('The Deep Vault')
  })

  it('shows what a scenario asks of the table', () => {
    expect(gallery().textContent).toContain('90–120 min · 3–5 investigators')
  })

  it('says which packs a scenario is missing', () => {
    const screen = gallery()

    expect(screen.querySelector('.vk-quest-card__badge--missing')?.textContent).toBe('Needs SoT')
    expect(screen.querySelectorAll('.vk-quest-card--missing')).toHaveLength(1)
  })

  it('is still the listbox, so the keyboard still works', () => {
    const screen = gallery()

    expect(screen.querySelector('[role="listbox"]')).not.toBeNull()
    expect(screen.querySelectorAll('[role="option"]')).toHaveLength(2)
  })

  it('lists names rather than cards when the gallery is off', () => {
    const screen = questSelection({
      quests,
      onPick: () => {},
      title: rawText('Scenarios'),
      searchLabel: rawText('Search'),
      emptyMessage: rawText('None'),
    })

    expect(screen.querySelector('.vk-quest-card')).toBeNull()
    expect(screen.textContent).toContain('The Deep Vault')
  })
})

describe('questDetails', () => {
  it('shows the name, description and actions', () => {
    const start = vi.fn()
    const details = questDetails({
      name: 'The Deep Vault',
      description: 'A descent into the dark.',
      actions: [{ label: rawText('Start'), onPress: start }],
    })

    expect(details.textContent).toContain('The Deep Vault')
    expect(details.textContent).toContain('A descent into the dark.')
    details.querySelector<HTMLButtonElement>('button')?.click()
    expect(start).toHaveBeenCalledOnce()
  })

  it('omits the description when there is none', () => {
    const details = questDetails({ name: 'Untitled', actions: [] })

    // The name is a heading; a description would be the only paragraph.
    expect(details.querySelectorAll('p')).toHaveLength(0)
    expect(details.querySelector('h2')?.textContent).toBe('Untitled')
  })
})

describe('eventDialog quota', () => {
  const quotaView = (onSubmit = vi.fn(), value = 0) => ({
    text: 'You search the room.',
    buttons: [{ text: 'Search', onPress: vi.fn() }],
    quota: { value, max: 10, onSubmit },
  })
  const at = (dialog: { element: HTMLElement }, t: string) =>
    [...dialog.element.querySelectorAll('button')].find((b) => b.textContent === t)

  it('draws a spinner and the one button that acts on it', () => {
    // `CreateQuotaWindow` asks for a number, not a choice.
    const dialog = eventDialog()
    dialog.show(quotaView())

    expect([...dialog.element.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      '−',
      '+',
      'Search',
    ])
  })

  it('submits what was dialled, not what it opened on', () => {
    const onSubmit = vi.fn()
    const dialog = eventDialog()
    dialog.show(quotaView(onSubmit))

    at(dialog, '+')?.click()
    at(dialog, '+')?.click()
    at(dialog, 'Search')?.click()

    expect(onSubmit).toHaveBeenCalledWith(2)
  })

  it('opens on the value it was given', () => {
    const dialog = eventDialog()
    dialog.show(quotaView(vi.fn(), 3))

    expect(dialog.element.querySelector('.vk-event__quota-value')?.textContent).toBe('3')
  })

  it('stops at nought and at the top', () => {
    // `quotaDec` greys out at zero and `quotaInc` at ten.
    const dialog = eventDialog()
    dialog.show(quotaView(vi.fn(), 0))

    expect(at(dialog, '−')?.disabled).toBe(true)
    for (let i = 0; i < 10; i++) at(dialog, '+')?.click()
    expect(at(dialog, '+')?.disabled).toBe(true)
    expect(dialog.element.querySelector('.vk-event__quota-value')?.textContent).toBe('10')
  })

  it('leaves an ordinary event with its own buttons', () => {
    const dialog = eventDialog()
    dialog.show({
      text: 'A door.',
      buttons: [
        { text: 'Open it', onPress: vi.fn() },
        { text: 'Leave it', onPress: vi.fn() },
      ],
    })

    expect([...dialog.element.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'Open it',
      'Leave it',
    ])
  })
})

describe('eventDialog symbols in button labels', () => {
  // An action-costing button is written "{action} Search" and reaches the
  // screen as a private-use codepoint — U+F208. Rendered as plain text that
  // draws a blank box, which is exactly what a font the browser does not have
  // looks like, and tells the player nothing.
  const ACTION = ''
  const rich = { symbolOf: (c: string) => (c === ACTION ? 'action' : null) }

  it('turns a symbol in a label into a symbol, not a blank box', () => {
    const dialog = eventDialog({ rich })
    dialog.show({
      text: 'The desk is covered in clutter.',
      buttons: [{ text: `${ACTION} Search`, onPress: vi.fn() }],
    })

    const symbol = dialog.element.querySelector('.vk-symbol--action')
    expect(symbol).not.toBeNull()
    expect(symbol?.getAttribute('aria-label')).toBe('Action')
    expect(dialog.element.querySelector('button')?.textContent).toContain('Search')
  })

  it('leaves a button that costs nothing alone', () => {
    const dialog = eventDialog({ rich })
    dialog.show({ text: 'A choice.', buttons: [{ text: 'Cancel', onPress: vi.fn() }] })

    expect(dialog.element.querySelector('.vk-symbol')).toBeNull()
    expect(dialog.element.querySelector('button')?.textContent).toBe('Cancel')
  })

  it('draws the glyph itself when the game font is there', () => {
    const dialog = eventDialog({ rich: { ...rich, glyphs: true } })
    dialog.show({
      text: 'A choice.',
      buttons: [{ text: `${ACTION} Search`, onPress: vi.fn() }],
    })

    const symbol = dialog.element.querySelector('.vk-symbol--action')
    expect(symbol?.textContent).toBe(ACTION)
    expect(symbol?.getAttribute('aria-label')).toBe('Action')
  })

  it('names it instead when the font is not', () => {
    const dialog = eventDialog({ rich })
    dialog.show({
      text: 'A choice.',
      buttons: [{ text: `${ACTION} Search`, onPress: vi.fn() }],
    })

    expect(dialog.element.querySelector('.vk-symbol--action')?.textContent).toBe('Action')
  })
})
