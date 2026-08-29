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
  /** Cover art, as a URL the page can load. */
  image?: string
  /**
   * A line of facts under the title — length, investigators, difficulty.
   *
   * Pre-composed by the caller rather than assembled here, because what is
   * known differs between a scenario in storage and one in the online index.
   */
  detail?: string
  /** Packs the scenario needs and the player has not selected. */
  missingPacks?: readonly string[]
}

export interface QuestSelectionOptions {
  quests: readonly QuestEntry[]
  onPick: (id: string) => void
  title: Text
  searchLabel: Text
  emptyMessage: Text
  /** The translated word for the "Source" trait group, which filters leniently. */
  sourceWording?: string
  /**
   * Draw the results as a gallery of cover art rather than a list of names.
   *
   * The same filtering either way; only the renderer changes.
   */
  gallery?: boolean
  /** How the result count reads; defaults to the bare number. */
  countLabel?: (count: number) => string
}

/**
 * One scenario as a card: its cover, its title, and what it asks of the table.
 *
 * The art is the point of this view — a player recognises a scenario by its
 * cover long before reading its name — so the image leads and everything else
 * is secondary. It sits in a fixed frame with `object-fit: cover` because the
 * covers are every shape from 1:1 to 16:9, and a grid of ragged tiles reads as
 * broken rather than varied.
 *
 * A card with no cover keeps the frame and fills it with the scenario's
 * initial, so the grid stays a grid.
 */
function questCard(entry: QuestEntry): HTMLElement {
  const art =
    entry.image === undefined
      ? el('span', {
          class: 'vk-quest-card__initial',
          attrs: { 'aria-hidden': 'true' },
          text: entry.display.trim().charAt(0).toUpperCase(),
        })
      : el('img', {
          class: 'vk-quest-card__art',
          // Decorative: the title beside it names the scenario, and a cover
          // read out as "cover of X" after the heading is noise.
          attrs: { src: entry.image, alt: '', loading: 'lazy', decoding: 'async' },
        })

  const missing = entry.missingPacks ?? []
  const badges = el('div', { class: 'vk-quest-card__badges' })
  if (entry.status !== undefined) {
    badges.append(el('span', { class: 'vk-quest-card__badge', text: entry.status }))
  }
  if (missing.length > 0) {
    badges.append(
      el('span', {
        class: ['vk-quest-card__badge', 'vk-quest-card__badge--missing'],
        text: `Needs ${missing.join(', ')}`,
      }),
    )
  }

  return el('div', {
    class: ['vk-quest-card', ...(missing.length > 0 ? ['vk-quest-card--missing'] : [])],
    children: [
      el('div', { class: 'vk-quest-card__frame', children: [art] }),
      el('div', {
        class: 'vk-quest-card__body',
        children: [
          el('span', { class: 'vk-quest-card__name', text: entry.display }),
          entry.detail === undefined || entry.detail.length === 0
            ? null
            : el('span', { class: 'vk-quest-card__detail', text: entry.detail }),
          badges.childNodes.length === 0 ? null : badges,
        ],
      }),
    ],
  })
}

/**
 * The quest browser: search, trait filters and a list.
 *
 * The filtering is the ported `TraitGroup` logic, verified against the C# —
 * which matters, because hundreds of published scenarios are found through it.
 */
export function questSelection(options: QuestSelectionOptions): HTMLElement {
  const list = selectionList<QuestEntry>({
    items: options.quests,
    onSelect: (item) => options.onPick(item.key),
    label: options.title,
    searchLabel: options.searchLabel,
    emptyMessage: options.emptyMessage,
    ...(options.sourceWording === undefined ? {} : { sourceWording: options.sourceWording }),
    ...(options.countLabel === undefined ? {} : { countLabel: options.countLabel }),
    ...(options.gallery === true ? { listClass: 'vk-list--gallery', renderItem: questCard } : {}),
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
