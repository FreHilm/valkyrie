/**
 * Trait filtering for selection lists.
 *
 * Port of the `TraitGroup` filtering in
 * `unity/Assets/Scripts/UI/UIWindowSelectionListTraits.cs` — the part worth
 * porting rather than rewriting, because the semantics are subtle and hundreds
 * of published scenarios are browsed through it.
 *
 * A trait group is one axis of filtering ("Source", "Type", "Expansion").
 * Within a group each trait can be *selected* (must have it) or *excluded*
 * (must not), and the two are mutually exclusive. An item passes the list when
 * it passes every group.
 */

export const FilterMode = {
  /**
   * All selected traits must be present, and none of the item's traits may be
   * excluded. The original default.
   */
  STRICT: 'STRICT',
  /**
   * All selected traits must be present, and the item needs at least one trait
   * that is not excluded — so exclusion only bites when nothing is selected.
   * The C# turns this on for the group named "Source".
   */
  AT_LEAST_ONE_SELECTED: 'AT_LEAST_ONE_SELECTED',
} as const

export type FilterMode = (typeof FilterMode)[keyof typeof FilterMode]

export interface TraitState {
  selected: boolean
  excluded: boolean
}

export interface SelectionItem {
  /** Stable identity. The C# compares object references. */
  key: string
  /** Display text, already translated. */
  display: string
  /** Group name to the traits the item carries in that group. */
  traits: ReadonlyMap<string, readonly string[]>
  /** `SelectionItemTraits.alwaysOnTop`: pinned above the sort order. */
  alwaysOnTop?: boolean
}

/**
 * Whether the group named `name` filters leniently.
 *
 * The C# compares the group name against the *translated* `SOURCE` string,
 * case-insensitively and trimmed — so this depends on the user's language. The
 * caller passes the translated word rather than this module reaching for a
 * localization singleton.
 */
export function filterModeFor(name: string, sourceWording: string): FilterMode {
  return sourceWording.trim().toLowerCase() === name.trim().toLowerCase()
    ? FilterMode.AT_LEAST_ONE_SELECTED
    : FilterMode.STRICT
}

export class TraitGroup {
  /** Trait name to its state, in insertion order — which is display order. */
  readonly traits = new Map<string, TraitState>()
  /** Items carrying no trait in this group. They bypass its filtering. */
  readonly ungrouped: SelectionItem[] = []

  private readonly members = new Map<string, Set<string>>()

  constructor(
    readonly name: string,
    readonly mode: FilterMode = FilterMode.STRICT,
  ) {}

  /** `AddTraits`: registers the trait names an item introduces. */
  addTraits(item: SelectionItem): void {
    for (const trait of item.traits.get(this.name) ?? []) {
      if (!this.traits.has(trait)) this.traits.set(trait, { selected: false, excluded: false })
    }
  }

  /** `AddItem`: files an item under each of its traits, or as ungrouped. */
  addItem(item: SelectionItem): void {
    const owned = item.traits.get(this.name)
    if (owned === undefined) {
      this.ungrouped.push(item)
      return
    }
    for (const trait of owned) {
      let members = this.members.get(trait)
      if (members === undefined) {
        members = new Set<string>()
        this.members.set(trait, members)
      }
      members.add(item.key)
    }
  }

  /** `NoneSelected()`. */
  noneSelected(): boolean {
    return [...this.traits.values()].every((trait) => !trait.selected)
  }

  /** Selecting a trait clears its exclusion, and vice versa. */
  toggleSelected(trait: string): void {
    const state = this.traits.get(trait)
    if (state === undefined) return
    state.selected = !state.selected
    state.excluded = false
  }

  toggleExcluded(trait: string): void {
    const state = this.traits.get(trait)
    if (state === undefined) return
    state.excluded = !state.excluded
    state.selected = false
  }

  clear(): void {
    for (const state of this.traits.values()) {
      state.selected = false
      state.excluded = false
    }
  }

  /**
   * `ActiveItem(item)`.
   *
   * Note what the C# does and this reproduces: `itemTraits` is the set of
   * traits *in this group* that the item belongs to, and the selected-traits
   * check tests membership against exactly that set. An item filed under no
   * trait here therefore fails any selection, but passes when nothing is
   * selected.
   */
  activeItem(item: SelectionItem): boolean {
    const owned: [string, TraitState][] = []
    for (const [trait, state] of this.traits) {
      if (this.members.get(trait)?.has(item.key) === true) owned.push([trait, state])
    }
    const ownedKeys = new Set(owned.map(([trait]) => trait))

    for (const [trait, state] of this.traits) {
      if (state.selected && !ownedKeys.has(trait)) return false
    }

    if (this.mode === FilterMode.AT_LEAST_ONE_SELECTED) {
      const noneSelected = this.noneSelected()
      return owned.some(([, state]) => !state.excluded && (noneSelected || state.selected))
    }
    return !owned.some(([, state]) => state.excluded)
  }
}

export interface FilterOptions {
  /** Case-insensitive substring match against the display text. */
  search?: string
}

/**
 * The items a list should show: every group must pass, plus the search box.
 *
 * An item that carries no trait in a group is ungrouped *for that group* and
 * is not filtered by it — which is how an item with no "Expansion" trait stays
 * visible while expansion filters are active.
 */
export function filterItems(
  items: readonly SelectionItem[],
  groups: readonly TraitGroup[],
  options: FilterOptions = {},
): SelectionItem[] {
  const search = (options.search ?? '').trim().toLowerCase()

  return items.filter((item) => {
    if (search.length > 0 && !item.display.toLowerCase().includes(search)) return false

    return groups.every((group) => {
      if (!item.traits.has(group.name)) return true
      return group.activeItem(item)
    })
  })
}

/** Pinned items first, then by display text. */
export function sortItems(items: readonly SelectionItem[]): SelectionItem[] {
  return [...items].sort((a, b) => {
    const pinned = Number(b.alwaysOnTop ?? false) - Number(a.alwaysOnTop ?? false)
    if (pinned !== 0) return pinned
    return a.display.localeCompare(b.display)
  })
}

/** Builds the groups an item set implies, in first-seen order. */
export function groupsFrom(
  items: readonly SelectionItem[],
  sourceWording = 'Source',
): TraitGroup[] {
  const groups = new Map<string, TraitGroup>()

  for (const item of items) {
    for (const name of item.traits.keys()) {
      if (!groups.has(name))
        groups.set(name, new TraitGroup(name, filterModeFor(name, sourceWording)))
    }
  }
  for (const group of groups.values()) {
    for (const item of items) {
      group.addTraits(item)
      group.addItem(item)
    }
  }
  return [...groups.values()]
}
