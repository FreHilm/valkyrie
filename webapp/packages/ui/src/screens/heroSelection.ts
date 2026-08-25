/**
 * Hero and investigator selection.
 *
 * Replaces the hero-selection screens in `unity/Assets/Scripts/UI/Screens`.
 * Both game types use the same shape — a grid of portraits with a count to
 * reach — so one component serves Descent heroes and Mansions investigators.
 */

import { button, label, panel } from '../components.js'
import { clear, el } from '../dom.js'
import { rawText, resolve } from '../text.js'
import type { Text } from '../text.js'

export interface Selectable {
  id: string
  /** Already translated. */
  name: string
  image?: string
}

export interface HeroSelectionOptions {
  available: readonly Selectable[]
  /** How many must be chosen before the quest can start. */
  required: number
  title: Text
  confirmLabel: Text
  countLabel: (chosen: number, required: number) => string
  onConfirm: (chosen: readonly string[]) => void
}

export interface HeroSelection {
  element: HTMLElement
  chosen: () => string[]
}

export function heroSelection(options: HeroSelectionOptions): HeroSelection {
  const chosen = new Set<string>()
  const grid = el('div', { class: 'vk-heroes', attrs: { role: 'group' } })
  const count = el('p', { class: 'vk-heroes__count', attrs: { 'aria-live': 'polite' } })

  const confirm = button(options.confirmLabel, {
    onPress: () => options.onConfirm([...chosen]),
    variant: 'primary',
    disabled: true,
  })

  const render = (): void => {
    clear(grid)
    for (const hero of options.available) {
      const picked = chosen.has(hero.id)
      const tile = el('button', {
        class: ['vk-hero', picked ? 'vk-hero--chosen' : ''],
        attrs: {
          type: 'button',
          // A toggle, so a screen reader announces the state rather than
          // relying on the border colour the Unity version uses alone. The
          // string matters: an absent aria-pressed is not the same as "false".
          'aria-pressed': picked ? 'true' : 'false',
        },
        children: [
          hero.image === undefined
            ? null
            : el('img', { attrs: { src: hero.image, alt: '' }, class: 'vk-hero__portrait' }),
          label(rawText(hero.name), { class: 'vk-hero__name' }),
        ],
        on: {
          click: () => {
            if (picked) chosen.delete(hero.id)
            else if (chosen.size < options.required) chosen.add(hero.id)
            render()
          },
        },
      })
      grid.append(tile)
    }

    count.textContent = options.countLabel(chosen.size, options.required)
    confirm.disabled = chosen.size !== options.required
  }

  render()

  return {
    element: panel({
      title: options.title,
      class: 'vk-hero-select',
      children: [grid, count, confirm],
    }),
    chosen: () => [...chosen],
  }
}

export { resolve }
