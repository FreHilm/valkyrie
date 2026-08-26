/**
 * Choosing the concrete items behind a scenario's `QItem` sections, ported
 * from `Quest.GenerateItemSelection` and `Quest.AttemptItemMatch`.
 *
 * A scenario rarely names an item outright. It says "a weapon the
 * investigators could plausibly own" and leaves the rest to the game, which
 * picks one at random from everything matching — so the same scenario hands
 * out different equipment each time it is played.
 *
 * The resolution is iterative because a `QItem` may name *other* `QItem`s in
 * its pool: one cannot be settled until those are, and the C# loops until a
 * pass changes nothing. That is what `force` is for — a second attempt that
 * stops waiting for names which are never going to resolve.
 */

import { log } from '../ini/logger.js'

/** What item selection needs to know about a `QItem` section. */
export interface QItemView {
  sectionName: string
  /** `itemname`: the pool, which may name items or other `QItem` sections. */
  itemName: readonly string[]
  /** `traits`: every one of these must be present. */
  traits: readonly string[]
  /** `traitpool`: at least one of these must be present. */
  traitpool: readonly string[]
}

/** What it needs to know about a content `Item`. */
export interface SelectableItem {
  traits: readonly string[]
  minFame: number
  maxFame: number
}

export interface ItemSelectionContext {
  /** Content `Item` sections, in the order the content data yields them. */
  items: ReadonlyMap<string, SelectableItem>
  /** The party's fame level, 1 to 6. See {@link fameLevel}. */
  fame: number
  /** Items the investigators already hold, which are not offered again. */
  held: Iterable<string>
  random: (count: number) => number
  warn?: (message: string) => void
}

/**
 * `AttemptItemMatch`. Returns whether it settled this section.
 *
 * With no traits at all the pool is a list of names tried in order: another
 * `QItem` that is already settled resolves to whatever that settled on, and a
 * content item resolves to itself. An unsettled `QItem` stops the search —
 * the answer depends on it, so there is nothing to decide yet.
 */
export function attemptItemMatch(
  item: QItemView,
  selected: Map<string, string>,
  context: ItemSelectionContext,
  force = true,
): boolean {
  if (selected.has(item.sectionName)) return false

  if (item.traitpool.length + item.traits.length === 0) {
    for (const name of item.itemName) {
      const resolved = selected.get(name)
      if (resolved !== undefined) {
        selected.set(item.sectionName, resolved)
        return true
      }
      // An unsettled `QItem` is not a content item, and never will be.
      if (name.startsWith('QItem')) return false
      if (context.items.has(name)) {
        selected.set(item.sectionName, name)
        return true
      }
    }
    return false
  }

  // The pool doubles as an exclusion list: whatever the other sections took,
  // this one does not take as well.
  const exclude = new Set<string>()
  for (const name of item.itemName) {
    const resolved = selected.get(name)
    if (resolved !== undefined) exclude.add(resolved)
    else if (name.startsWith('QItem') && !force) return false
    else exclude.add(name)
  }
  for (const held of context.held) exclude.add(held)
  for (const taken of selected.values()) exclude.add(taken)

  const candidates: string[] = []
  for (const [name, data] of context.items) {
    if (!item.traits.every((trait) => data.traits.includes(trait))) continue
    if (exclude.has(name)) continue

    // `minFame > 0` is how content marks an item as fame-gated at all.
    if (data.minFame > 0 && (data.minFame > context.fame || data.maxFame < context.fame)) continue

    const oneOf =
      item.traitpool.length === 0 || item.traitpool.some((trait) => data.traits.includes(trait))
    if (oneOf) candidates.push(name)
  }

  if (candidates.length === 0) {
    const message = `Warning: Unable to find an item for QItem: ${item.sectionName}`
    context.warn?.(message)
    log(message)
    return false
  }

  const chosen = candidates[context.random(candidates.length)] ?? candidates[0]
  if (chosen !== undefined) selected.set(item.sectionName, chosen)
  return true
}

/**
 * `GenerateItemSelection`: settles every `QItem` a scenario declares.
 *
 * The loop is the C#'s. A pass that settles nothing switches `force` on, which
 * lets sections stop waiting for pool entries that will never resolve; a
 * forced pass that still settles nothing means there is nothing left to do.
 */
export function generateItemSelection(
  items: Iterable<QItemView>,
  context: ItemSelectionContext,
): Map<string, string> {
  const selected = new Map<string, string>()
  const all = [...items]

  let force = false
  for (;;) {
    let progress = false
    for (const item of all) {
      progress = attemptItemMatch(item, selected, context, force) || progress
      if (progress && force) force = false
    }
    if (!progress) {
      if (force) break
      force = true
    }
  }
  return selected
}

/**
 * `$%fame` against the five thresholds.
 *
 * A quest that sets none of them comes out at 6 rather than 1, because every
 * comparison is `0 >= 0`. That is what the C# does, and it does not matter:
 * the level is only read for items declaring `minFame`, which is a Descent
 * campaign idea that no Mansions item uses.
 */
export function fameLevel(value: (name: string) => number): number {
  const fame = value('$%fame')
  let level = 1
  for (const [threshold, at] of [
    ['$%famenoteworthy', 2],
    ['$%fameimpressive', 3],
    ['$%famecelebrated', 4],
    ['$%fameheroic', 5],
    ['$%famelegendary', 6],
  ] as const) {
    if (fame >= value(threshold)) level = at
  }
  return level
}

/** A chosen investigator, as the starting-items step sees them. */
export interface StartingHero {
  /** The content `Hero` section name. */
  heroName: string
  /** `HeroData.item`: the one item they bring, when content has it. */
  item: string
}

export interface StartingItemsContext {
  heroes: Iterable<StartingHero>
  /** Every `QItem` the scenario declares, with its `starting` flag and tests. */
  questItems: Iterable<QItemView & { starting: boolean; passes: boolean; inspect: string }>
  /** The result of {@link generateItemSelection}. */
  selected: ReadonlyMap<string, string>
  items: ReadonlyMap<string, SelectableItem>
}

export interface StartingItems {
  /** Content `Item` section names the investigators begin with. */
  items: string[]
  /** Item to the event that examines it, from a `QItem`'s `inspect`. */
  inspect: Map<string, string>
}

/**
 * `InvestigatorItems`: what the party starts with.
 *
 * Two sources, in the C#'s order — the item on each investigator's own card,
 * and every `starting` `QItem` the scenario declares whose tests pass. The
 * scenario's are the ones that vary: it asks for "a weapon" and selection has
 * already decided which.
 */
export function startingItems(context: StartingItemsContext): StartingItems {
  const result: StartingItems = { items: [], inspect: new Map() }

  for (const hero of context.heroes) {
    if (context.items.has(hero.item)) result.items.push(hero.item)
  }

  for (const item of context.questItems) {
    if (!item.starting || !item.passes) continue
    const resolved = context.selected.get(item.sectionName)
    if (resolved === undefined) continue
    result.items.push(resolved)
    if (item.inspect.length > 0) result.inspect.set(resolved, item.inspect)
  }

  return result
}
