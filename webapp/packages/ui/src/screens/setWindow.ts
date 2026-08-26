/**
 * The Set window, replacing `SetWindow.cs`.
 *
 * Two things a Mansions table can do to itself that no event covers: light a
 * fire, and lose an investigator. Both are quest variables the scenario reads
 * — `$fire` and `#eliminated` — so this is the manual switch for the board
 * state the app cannot observe.
 *
 * The C# rebuilds the whole window on every press, which is how each button
 * comes back with the opposite label. Here `show` is called again instead.
 */

import { button, label, panel } from '../components.js'
import { clear } from '../dom.js'
import { rawText } from '../text.js'
import type { Text } from '../text.js'

/** The quest variables this window switches, read fresh on every draw. */
export interface SetWindowView {
  /** `$fire > 0`. */
  fire: boolean
  /** `#eliminated > 0`. */
  eliminated: boolean
  /**
   * `#eliminatedcomplete > 0.1`: the elimination has already been played out,
   * and `Uneliminate` returns without doing anything. The C# still draws the
   * button; here it is disabled, which says the same thing before the press.
   */
  eliminationFinal: boolean
}

export interface SetWindowStrings {
  title: Text
  setFire: Text
  clearFire: Text
  eliminated: Text
  close: Text
}

const DEFAULT_STRINGS: SetWindowStrings = {
  title: rawText('Set'),
  setFire: rawText('Set fire'),
  clearFire: rawText('Clear fire'),
  eliminated: rawText('Investigator eliminated'),
  close: rawText('Close'),
}

export interface SetWindowOptions {
  /** `SetFire` / `ClearFire`, which write `$fire`. */
  onFire: (lit: boolean) => void
  /**
   * `Eliminate` / `Uneliminate`. Clearing it also clears `#eliminatedprev`,
   * which is the round handshake — the caller owns both writes.
   */
  onEliminated: (eliminated: boolean) => void
  onClose: () => void
  strings?: Partial<SetWindowStrings>
}

export interface SetWindow {
  element: HTMLElement
  show: (view: SetWindowView) => void
}

export function setWindow(options: SetWindowOptions): SetWindow {
  const strings = { ...DEFAULT_STRINGS, ...options.strings }
  const element = panel({ class: 'vk-set' })

  return {
    element,
    show: (view) => {
      clear(element)
      element.append(label(strings.title, { heading: 2, size: 'medium' }))

      element.append(
        button(view.fire ? strings.clearFire : strings.setFire, {
          onPress: () => {
            options.onFire(!view.fire)
          },
          size: 'medium',
          class: 'vk-set__toggle',
        }),
      )

      // Greyed once set, because the only thing left to do with it is undo it
      // — and past `#eliminatedcomplete` not even that.
      const eliminate = button(strings.eliminated, {
        onPress: () => {
          options.onEliminated(!view.eliminated)
        },
        size: 'medium',
        class: view.eliminated ? ['vk-set__toggle', 'vk-set__toggle--on'] : 'vk-set__toggle',
        ...(view.eliminated && view.eliminationFinal ? { disabled: true } : {}),
      })
      eliminate.setAttribute('aria-pressed', view.eliminated ? 'true' : 'false')
      element.append(eliminate)

      element.append(button(strings.close, { onPress: options.onClose }))
    },
  }
}
