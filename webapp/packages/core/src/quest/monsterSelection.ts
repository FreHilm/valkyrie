/**
 * Choosing which monster a spawn places, ported from `AttemptMonsterMatch` and
 * `RuntimeMonsterSelection` (`unity/Assets/Scripts/Quest/Quest.cs:435-635`).
 *
 * A spawn either names its types outright or describes them by traits, and the
 * result is remembered per spawn section — so a scenario that spawns "the same
 * kind of thing" twice gets the same kind twice. Descent additionally avoids
 * repeating a type already chosen or already on the board; Mansions does not,
 * because its monsters are individuals rather than groups.
 */

import { log } from '../ini/logger.js'
import { LogEntry } from './QuestLog.js'
import type { QuestLog } from './QuestLog.js'

/** A `Spawn` section, as selection sees it. */
export interface SpawnView {
  sectionName: string
  /** `monster`: explicit types, or other spawns to match. */
  mTypes: readonly string[]
  /** `traits`: every one of these is required. */
  mTraitsRequired: readonly string[]
  /** `traitpool`: at least one of these is required. */
  mTraitsPool: readonly string[]
}

/** A monster type that can be matched on traits. */
export interface TraitedMonster {
  traits: readonly string[]
}

/** A quest's own `CustomMonster`, which may inherit its traits from a base. */
export interface CustomMonsterView extends TraitedMonster {
  baseMonster: string
}

export interface SelectionContext {
  /** Content monsters, in the order the content data yields them. */
  contentMonsters: ReadonlyMap<string, TraitedMonster>
  /** The quest's own `CustomMonster` sections. */
  questMonsters: ReadonlyMap<string, CustomMonsterView>
  /** Every quest component name, for the "is this a quest monster" test. */
  questComponents: ReadonlySet<string>
  /** What each spawn has already resolved to. Mutated on success. */
  selected: Map<string, string>
  /** Section names of monsters already on the board. Descent only. */
  onBoard: readonly string[]
  gameType: 'MoM' | 'D2E'
  random: (count: number) => number
  log?: QuestLog
}

/** `RuntimeMonsterSelection`: false when the spawn section does not exist. */
export function runtimeMonsterSelection(
  spawnName: string,
  spawns: ReadonlyMap<string, SpawnView>,
  context: SelectionContext,
): boolean {
  const spawn = spawns.get(spawnName)
  if (spawn === undefined) return false
  return attemptMonsterMatch(spawn, context)
}

/**
 * `AttemptMonsterMatch`.
 *
 * `force` defaults to true in the C# and only ever matters in the trait
 * branch, where it decides whether an unresolved `Spawn…` reference aborts the
 * match or is treated as a plain exclusion.
 */
export function attemptMonsterMatch(
  spawn: SpawnView,
  context: SelectionContext,
  force = true,
): boolean {
  // Already resolved: a spawn keeps its type for the whole quest.
  if (context.selected.has(spawn.sectionName)) return true

  if (spawn.mTraitsPool.length + spawn.mTraitsRequired.length === 0) {
    return matchByName(spawn, context)
  }
  return matchByTraits(spawn, context, force)
}

/** The branch where the spawn names its types outright. */
function matchByName(spawn: SpawnView, context: SelectionContext): boolean {
  for (const type of spawn.mTypes) {
    // Another spawn's choice, so the two place the same kind of thing.
    const alreadyChosen = context.selected.get(type)
    if (alreadyChosen !== undefined) {
      context.selected.set(spawn.sectionName, alreadyChosen)
      return true
    }

    // A reference to a spawn that has not resolved yet: give up rather than
    // guess, and let the caller try again once it has.
    if (type.startsWith('Spawn')) return false

    // `Monster` is optional in the ini, so `Zombie` means `MonsterZombie`.
    const monster =
      type.startsWith('Monster') || type.startsWith('CustomMonster') ? type : `Monster${type}`

    if (context.questComponents.has(monster) || context.contentMonsters.has(monster)) {
      context.selected.set(spawn.sectionName, monster)
      return true
    }
  }
  return false
}

/** The branch where the spawn describes its types by traits. */
function matchByTraits(spawn: SpawnView, context: SelectionContext, force: boolean): boolean {
  const exclude: string[] = []
  for (const type of spawn.mTypes) {
    const alreadyChosen = context.selected.get(type)
    if (alreadyChosen !== undefined) {
      exclude.push(alreadyChosen)
    } else if (type.startsWith('Spawn') && !force) {
      return false
    } else {
      exclude.push(type)
    }
  }

  // Descent groups identical monsters, so repeating a type would merge two
  // spawns into one group. Mansions monsters are individuals and may repeat.
  if (context.gameType === 'D2E') {
    for (const chosen of context.selected.values()) {
      if (!exclude.includes(chosen)) exclude.push(chosen)
    }
    for (const name of context.onBoard) {
      if (!exclude.includes(name)) exclude.push(name)
    }
  }

  const matches: string[] = []
  for (const [name, monster] of context.contentMonsters) {
    if (traitsMatch(monster.traits, spawn, exclude, name)) matches.push(name)
  }
  for (const [name, monster] of context.questMonsters) {
    // A custom monster with no traits of its own inherits its base type's.
    const base = context.contentMonsters.get(monster.baseMonster)
    const traits = monster.traits.length === 0 && base !== undefined ? base.traits : monster.traits
    if (traitsMatch(traits, spawn, exclude, name)) matches.push(name)
  }

  if (matches.length === 0) {
    const message = `Error: Unable to find monster of traits specified in event: ${spawn.sectionName}`
    log(message)
    context.log?.add(
      new LogEntry(
        `Error: Unable to find monster of traits specified in spawn event: ${spawn.sectionName}`,
        true,
      ),
    )
    return false
  }

  const chosen = matches[context.random(matches.length)] ?? matches[0]
  if (chosen !== undefined) context.selected.set(spawn.sectionName, chosen)
  return true
}

/** Every required trait, at least one pooled trait, and not excluded. */
function traitsMatch(
  traits: readonly string[],
  spawn: SpawnView,
  exclude: readonly string[],
  name: string,
): boolean {
  for (const required of spawn.mTraitsRequired) {
    if (!traits.includes(required)) return false
  }
  // An empty pool imposes no requirement; a non-empty one needs a hit.
  const oneFound =
    spawn.mTraitsPool.length === 0 || spawn.mTraitsPool.some((t) => traits.includes(t))
  if (!oneFound) return false
  return !exclude.includes(name)
}
