/**
 * The item inventory, replacing `InventoryWindowMoM.cs`.
 *
 * Every item the party has picked up that can be examined. Pressing one queues
 * its inspect event, which is how a Mansions scenario delivers a clue.
 *
 * The C# lays items out in a horizontal scroller at fixed 9-unit intervals, so
 * a long list runs off the side. A grid wraps instead, which is what a phone
 * needs.
 */

import { button, label, panel } from '../components.js'
import { clear, el } from '../dom.js'
import { rawText } from '../text.js'
import type { Text } from '../text.js'

export interface InventoryItem {
  /** The item's section name, passed back on inspection. */
  id: string
  /** The item's translated name. */
  name: string
  image?: string
}

export interface InventoryStrings {
  title: Text
  close: Text
  empty: Text
}

const DEFAULT_STRINGS: InventoryStrings = {
  title: rawText('Items'),
  close: rawText('Close'),
  empty: rawText('The investigators are carrying nothing to examine.'),
}

export interface InventoryOptions {
  /** `Inspect`: saves, then queues the item's inspect event. */
  onInspect: (id: string) => void
  onClose: () => void
  strings?: Partial<InventoryStrings>
}

export interface Inventory {
  element: HTMLElement
  show: (items: readonly InventoryItem[]) => void
}

export function inventory(options: InventoryOptions): Inventory {
  const strings = { ...DEFAULT_STRINGS, ...options.strings }
  const element = panel({ class: 'vk-inventory' })

  return {
    element,
    show: (items) => {
      clear(element)
      element.append(label(strings.title, { heading: 2, size: 'large' }))

      if (items.length === 0) {
        // The C# shows an empty scroller with no explanation.
        element.append(label(strings.empty, { class: 'vk-inventory__empty' }))
      } else {
        const grid = el('div', { class: 'vk-inventory__grid', attrs: { role: 'group' } })
        for (const item of items) {
          // One button per item carrying both the art and the name, so the
          // whole card is the target rather than two separate ones as the C#
          // builds — and so a screen reader announces it once.
          const card = button(rawText(item.name), {
            onPress: () => options.onInspect(item.id),
            class: 'vk-inventory__item',
          })
          if (item.image !== undefined) {
            card.prepend(
              el('img', {
                class: 'vk-inventory__image',
                attrs: { src: item.image, alt: '' },
              }),
            )
          }
          grid.append(card)
        }
        element.append(grid)
      }

      element.append(button(strings.close, { onPress: options.onClose }))
    },
  }
}
