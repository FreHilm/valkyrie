/**
 * The component set the screens need, replacing `unity/Assets/Scripts/UI`.
 *
 * A rewrite rather than a port: 36 of the 37 files there are uGUI-bound, and
 * `UIElement` is an imperative wrapper over things the DOM gives for free.
 * What is carried across is the *unit system* (so ported screens can use the
 * same numbers) and the trait filtering (because its semantics are subtle).
 *
 * Everything user-visible takes a `Text`, never a bare string — see `text.ts`.
 */

import { el } from './dom.js'
import { resolve } from './text.js'
import type { Text } from './text.js'
import type { TextSize } from './units.js'

export interface LabelOptions {
  size?: TextSize
  class?: string | readonly string[]
  /** Renders as a heading at the given level, rather than a paragraph. */
  heading?: 1 | 2 | 3
}

/** Text at one of the sizes `UIScaler`'s comment names: small, medium, large. */
export function label(content: Text, options: LabelOptions = {}): HTMLElement {
  const size = options.size ?? 'small'
  const tag: 'p' | 'h1' | 'h2' | 'h3' = options.heading === undefined ? 'p' : `h${options.heading}`

  // Sizing lives in the stylesheet, keyed off the size class — inline styles
  // would duplicate it and put a unit calculation out of the cascade's reach.
  return el(tag, {
    class: ['vk-text', `vk-text--${size}`, ...toArray(options.class)],
    text: resolve(content),
  })
}

export interface ButtonOptions {
  onPress: () => void
  /** Spoken by a screen reader when the visible label is an icon or a glyph. */
  describedBy?: Text
  disabled?: boolean
  size?: TextSize
  variant?: 'primary' | 'secondary' | 'danger'
  class?: string | readonly string[]
}

/**
 * A button.
 *
 * A real `<button>`, so keyboard activation, focus order and screen-reader
 * semantics come from the platform. The Unity version is a sprite with a click
 * handler and none of that.
 */
export function button(content: Text, options: ButtonOptions): HTMLButtonElement {
  const described = options.describedBy
  return el('button', {
    class: [
      'vk-button',
      `vk-button--${options.variant ?? 'secondary'}`,
      `vk-text--${options.size ?? 'small'}`,
      ...toArray(options.class),
    ],
    text: resolve(content),
    attrs: {
      type: 'button',
      disabled: options.disabled ?? false,
      ...(described === undefined ? {} : { 'aria-label': resolve(described) }),
    },
    on: { click: () => options.onPress() },
  })
}

export interface PanelOptions {
  /** Titles the region for assistive technology as well as sighted readers. */
  title?: Text
  class?: string | readonly string[]
  children?: readonly (Node | null | undefined | false)[]
}

/** A bordered region. `<section>`, labelled when it has a title. */
export function panel(options: PanelOptions = {}): HTMLElement {
  const heading =
    options.title === undefined ? null : label(options.title, { size: 'medium', heading: 2 })
  if (heading !== null) heading.id = uniqueId('vk-panel-title')

  return el('section', {
    class: ['vk-panel', ...toArray(options.class)],
    attrs: heading === null ? {} : { 'aria-labelledby': heading.id },
    children: [heading, ...(options.children ?? [])],
  })
}

export interface ListOptions<T> {
  items: readonly T[]
  render: (item: T, index: number) => Node
  /** Announced to screen readers; a list without one is anonymous. */
  label: Text
  onSelect?: (item: T, index: number) => void
  class?: string | readonly string[]
  emptyMessage?: Text
}

/**
 * A scrolling list.
 *
 * Rendered as a `<ul>` of `<li>`, or as a listbox when it is selectable, so
 * arrow-key navigation and the announced item count come from the platform.
 */
