/**
 * What the investigators begin with, replacing `InvestigatorItems.cs`.
 *
 * A display rather than a choice: the item on each investigator's card is
 * fixed, and the ones the scenario grants have already been drawn by
 * selection. The player reads the list, finds those cards in the box, and
 * confirms.
 *
 * The C# groups by the prefix of the section name — `ItemCommon…`,
 * `ItemUnique…` — which is where a Mansions player's own vocabulary of decks
 * comes from, so the grouping is kept.
 */

import { button, label, panel } from '../components.js'
import { clear, el } from '../dom.js'
import { rawText } from '../text.js'
import type { Text } from '../text.js'

export interface StartingItemView {
  id: string
  /** Already translated. */
  name: string
  /** The deck it comes from, e.g. "Common Item". Already translated. */
  group: string
  image?: string
}

export interface StartingItemsStrings {
  title: Text
  hint: Text
  confirm: Text
  empty: Text
}

const DEFAULT_STRINGS: StartingItemsStrings = {
  title: rawText('Starting items'),
  hint: rawText('Find these cards and deal them out before you begin.'),
  confirm: rawText('Ready'),
  empty: rawText('The investigators begin with nothing.'),
}

export interface StartingItemsOptions {
  onConfirm: () => void
  strings?: Partial<StartingItemsStrings>
}

export interface StartingItemsScreen {
  element: HTMLElement
  show: (items: readonly StartingItemView[]) => void
}

export function startingItemsScreen(options: StartingItemsOptions): StartingItemsScreen {
  const strings = { ...DEFAULT_STRINGS, ...options.strings }
  const body = el('div', { class: 'vk-starting__groups' })

  const element = panel({
    class: 'vk-starting',
    children: [
      label(strings.title, { heading: 2, size: 'medium' }),
      label(strings.hint, { class: 'vk-starting__hint' }),
      body,
      button(strings.confirm, { onPress: options.onConfirm, variant: 'primary' }),
    ],
  })

  return {
    element,

    show: (items) => {
      clear(body)
      if (items.length === 0) {
        body.append(label(strings.empty, { class: 'vk-starting__hint' }))
        return
      }

      // Grouped and sorted as the C# sorts them, so two players reading the
      // same list find the cards in the same order.
      const groups = new Map<string, StartingItemView[]>()
      for (const item of items) {
        const into = groups.get(item.group)
        if (into === undefined) groups.set(item.group, [item])
        else into.push(item)
      }

      for (const name of [...groups.keys()].sort()) {
        const group = el('section', { class: 'vk-starting__group' })
        group.append(label(rawText(name), { heading: 3, size: 'small' }))

        const list = el('ul', { class: 'vk-starting__items' })
        for (const item of (groups.get(name) ?? []).sort((a, b) => a.name.localeCompare(b.name))) {
          const entry = el('li', { class: 'vk-starting__item' })
          if (item.image !== undefined) {
            entry.append(
              el('img', { class: 'vk-starting__art', attrs: { src: item.image, alt: '' } }),
            )
          }
          entry.append(el('span', { class: 'vk-starting__name', text: item.name }))
          list.append(entry)
        }
        group.append(list)
        body.append(group)
      }
    },
  }
}
