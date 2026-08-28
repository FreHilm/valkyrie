/**
 * The full-screen announcement between phases, replacing `ChangePhaseWindow.cs`.
 *
 * Not a dialog. It covers the whole board with the phase's own artwork, names
 * the phase, and — for the investigators — lines their portraits up across the
 * middle. Then it takes itself away after three seconds; there is no button,
 * because it is a beat rather than a question.
 *
 * `DisplayTransitionWindow` deliberately leaves whatever dialog is underneath
 * alone: "do NOT delete dialog, they are hidden behind the mythos phase". So
 * this covers rather than replaces, and what was showing is still there when
 * it lifts.
 */

import { el } from '../dom.js'
import { label } from '../components.js'
import type { Text } from '../text.js'

/** How long the announcement stays up. `transition_duration` in the C#. */
export const TRANSITION_SECONDS = 3

export interface PhaseTransitionView {
  /** The phase's name, already translated. */
  name: Text
  /** `ImageGreenBG` or `ImageMythosBackground`, or null when the art is absent. */
  background: string | null
  /**
   * Investigator portraits, drawn only for the investigators' own phase —
   * `ChangePhaseWindow` draws nothing for the mythos.
   */
  portraits?: readonly { name: string; image: string | null }[]
  /** Which phase, for the colour the name is written in. */
  mythos: boolean
}

export interface PhaseTransitionOptions {
  /** Called when it lifts, by the timer or by the player. */
  onDone: () => void
  /**
   * How long to stay up, in milliseconds. Injected so a test does not wait
   * three real seconds for it.
   */
  duration?: number
  /** `setTimeout`, injected for the same reason. */
  schedule?: (run: () => void, ms: number) => () => void
}

export interface PhaseTransition {
  element: HTMLElement
  show: (view: PhaseTransitionView) => void
  /** Takes it down early, and stops the timer. */
  dismiss: () => void
}

export function phaseTransition(options: PhaseTransitionOptions): PhaseTransition {
  const element = el('div', {
    class: 'vk-phase',
    // Announced when it appears, since it is a beat a sighted player sees and
    // a screen-reader user would otherwise miss entirely.
    attrs: { role: 'status', 'aria-live': 'polite' },
  })
  let cancel: (() => void) | null = null

  const dismiss = (): void => {
    cancel?.()
    cancel = null
    element.replaceChildren()
    element.classList.remove('vk-phase--showing')
    options.onDone()
  }

  return {
    element,
    dismiss,

    show: (view) => {
      cancel?.()
      element.replaceChildren()
      element.classList.add('vk-phase--showing')
      element.classList.toggle('vk-phase--mythos', view.mythos)

      if (view.background !== null) {
        element.style.backgroundImage = `url("${view.background}")`
      } else {
        element.style.removeProperty('background-image')
      }

      element.append(label(view.name, { heading: 2, class: 'vk-phase__name' }))

      const portraits = view.portraits ?? []
      if (portraits.length > 0) {
        const row = el('div', { class: 'vk-phase__party' })
        for (const hero of portraits) {
          if (hero.image === null) continue
          row.append(
            el('img', {
              class: 'vk-phase__portrait',
              attrs: { src: hero.image, alt: hero.name },
            }),
          )
        }
        element.append(row)
      }

      // Clicking it through is a courtesy the C# does not offer, and costs
      // nothing: the timer is the default, not the only way out.
      element.addEventListener('click', dismiss, { once: true })

      const schedule = options.schedule ?? defaultSchedule
      cancel = schedule(dismiss, options.duration ?? TRANSITION_SECONDS * 1000)
    },
  }
}

function defaultSchedule(run: () => void, ms: number): () => void {
  const handle = setTimeout(run, ms)
  return () => {
    clearTimeout(handle)
  }
}