export function list<T>(options: ListOptions<T>): HTMLElement {
  const selectable = options.onSelect !== undefined

  if (options.items.length === 0 && options.emptyMessage !== undefined) {
    return el('div', {
      class: ['vk-list', 'vk-list--empty', ...toArray(options.class)],
      attrs: { 'aria-label': resolve(options.label) },
      children: [label(options.emptyMessage)],
    })
  }

  const rows = options.items.map((item, index) => {
    const content = options.render(item, index)
    const onSelect = options.onSelect
    if (onSelect === undefined) {
      return el('li', { class: 'vk-list__row', children: [content] })
    }
    return el('li', {
      class: ['vk-list__row', 'vk-list__row--selectable'],
      // 'false' as a string: an absent aria-selected means something else.
      attrs: { role: 'option', tabindex: index === 0 ? 0 : -1, 'aria-selected': 'false' },
      children: [content],
      on: {
        click: () => onSelect(item, index),
        keydown: (event) => {
          const key = (event as KeyboardEvent).key
          if (key === 'Enter' || key === ' ') {
            event.preventDefault()
            onSelect(item, index)
          }
        },
      },
    })
  })

  const container = el('ul', {
    class: ['vk-list', ...toArray(options.class)],
    attrs: selectable
      ? { role: 'listbox', 'aria-label': resolve(options.label) }
      : { 'aria-label': resolve(options.label) },
    children: rows,
  })

  if (selectable) roveFocus(container)
  return container
}

/**
 * Arrow-key navigation across a listbox, moving focus rather than selection.
 *
 * `tabindex` roves so the list is one tab stop, which is what a listbox is
 * supposed to be — the Unity list is not reachable by keyboard at all.
 */
function roveFocus(container: HTMLElement): void {
  container.addEventListener('keydown', (event) => {
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    if (step === 0) return

    const rows = [...container.querySelectorAll<HTMLElement>('.vk-list__row--selectable')]
    const current = rows.findIndex((row) => row === document.activeElement)
    const next = rows[Math.min(Math.max(current + step, 0), rows.length - 1)]
    if (next === undefined) return

    event.preventDefault()
    for (const row of rows) row.tabIndex = -1
    next.tabIndex = 0
    next.focus()
  })
}

export interface DialogOptions {
  title: Text
  children?: readonly (Node | null | undefined | false)[]
  /** Called on Escape or on the close control. Omit for a dialog that cannot be dismissed. */
  onClose?: () => void
  closeLabel?: Text
  class?: string | readonly string[]
}

export interface Dialog {
  element: HTMLDialogElement
  open: () => void
  close: () => void
}

/**
 * A modal dialog.
 *
 * `<dialog>` with `showModal()`, so focus trapping, the inert backdrop and
 * Escape-to-close are the browser's job rather than ours.
 */
export function dialog(options: DialogOptions): Dialog {
  const heading = label(options.title, { size: 'medium', heading: 2 })
  heading.id = uniqueId('vk-dialog-title')

  const close = options.onClose
  const closeButton =
    close === undefined || options.closeLabel === undefined
      ? null
      : button(options.closeLabel, {
          onPress: close,
          variant: 'secondary',
          class: 'vk-dialog__close',
        })

  const element = el('dialog', {
    class: ['vk-dialog', ...toArray(options.class)],
    attrs: { 'aria-labelledby': heading.id },
    children: [heading, ...(options.children ?? []), closeButton],
  })

  element.addEventListener('cancel', (event) => {
    if (close === undefined) {
      // A dialog with no dismissal must not be dismissible by Escape either.
      event.preventDefault()
      return
    }
    event.preventDefault()
    close()
  })

  return {
    element,
    open: () => {
      element.showModal()
    },
    close: () => {
      element.close()
    },
  }
}

export interface SearchBoxOptions {
  label: Text
  placeholder?: Text
  onChange: (value: string) => void
  value?: string
}

/** The search field the selection list uses, wired to a real `<label>`. */
export function searchBox(options: SearchBoxOptions): HTMLElement {
  const id = uniqueId('vk-search')
  const input = el('input', {
    class: 'vk-search__input',
    attrs: {
      id,
      type: 'search',
      ...(options.placeholder === undefined ? {} : { placeholder: resolve(options.placeholder) }),
      ...(options.value === undefined ? {} : { value: options.value }),
    },
    on: {
      input: (event) => options.onChange((event.target as HTMLInputElement).value),
    },
  })

  return el('div', {
    class: 'vk-search',
    children: [
      el('label', { class: 'vk-search__label', attrs: { for: id }, text: resolve(options.label) }),
      input,
    ],
  })
}

let counter = 0
function uniqueId(prefix: string): string {
  counter += 1
  return `${prefix}-${counter}`
}

function toArray(value: string | readonly string[] | undefined): readonly string[] {
  if (value === undefined) return []
  return typeof value === 'string' ? [value] : value
}
