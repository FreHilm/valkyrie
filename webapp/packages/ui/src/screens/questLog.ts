/**
 * The quest log, replacing `LogWindow.cs`.
 *
 * A scrolling account of what has happened, plus a developer view that lists
 * every quest variable and lets one be edited — which is how a scenario author
 * debugs a stuck quest without replaying it.
 *
 * The C# renders each entry into a fixed-height box it measures by hand, on a
 * white background because "font rendering is broken". Here it is a list, so
 * text wraps, selects and scales on its own.
 */

import { button, label, panel } from '../components.js'
import { clear, el } from '../dom.js'
import { rawText } from '../text.js'
import type { Text } from '../text.js'
import { setRichText } from '../richText.js'
import type { RichTextOptions } from '../richText.js'

/** One line of the log, already filtered for the current audience. */
export interface LogLine {
  text: string
  /** Editor notices, shown only in the developer view. */
  editor: boolean
}

export interface QuestVariable {
  name: string
  value: number
}

export interface QuestLogView {
  entries: readonly LogLine[]
  /** Quest variables, shown only in the developer view. */
  variables: readonly QuestVariable[]
}

export interface QuestLogStrings {
  title: Text
  close: Text
  developer: Text
  variables: Text
  empty: Text
  setValue: Text
}

const DEFAULT_STRINGS: QuestLogStrings = {
  title: rawText('Quest log'),
  close: rawText('Close'),
  developer: rawText('Developer view'),
  variables: rawText('Variables'),
  empty: rawText('Nothing has happened yet.'),
  setValue: rawText('Set value'),
}

export interface QuestLogOptions {
  onClose: () => void
  /** Sets a variable from the developer view. */
  onSetVariable?: (name: string, value: number) => void
  /** Whether the developer view starts open — `Game.testMode` in the C#. */
  developer?: boolean
  /** The entries are the same prose the dialogs showed, so they read the same. */
  rich?: RichTextOptions
  strings?: Partial<QuestLogStrings>
}

export interface QuestLog {
  element: HTMLElement
  show: (view: QuestLogView) => void
  /** Whether the developer view is open, for tests and for a save to restore. */
  developer: () => boolean
}

export function questLog(options: QuestLogOptions): QuestLog {
  const strings = { ...DEFAULT_STRINGS, ...options.strings }
  const element = panel({ class: 'vk-log' })
  let developer = options.developer ?? false
  let current: QuestLogView = { entries: [], variables: [] }

  function render(): void {
    clear(element)
    element.append(label(strings.title, { heading: 2, size: 'medium' }))

    const controls = el('div', { class: 'vk-log__controls', attrs: { role: 'group' } })
    const toggle = button(strings.developer, {
      onPress: () => {
        developer = !developer
        render()
      },
    })
    toggle.setAttribute('aria-pressed', developer ? 'true' : 'false')
    controls.append(toggle)
    controls.append(button(strings.close, { onPress: options.onClose }))
    element.append(controls)

    // Editor notices are for a scenario author, not a player. The C# hides
    // them by returning "" from GetEntry; here they are simply not rendered.
    const visible = current.entries.filter((entry) => developer || !entry.editor)
    if (visible.length === 0) {
      element.append(label(strings.empty, { class: 'vk-log__empty' }))
    } else {
      const list = el('ol', { class: 'vk-log__entries' })
      for (const entry of visible) {
        const item = el('li', {
          class: entry.editor ? ['vk-log__entry', 'vk-log__entry--editor'] : 'vk-log__entry',
        })
        // A saved entry carries escaped newlines; they become real ones here.
        setRichText(item, entry.text.split('\\n').join('\n'), options.rich ?? {})
        list.append(item)
      }
      element.append(list)
    }

    if (developer) element.append(variableList())
  }

  function variableList(): HTMLElement {
    const section = el('section', { class: 'vk-log__vars' })
    section.append(label(strings.variables, { heading: 3 }))

    const list = el('div', { class: 'vk-log__var-list' })
    for (const variable of current.variables) {
      const row = el('div', { class: 'vk-log__var' })
      const id = `vk-var-${variable.name.replace(/[^a-zA-Z0-9]/g, '-')}`
      row.append(el('label', { text: variable.name, attrs: { for: id } }))

      const input = el('input', {
        class: 'vk-log__var-value',
        attrs: { id, type: 'number', step: 'any', value: String(variable.value) },
      })
      row.append(input)
      row.append(
        button(strings.setValue, {
          onPress: () => {
            // An unparseable value becomes 0, as float.TryParse does.
            const parsed = Number.parseFloat(input.value)
            options.onSetVariable?.(variable.name, Number.isNaN(parsed) ? 0 : parsed)
          },
        }),
      )
      list.append(row)
    }
    section.append(list)
    return section
  }

  return {
    element,
    show: (view) => {
      current = view
      render()
    },
    developer: () => developer,
  }
}
