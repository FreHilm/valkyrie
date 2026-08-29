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
import { setRichText } from '../richText.js'
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
  /**
   * The token that was clicked, drawn beside the text where
   * `DialogWindow.DrawItem` puts its card.
   *
   * A URL, already cropped: a token can be one cell of a sheet, and cutting
   * one out is the caller's job because it is the caller that can read the
   * file. Passing the sheet here would draw every token at once.
   */
  icon?: string
  title?: Text
  /**
   * `DialogWindow.onCancel`: closes without answering.
   *
   * Present only for an event the scenario allows to be cancelled — a door, a
   * token, a UI element. Absent for one that has to be answered.
   */
  onCancel?: () => void
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
export interface EventDialogStrings {
  /** `CommonStringKeys.CANCEL`. */
  cancel: Text
}

export function eventDialog(
  options: { rich?: RichTextOptions; strings?: Partial<EventDialogStrings> } = {},
): EventDialog {
  const body = el('div', { class: 'vk-event__text' })
  const actions = el('div', { class: 'vk-event__buttons', attrs: { role: 'group' } })
  const figure = el('div', { class: 'vk-event__image' })
  // The picture and the words sit side by side, as `DrawItem` places them: the
  // card goes to the left of the text box rather than above it.
  const main = el('div', { class: 'vk-event__main', children: [figure, body] })

  const element = panel({
    class: 'vk-event',
    children: [main, actions],
  })
  element.setAttribute('aria-live', 'polite')

  return {
    element,
    show: (view) => {
      clear(figure)
      if (typeof view.image === 'string') {
        figure.append(el('img', { attrs: { src: view.image, alt: '' }, class: 'vk-event__img' }))
      }
      if (view.icon !== undefined) figure.append(drawIcon(view.icon))
      figure.classList.toggle('vk-event__image--empty', figure.childNodes.length === 0)

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
        actions.classList.remove('vk-event__buttons--paired')
        drawQuota(actions, quota, view.buttons[0], options.rich ?? {})
        drawCancel(actions, view.onCancel, options.strings?.cancel)
        return
      }

      // `CreateWindow` puts the cancel at x 11 and a single short choice at
      // the right edge of the *same* row, and only drops it below when a label
      // outgrows the default width. One choice beside one way out is the case
      // that fits; anything more becomes the column the C# falls back to.
      const paired = view.onCancel !== undefined && view.buttons.length === 1
      actions.classList.toggle('vk-event__buttons--paired', paired)

      // Cancel leads in that row, as its x of 11 puts it left of the choice.
      // In the column it comes last, where `offsetCancel` drops it below them.
      if (paired) drawCancel(actions, view.onCancel, options.strings?.cancel)

      for (const action of view.buttons) {
        const control = button(rawText(action.text), {
          onPress: action.onPress,
          ...(action.disabled === true ? { disabled: true } : {}),
        })
        // A label carries symbols too: an action-costing button is written
        // "{action} Search" and reaches here as a private-use codepoint. Left
        // as plain text it draws a blank box, which is what a font the browser
        // does not have looks like.
        setRichText(control, action.text, options.rich ?? {})
        actions.append(control)
      }

      if (!paired) drawCancel(actions, view.onCancel, options.strings?.cancel)
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
/**
 * The Cancel button, drawn last so it reads as the way out rather than a
 * choice among the others.
 *
 * `DialogWindow` places it apart from the button column for the same reason,
 * and only draws it when the event is cancelable.
 */
function drawCancel(into: HTMLElement, onCancel: (() => void) | undefined, text?: Text): void {
  if (onCancel === undefined) return
  into.append(button(text ?? rawText('Cancel'), { onPress: onCancel, class: 'vk-event__cancel' }))
}

/**
 * The picture beside the text: the token the player clicked.
 *
 * Decorative, and deliberately so — the dialog's own words say what was
 * clicked, and a screen reader announcing "search token" before them would be
 * repeating the sentence that follows.
 */
function drawIcon(url: string): HTMLElement {
  return el('span', {
    class: 'vk-event__icon',
    children: [el('img', { class: 'vk-event__icon-art', attrs: { src: url, alt: '' } })],
  })
}

/** A button whose label may carry symbols, which plain text would blank out. */
function richButton(text: string, onPress: () => void, rich: RichTextOptions = {}): HTMLElement {
  const control = button(rawText(text), { onPress, variant: 'primary' })
  setRichText(control, text, rich)
  return control
}

function drawQuota(
  into: HTMLElement,
  quota: EventQuota,
  action: EventButton | undefined,
  rich: RichTextOptions,
): void {
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
    spinner.append(el('output', { class: 'vk-event__quota-value', text: String(value) }))
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
        richButton(
          action.text,
          () => {
            quota.onSubmit(value)
          },
          rich,
        ),
      )
    }
  }

  render()
}
