/**
 * The selection list with trait filtering, replacing
 * `UIWindowSelectionListTraits.cs` (668 lines).
 *
 * The filtering itself is a faithful port in `traitFilter.ts`, verified
 * against the extracted C# by `tools/differential/traits`. This module is the
 * presentation, and is a rewrite.
 */

import { button, label, list, searchBox } from './components.js'
import { clear, el } from './dom.js'
import { filterItems, groupsFrom, sortItems } from './traitFilter.js'
import type { SelectionItem, TraitGroup } from './traitFilter.js'
import { rawText, resolve } from './text.js'
import type { Text } from './text.js'

export interface SelectionListOptions<T extends SelectionItem = SelectionItem> {
  items: readonly T[]
  onSelect: (item: T) => void
  /** Announced as the list's name. */
  label: Text
  searchLabel: Text
  emptyMessage: Text
  /** The translated word for the "Source" group, which filters leniently. */
  sourceWording?: string
  /** Traits to exclude before the first render, as `initialExclusions` does. */
  initialExclusions?: ReadonlyMap<string, readonly string[]>
  /**
   * What one result looks like. Defaults to its name on a row.
   *
   * The filtering above it is the ported, verified part and does not care what
   * a result is drawn as — so a gallery of cover art and a list of names are
   * the same screen with a different renderer, rather than two screens whose
   * filtering has to be kept in step.
   */
  renderItem?: (item: T) => HTMLElement
  /** Extra classes for the results container, so a caller can lay it out. */
  listClass?: string | readonly string[]
  /**
   * How the result count reads. Defaults to the bare number.
   *
   * It is an `aria-live` region, so it is also what a screen reader announces
   * when a filter changes — and "9" on its own says neither what there are
   * nine of nor that anything happened.
   */
  countLabel?: (count: number) => string
}

export interface SelectionList {
  element: HTMLElement
  /** Re-renders. Called for you when a filter or the search text changes. */
  refresh: () => void
  visibleItems: () => SelectionItem[]
  groups: readonly TraitGroup[]
}

/**
 * A three-state filter control per trait: neutral, required, excluded.
 *
 * The C# uses two separate click targets and colour alone to say which state a
 * trait is in. One button cycling three states is fewer targets to hit on a
 * phone, and `aria-pressed` plus the state word make it readable without
 * colour.
 */
function traitControl(group: TraitGroup, trait: string, onChange: () => void): HTMLElement {
  const state = group.traits.get(trait)
  const selected = state?.selected === true
  const excluded = state?.excluded === true
  const mode = selected ? 'required' : excluded ? 'excluded' : 'neutral'

  return button(rawText(trait), {
    onPress: () => {
      // neutral -> required -> excluded -> neutral
      if (selected) {
        group.toggleSelected(trait)
        group.toggleExcluded(trait)
      } else if (excluded) {
        group.toggleExcluded(trait)
      } else {
        group.toggleSelected(trait)
      }
      onChange()
    },
    variant: excluded ? 'danger' : selected ? 'primary' : 'secondary',
    class: ['vk-trait', `vk-trait--${mode}`],
  })
}

export function selectionList<T extends SelectionItem = SelectionItem>(
  options: SelectionListOptions<T>,
): SelectionList {
  const groups = groupsFrom(options.items, options.sourceWording ?? 'Source')

  const exclusions: ReadonlyMap<string, readonly string[]> =
    options.initialExclusions ?? new Map<string, readonly string[]>()
  for (const [groupName, traits] of exclusions) {
    const group = groups.find((candidate) => candidate.name === groupName)
    for (const trait of traits) group?.toggleExcluded(trait)
  }

  let search = ''

  const filters = el('div', { class: 'vk-filters', attrs: { role: 'group' } })
  const results = el('div', { class: 'vk-results' })

  // `filterItems` and `sortItems` select and reorder; they never copy. So the
  // objects that come back are the caller's own, and a renderer written for
  // the richer type is handed the richer type.
  const visibleItems = (): T[] => sortItems(filterItems(options.items, groups, { search })) as T[]

  const renderFilters = (): void => {
    clear(filters)
    for (const group of groups) {
      const heading = label(rawText(group.name), { size: 'small', class: 'vk-filters__name' })
      heading.id = `vk-filter-${group.name.replace(/\W+/g, '-')}`

      filters.append(
        el('div', {
          class: 'vk-filters__group',
          attrs: { role: 'group', 'aria-labelledby': heading.id },
          children: [
            heading,
            el('div', {
              class: 'vk-filters__traits',
              children: [...group.traits.keys()].map((trait) =>
                traitControl(group, trait, refresh),
              ),
            }),
          ],
        }),
      )
    }
  }

  const renderResults = (): void => {
    const items = visibleItems()
    clear(results)
    results.append(
      list<T>({
        items,
        label: options.label,
        emptyMessage: options.emptyMessage,
        onSelect: (item) => options.onSelect(item),
        render: options.renderItem ?? ((item) => label(rawText(item.display))),
        ...(options.listClass === undefined ? {} : { class: options.listClass }),
      }),
      // Announced politely, so a filter change reports its own result.
      el('p', {
        class: 'vk-results__count',
        attrs: { 'aria-live': 'polite' },
        text: options.countLabel?.(items.length) ?? `${items.length}`,
      }),
    )
  }

  function refresh(): void {
    renderFilters()
    renderResults()
  }

  const element = el('div', {
    class: 'vk-selection',
    children: [
      searchBox({
        label: options.searchLabel,
        onChange: (value) => {
          search = value
          renderResults()
        },
      }),
      filters,
      results,
    ],
  })

  refresh()
  return { element, refresh, visibleItems, groups }
}

/** Convenience for callers that only have display strings. */
export function itemsFrom(
  entries: readonly { key: string; display: string; traits?: Record<string, string[]> }[],
): SelectionItem[] {
  return entries.map((entry) => ({
    key: entry.key,
    display: entry.display,
    traits: new Map(Object.entries(entry.traits ?? {})),
  }))
}

export { resolve }
