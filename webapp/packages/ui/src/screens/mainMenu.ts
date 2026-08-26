/**
 * The main menu and quest selection.
 *
 * Replaces `MainMenuScreen`, `GameSelectionScreen` and the presentation half
 * of `QuestSelectionScreen.cs` — 1,884 lines that mix list management,
 * filtering, download orchestration and rendering. The data half moved to
 * T-013; what is here is presentation.
 */

import { button, label, panel } from '../components.js'
import { el } from '../dom.js'
import { selectionList } from '../selectionList.js'
import type { SelectionItem } from '../traitFilter.js'
import { rawText } from '../text.js'
import type { Text } from '../text.js'
import type { RichTextOptions } from '../richText.js'

export interface MenuAction {
  label: Text
  onPress: () => void
  disabled?: boolean
}

/** A vertical stack of actions. The whole of the main menu. */
export function mainMenu(options: { title: Text; actions: readonly MenuAction[] }): HTMLElement {
  return panel({
    title: options.title,
    class: 'vk-menu',
    children: options.actions.map((action) =>
      button(action.label, {
        onPress: action.onPress,
        variant: 'primary',
        size: 'medium',
        ...(action.disabled === true ? { disabled: true } : {}),
      }),
    ),
  })
}

export interface QuestEntry extends SelectionItem {
  /** Already translated. */
  description?: string
  /** Shown as a badge: downloaded, update available, and so on. */
  status?: string
}

export interface QuestSelectionOptions {
  quests: readonly QuestEntry[]
  onPick: (id: string) => void
  title: Text
  searchLabel: Text
  emptyMessage: Text
  /** The translated word for the "Source" trait group, which filters leniently. */
  sourceWording?: string
}

/**
 * The quest browser: search, trait filters and a list.
 *
 * The filtering is the ported `TraitGroup` logic, verified against the C# —
 * which matters, because hundreds of published scenarios are found through it.
 */
export function questSelection(options: QuestSelectionOptions): HTMLElement {
  const list = selectionList({
    items: options.quests,
    onSelect: (item) => options.onPick(item.key),
    label: options.title,
    searchLabel: options.searchLabel,
    emptyMessage: options.emptyMessage,
    ...(options.sourceWording === undefined ? {} : { sourceWording: options.sourceWording }),
  })

  return panel({ title: options.title, class: 'vk-quests', children: [list.element] })
}

/** A quest's details, shown before starting it. */
export function questDetails(options: {
  name: string
  description?: string
  /** A scenario's own blurb, which carries the game's markup and symbols. */
  rich?: RichTextOptions
  image?: string
  actions: readonly MenuAction[]
}): HTMLElement {
  return panel({
    class: 'vk-quest-details',
    children: [
      options.image === undefined
        ? null
        : el('img', { attrs: { src: options.image, alt: '' }, class: 'vk-quest-details__image' }),
      label(rawText(options.name), { size: 'large', heading: 2 }),
      options.description === undefined
        ? null
        : label(
            rawText(options.description),
            options.rich === undefined ? {} : { rich: options.rich },
          ),
      el('div', {
        class: 'vk-quest-details__actions',
        children: options.actions.map((action) =>
          button(action.label, {
            onPress: action.onPress,
            variant: 'primary',
            ...(action.disabled === true ? { disabled: true } : {}),
          }),
        ),
      }),
    ],
  })
}
