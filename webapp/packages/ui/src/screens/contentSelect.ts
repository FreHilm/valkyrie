/**
 * The content selection screen, replacing `ContentSelectScreen.cs`.
 *
 * Which boxes the player owns. It is not a cosmetic filter: a scenario tests
 * `#<packId>` to decide what it may ask the player to put on the table, so
 * loading everything found on disk tells every quest the player owns the lot.
 *
 * The base pack is shown but cannot be turned off — `Select` refuses to
 * deselect it, and the game loads it before this screen exists.
 *
 * DEVIATION: the C# also offers a per-pack translation language and a link to
 * a download screen for packs not installed. Neither is here yet; the language
 * dropdown needs the per-pack dictionaries the config already stores, and the
 * download screen is `ContentSelectDownloadScreen`, a screen of its own.
 */

import { button, label, panel } from '../components.js'
import { clear, el } from '../dom.js'
import { rawText } from '../text.js'
import type { Text } from '../text.js'

/** One pack the player may own. */
export interface SelectablePackView {
  id: string
  /** Already translated: pack names are `{ffg:…}` keys in content. */
  name: string
  /** `type`: "box", "ck" for a conversion kit, "ft" for a figure pack. */
  type: string
  /** Cover art, when the pack declares one. */
  image?: string
}

export interface ContentSelectView {
  packs: readonly SelectablePackView[]
  /** The ids currently selected. */
  selected: ReadonlySet<string>
  /** The pack that cannot be turned off. */
  baseId: string
}

export interface ContentSelectStrings {
  title: Text
  hint: Text
  included: Text
  close: Text
  on: Text
  off: Text
  base: Text
  empty: Text
}

const DEFAULT_STRINGS: ContentSelectStrings = {
  title: rawText('Content'),
  hint: rawText('Choose the boxes you own. Scenarios ask for what they need.'),
  included: rawText('Always included'),
  close: rawText('Close'),
  on: rawText('Owned'),
  off: rawText('Not owned'),
  base: rawText('Base game'),
  empty: rawText('No content packs found. Import your game files first.'),
}

export interface ContentSelectOptions {
  onToggle: (id: string) => void
  onClose: () => void
  strings?: Partial<ContentSelectStrings>
}

export interface ContentSelect {
  element: HTMLElement
  show: (view: ContentSelectView) => void
}

export function contentSelect(options: ContentSelectOptions): ContentSelect {
  const strings = { ...DEFAULT_STRINGS, ...options.strings }
  const list = el('div', { class: 'vk-packs' })
  const element = panel({
    class: 'vk-content-select',
    children: [
      label(strings.title, { heading: 2, size: 'medium' }),
      label(strings.hint, { class: 'vk-content-select__hint' }),
      list,
      button(strings.close, { onPress: options.onClose, variant: 'secondary' }),
    ],
  })

  return {
    element,

    show: (view) => {
      clear(list)
      if (view.packs.length === 0) {
        list.append(label(strings.empty, { class: 'vk-content-select__hint' }))
        return
      }

      for (const pack of view.packs) {
        const isBase = pack.id === view.baseId
        const on = isBase || view.selected.has(pack.id)

        const card = el('button', {
          class: on ? ['vk-pack', 'vk-pack--on'] : ['vk-pack'],
          attrs: {
            type: 'button',
            // A toggle, so it is announced as one and reads its own state.
            role: 'switch',
            // Spelled out: an ARIA state is not an HTML boolean, and a bare
            // `aria-checked` would read as unset rather than as false.
            'aria-checked': on ? 'true' : 'false',
            ...(isBase ? { disabled: true } : {}),
          },
        })

        if (pack.image !== undefined) {
          card.append(el('img', { class: 'vk-pack__art', attrs: { src: pack.image, alt: '' } }))
        }
        card.append(el('span', { class: 'vk-pack__name', text: pack.name }))
        card.append(
          el('span', {
            class: 'vk-pack__state',
            text: resolveState(isBase ? strings.included : on ? strings.on : strings.off),
          }),
        )

        if (!isBase) {
          card.addEventListener('click', () => {
            options.onToggle(pack.id)
          })
        }
        list.append(card)
      }
    },
  }
}

/** The state line is the one place a raw string is needed rather than a node. */
function resolveState(value: Text): string {
  return value.kind === 'raw' ? value.value : value.key.translate()
}
