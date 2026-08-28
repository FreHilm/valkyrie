/**
 * The in-quest menu, replacing `GameMenu.cs`.
 *
 * Four things: take a move back, save, leave, or close the menu again.
 *
 * Leaving does not ask for confirmation, because it is not destructive —
 * `GameMenu.Quit` writes the autosave on the way out, so the game is still
 * there to come back to. That is worth knowing before adding a prompt to
 * protect against something that cannot happen.
 */

import { button, label, panel } from '../components.js'
import { clear } from '../dom.js'
import { rawText } from '../text.js'
import type { Text } from '../text.js'

export interface GameMenuStrings {
  title: Text
  undo: Text
  save: Text
  mainMenu: Text
  cancel: Text
}

const DEFAULT_STRINGS: GameMenuStrings = {
  title: rawText('Menu'),
  undo: rawText('Undo'),
  save: rawText('Save'),
  mainMenu: rawText('Main menu'),
  cancel: rawText('Cancel'),
}

export interface GameMenuView {
  /** Whether there is anything to step back to. */
  canUndo: boolean
}

export interface GameMenuOptions {
  /** `Quest.Undo`. */
  onUndo: () => void
  /** Opens the save slots, `new SaveSelectScreen(true)`. */
  onSave: () => void
  /** `GameMenu.Quit`: autosaves, then leaves. */
  onMainMenu: () => void
  onCancel: () => void
  strings?: Partial<GameMenuStrings>
}

export interface GameMenu {
  element: HTMLElement
  show: (view: GameMenuView) => void
}

export function gameMenu(options: GameMenuOptions): GameMenu {
  const strings = { ...DEFAULT_STRINGS, ...options.strings }
  const element = panel({ class: 'vk-game-menu' })

  return {
    element,
    show: (view) => {
      clear(element)
      element.append(label(strings.title, { heading: 2, size: 'medium' }))

      // Disabled rather than hidden at the start of a quest: the menu keeps
      // the same shape, so the other entries do not move under the pointer.
      element.append(
        button(strings.undo, {
          onPress: options.onUndo,
          size: 'medium',
          class: 'vk-game-menu__item',
          ...(view.canUndo ? {} : { disabled: true }),
        }),
      )
      element.append(
        button(strings.save, {
          onPress: options.onSave,
          size: 'medium',
          class: 'vk-game-menu__item',
        }),
      )
      element.append(
        button(strings.mainMenu, {
          onPress: options.onMainMenu,
          size: 'medium',
          class: 'vk-game-menu__item',
        }),
      )
      element.append(button(strings.cancel, { onPress: options.onCancel }))
    },
  }
}
