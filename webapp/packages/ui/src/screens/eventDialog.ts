/**
 * The event dialog — the screen a quest spends most of its time in.
 *
 * Replaces `DialogWindow.cs` and the `Event` presentation in `EventManager`.
 * An event shows some text and a row of buttons; pressing one chains onward
 * through the engine.
 *
 * The C# builds this from sprites and has no keyboard path at all. Here it is
 * a `<dialog>`, so focus trapping and Escape come from the browser.
 */

import { button, label, panel } from '../components.js'
import { clear, el } from '../dom.js'
import { rawText } from '../text.js'
import type { Text } from '../text.js'

export interface EventButton {
  /** Already translated and symbol-substituted. */
  text: string
  onPress: () => void
  /** Shown but not pressable, for a choice whose condition fails. */
  disabled?: boolean
}

export interface EventView {
  /** Already translated. Blank lines separate paragraphs, as the C# does. */
  text: string
  buttons: readonly EventButton[]
  /** Drawn above the text, as `monsterImage` does. */
  image?: CanvasImageSource | string
  title?: Text
}

export interface EventDialog {
  element: HTMLElement
  show: (view: EventView) => void
  clear: () => void
}

/**
 * Creates the event dialog.
 *
 * One element, reused: a quest fires hundreds of events, and rebuilding the
 * dialog each time would lose focus and make the transition flicker.
 */
export function eventDialog(): EventDialog {
  const body = el('div', { class: 'vk-event__text' })
  const actions = el('div', { class: 'vk-event__buttons', attrs: { role: 'group' } })
  const figure = el('div', { class: 'vk-event__image' })

  const element = panel({
    class: 'vk-event',
    children: [figure, body, actions],
  })
  element.setAttribute('aria-live', 'polite')

  return {
    element,
    show: (view) => {
      clear(figure)
      if (typeof view.image === 'string') {
        figure.append(el('img', { attrs: { src: view.image, alt: '' }, class: 'vk-event__img' }))
      }

      clear(body)
      // Blank lines separate paragraphs; the C# renders one text blob and
      // relies on the font. Real paragraphs read better and are selectable.
      for (const paragraph of view.text.split(/\n{2,}/)) {
        if (paragraph.trim().length === 0) continue
        body.append(label(rawText(paragraph.trim())))
      }

      clear(actions)
      for (const action of view.buttons) {
        actions.append(
          button(rawText(action.text), {
            onPress: action.onPress,
            variant: 'primary',
            ...(action.disabled === true ? { disabled: true } : {}),
          }),
        )
      }
    },
    clear: () => {
      clear(figure)
      clear(body)
      clear(actions)
    },
  }
}
