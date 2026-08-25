/**
 * The screen-space layer a scenario draws its own interface on.
 *
 * `[UI...]` components are how a Mansions scenario opens: a full-bleed
 * background, a journal page, a block of framed text and a button to dismiss
 * them. `Quest.UI` parents each to a Unity canvas sized to the screen and
 * positions it with a RectTransform; here each is an absolutely positioned
 * element over the board, which also gets text rendering for free.
 *
 * Placement itself lives in `layoutQuestUi` so it can be tested without a DOM.
 */

import { colourFromName, layoutQuestUi } from '@valkyrie/core'
import type { QuestUiPlacement } from '@valkyrie/core'
import { el } from './dom.js'
import { pixelsPerUnit } from './units.js'

/** One element to draw, with its art already resolved to a URL. */
export interface QuestUiElement {
  name: string
  /** An image URL, or null for an element that carries text instead. */
  image: string | null
  /** Width over height. For a text element this is the declared `textaspect`. */
  aspect: number
  text: string
  placement: QuestUiPlacement
  /** Multiplier on the layer's base text size. */
  textSize: number
  textColour: string
  backgroundColour: string
  textAlignment: 'top' | 'centre' | 'bottom'
  border: boolean
  clickable: boolean
}

export interface QuestUiLayerOptions {
  onSelect: (name: string) => void
  /** Reports a colour the C# would have warned about. */
  onWarning?: (message: string) => void
}

export interface QuestUiLayer {
  element: HTMLElement
  setElements: (elements: readonly QuestUiElement[]) => void
  destroy: () => void
}

/**
 * A text element's font size, in pixels.
 *
 * `Mathf.RoundToInt(UIScaler.GetPixelsPerUnit() * textSize)`, and a unit is a
 * thirtieth of the screen *height* — the same scale the rest of the UI uses,
 * so a scenario's own text sits at the size its author saw.
 */
export function questUiFontSize(textSize: number, viewportHeight: number): number {
  return Math.round(pixelsPerUnit({ widthPx: 0, heightPx: viewportHeight }) * textSize)
}

export function questUiLayer(options: QuestUiLayerOptions): QuestUiLayer {
  const element = el('div', { class: 'vk-quest-ui' })
  let current: readonly QuestUiElement[] = []
  const warned = new Set<string>()

  const place = (): void => {
    const width = element.clientWidth
    const height = element.clientHeight
    if (width === 0 || height === 0) return
    for (const [index, item] of current.entries()) {
      const node = element.children[index]
      if (!(node instanceof HTMLElement)) continue
      const rect = layoutQuestUi(item.placement, { width, height }, item.aspect)
      node.style.left = `${String(rect.left)}px`
      node.style.top = `${String(rect.top)}px`
      node.style.width = `${String(rect.width)}px`
      node.style.height = `${String(rect.height)}px`
      const text = node.querySelector('.vk-quest-ui__text')
      if (text instanceof HTMLElement) {
        text.style.fontSize = `${String(questUiFontSize(item.textSize, height))}px`
      }
    }
  }

  const colour = (name: string, item: QuestUiElement): string => {
    const value = colourFromName(name)
    if (!/^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value) && !warned.has(name)) {
      warned.add(name)
      options.onWarning?.(`Colour must be #RRGGBB or a known name: ${name} (${item.name})`)
    }
    return value
  }

  const observer =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
          place()
        })
  observer?.observe(element)

  return {
    element,

    setElements(elements) {
      current = elements
      element.replaceChildren()
      for (const item of elements) {
        const node = el('div', { class: 'vk-quest-ui__item' })
        node.style.position = 'absolute'

        if (item.image !== null) {
          const image = el('img', { class: 'vk-quest-ui__image' })
          image.setAttribute('src', item.image)
          image.setAttribute('alt', '')
          node.append(image)
        } else {
          node.style.background = colour(item.backgroundColour, item)
          const text = el('div', { class: 'vk-quest-ui__text' })
          text.textContent = item.text
          text.style.color = colour(item.textColour, item)
          text.style.justifyContent =
            item.textAlignment === 'top'
              ? 'flex-start'
              : item.textAlignment === 'bottom'
                ? 'flex-end'
                : 'center'
          node.append(text)
        }

        if (item.border) node.classList.add('vk-quest-ui__item--border')

        if (item.clickable) {
          node.setAttribute('role', 'button')
          node.setAttribute('tabindex', '0')
          node.classList.add('vk-quest-ui__item--clickable')
          const fire = (): void => {
            options.onSelect(item.name)
          }
          node.addEventListener('click', fire)
          node.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              fire()
            }
          })
        }

        element.append(node)
      }
      place()
    },

    destroy() {
      observer?.disconnect()
      element.replaceChildren()
      current = []
    },
  }
}
