/**
 * Choosing a save slot, replacing `SaveSelectScreen.cs`.
 *
 * One screen for both directions: picking where to write, and picking what to
 * open. The C# uses the same class with a `save` flag, and the difference is
 * small but real — the autosave is offered to load and withheld from saving,
 * because it is the one slot the game writes for itself.
 */

import { button, label, panel } from '../components.js'
import { clear, el } from '../dom.js'
import { rawText } from '../text.js'
import type { Text } from '../text.js'

/** What one slot holds, as far as the list is concerned. */
export interface SaveSlotView {
  slot: number
  /** Null when the slot is empty. */
  save: {
    questName: string
    /** Already formatted for reading; null when the save did not record one. */
    time: string | null
    /** A thumbnail, if the save carried one. */
    image?: string
  } | null
  /**
   * Why this save cannot be opened — a build too old or too new. It still
   * shows, so the player can see the slot is taken rather than empty.
   */
  rejection?: string | null
}

export interface SaveSelectStrings {
  loadTitle: Text
  saveTitle: Text
  autosave: Text
  slot: Text
  empty: Text
  back: Text
}

const DEFAULT_STRINGS: SaveSelectStrings = {
  loadTitle: rawText('Load a game'),
  saveTitle: rawText('Save the game'),
  autosave: rawText('Autosave'),
  slot: rawText('Save'),
  empty: rawText('Empty'),
  back: rawText('Back'),
}

export interface SaveSelectOptions {
  /** `save` in the C#: writing into a slot, or opening one. */
  mode: 'save' | 'load'
  onSelect: (slot: number) => void
  onBack: () => void
  strings?: Partial<SaveSelectStrings>
}

export interface SaveSelect {
  element: HTMLElement
  show: (slots: readonly SaveSlotView[]) => void
}

export function saveSelect(options: SaveSelectOptions): SaveSelect {
  const strings = { ...DEFAULT_STRINGS, ...options.strings }
  const element = panel({ class: 'vk-saves' })
  const saving = options.mode === 'save'

  return {
    element,
    show: (slots) => {
      clear(element)
      element.append(
        label(saving ? strings.saveTitle : strings.loadTitle, { heading: 2, size: 'large' }),
      )

      const list = el('div', { class: 'vk-saves__list', attrs: { role: 'group' } })
      for (const entry of slots) {
        // `if (i == 0 && save) continue`: the autosave is the game's own, and
        // is not offered as somewhere to put a save by hand.
        if (saving && entry.slot === 0) continue
        list.append(slotRow(entry))
      }
      element.append(list)
      element.append(button(strings.back, { onPress: options.onBack, variant: 'secondary' }))
    },
  }

  function slotRow(entry: SaveSlotView): HTMLElement {
    const name =
      entry.slot === 0 ? strings.autosave : rawText(`${textOf(strings.slot)} ${String(entry.slot)}`)

    // An empty slot can be written to but not opened, so in load mode it is
    // shown and disabled rather than hidden — four slots that stay in the same
    // places are easier to keep track of than a list that grows.
    const usable = saving || (entry.save !== null && (entry.rejection ?? null) === null)

    const row = button(name, {
      onPress: () => {
        options.onSelect(entry.slot)
      },
      class: 'vk-saves__slot',
      ...(usable ? {} : { disabled: true }),
    })

    const detail = el('span', { class: 'vk-saves__detail' })
    if (entry.save === null) {
      detail.append(el('span', { class: 'vk-saves__empty', text: textOf(strings.empty) }))
    } else {
      if (entry.save.image !== undefined) {
        row.prepend(
          el('img', { class: 'vk-saves__thumb', attrs: { src: entry.save.image, alt: '' } }),
        )
      }
      detail.append(el('span', { class: 'vk-saves__quest', text: entry.save.questName }))
      if (entry.save.time !== null) {
        detail.append(el('span', { class: 'vk-saves__time', text: entry.save.time }))
      }
      const rejection = entry.rejection ?? null
      if (rejection !== null) {
        detail.append(el('span', { class: 'vk-saves__rejection', text: rejection }))
      }
    }
    row.append(detail)
    return row
  }
}

/** The components take `Text`; a row composes its own label from parts. */
function textOf(value: Text): string {
  return value.kind === 'raw' ? value.value : value.key.translate()
}
