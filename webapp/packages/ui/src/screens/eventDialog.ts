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
import type { RichTextOptions } from '../richText.js'

export interface EventButton {
  /** Already translated and symbol-substituted. */
  text: string
  onPress: () => void
  /** Shown but not pressable, for a choice whose condition fails. */
  disabled?: boolean
}

/**
 * An event that asks for a number rather than a choice.
 *
 * `DialogWindow.CreateQuotaWindow` draws a `-` / value / `+` spinner and one
 * button; what the player dials is what the event acts on.
 */
export interface EventQuota {
  /** What the spinner opens on. */
  value: number
  /** `quotaInc` greys out here. */
  max: number
  onSubmit: (value: number) => void
}

export interface EventView {
  /** Already translated. Blank lines separate paragraphs, as the C# does. */
  text: string
  buttons: readonly EventButton[]
  /** Present when the event wants a number; the first button submits it. */
  quota?: EventQuota
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
export function eventDialog(options: { rich?: RichTextOptions } = {}): EventDialog {
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
        body.append(
          label(
            rawText(paragraph.trim()),
            options.rich === undefined ? {} : { rich: options.rich },
          ),
        )
      }

      clear(actions)
      const quota = view.quota
      if (quota !== undefined) {
        drawQuota(actions, quota, view.buttons[0])
        return
      }
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

/**
 * The `-` / value / `+` spinner and the one button that submits it.
 *
 * `quotaDec` greys out at zero and `quotaInc` at ten, which is why the ends
 * are disabled rather than clamped silently — the C# rebuilds the whole
 * window on each press to achieve the same thing.
 */
function drawQuota(into: HTMLElement, quota: EventQuota, action: EventButton | undefined): void {
  let value = Math.max(0, Math.min(quota.max, quota.value))

  const render = (): void => {
    clear(into)
    const spinner = el('div', { class: 'vk-event__quota', attrs: { role: 'group' } })

    spinner.append(
      button(rawText('−'), {
        onPress: () => {
          value--
          render()
        },
        describedBy: rawText('One fewer'),
        disabled: value <= 0,
      }),
    )
    spinner.append(
      el('output', { class: 'vk-event__quota-value', text: String(value) }),
    )
    spinner.append(
      button(rawText('+'), {
        onPress: () => {
          value++
          render()
        },
        describedBy: rawText('One more'),
        disabled: value >= quota.max,
      }),
    )
    into.append(spinner)

    if (action !== undefined) {
      into.append(
        button(rawText(action.text), {
          onPress: () => {
            quota.onSubmit(value)
          },
          variant: 'primary',
        }),
      )
    }
  }

  render()
}
