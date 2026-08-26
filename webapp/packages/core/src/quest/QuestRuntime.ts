/**
 * The runtime quest state, ported from the state half of
 * `unity/Assets/Scripts/Quest/Quest.cs`.
 *
 * What is on the board, what the party is carrying, which monsters are in
 * play. Events mutate it through `add` and `remove`; the board renderer and
 * the screens read it.
 *
 * The board *geometry* deliberately lives in `board/geometry.ts` instead — the
 * C# mixes 34 `Vector2`s of placement maths into this class, and the task
 * notes ask for that separation.
 */

import { VarManager } from './VarManager.js'
import { LogEntry, QuestLog } from './QuestLog.js'
import type { EventDefinition } from './EventManager.js'
import type { ActivationInstance } from './ActivationInstance.js'
import { roundToInt } from './RoundController.js'

/** A quest component as parsed from the ini. Only what the runtime needs. */
export interface QuestComponentData {
  sectionName: string
  /** `Tile`, `Token`, `Door`, `UI`, `QItem`, `Monster`, `Spawn`, … */
  type: string
  location?: { x: number; y: number }
  rotation?: number
  /** `QItem.inspect`: an event fired when the item is examined. */
  inspect?: string
}

/** Something currently on the board. */
/** `Quest.Remove`'s `#` names that clear one kind of board component. */
const GROUPED_REMOVALS: Record<string, readonly string[]> = {
  '#uicomponents': ['UI'],
  '#doors': ['Door'],
  '#tiles': ['Tile'],
  '#tokens': ['Token'],
}

export interface BoardItem {
  name: string
  component: QuestComponentData
}

export interface MonsterInstance {
  /** The monster type's section name. */
  monsterName: string
  /** Which quest component spawned it. */
  spawnedBy: string
  unique: boolean
  /** `healthMod`: a scenario's adjustment on top of the monster type's health. */
  health: number
  /** Damage taken so far, `damage` in the C#. */
  damage: number
  activated: boolean
  /** The minion half of this round's activation has been shown. */
  minionStarted: boolean
  /** The master half has been shown. */
  masterStarted: boolean
  /** Which activation was drawn for this round, held until the round ends. */
  currentActivation: ActivationInstance | null
}

/**
 * A party slot. `heroName` is null for an empty seat, which is what the C#
 * expresses as `heroData == null` — those seats never block a round from
 * ending.
 */
export interface HeroInstance {
  heroName: string | null
  activated: boolean
}

/** The health fields of a monster type, from content or a `CustomMonster`. */
export interface MonsterHealthData {
  healthBase: number
  healthPerHero: number
}

export interface QuestRuntimeOptions {
  components: ReadonlyMap<string, QuestComponentData>
  events?: ReadonlyMap<string, EventDefinition>
  /** `GameType.MonstersGrouped()`: Descent groups, Mansions does not. */
  monstersGrouped?: boolean
  onWarning?: (message: string) => void
}

/**
 * The live state of a quest in progress.
 *
 * Order matters and is preserved: `ordered_boardItems` in the C# exists
 * because tiles must render in the order they were added, not in whatever
 * order a hash map yields.
 */
export class QuestRuntime {
  readonly log = new QuestLog()
  /**
   * Notices are routed into the quest log as editor entries, which is where
   * `VarManager.SetValue` puts them in the C#.
   */
  readonly vars = new VarManager({
    notice: (message) => {
      this.log.add(new LogEntry(message, true))
    },
  })

  /** Board contents, in insertion order. */
  private readonly board = new Map<string, BoardItem>()
  /** Items the party holds. */
  private readonly heldItems = new Set<string>()
  /** Which concrete item a `QItem` slot resolved to. */
  readonly itemSelect = new Map<string, string>()
  /** Item to the event fired when it is inspected. */
  readonly itemInspect = new Map<string, string>()
  readonly monsters: MonsterInstance[] = []
  /** Chosen heroes or investigators, in selection order. */
  readonly heroes: HeroInstance[] = []

  private readonly components: ReadonlyMap<string, QuestComponentData>
  private readonly monstersGrouped: boolean
  private readonly onWarning: ((message: string) => void) | undefined

  constructor(options: QuestRuntimeOptions) {
    this.components = options.components
    this.monstersGrouped = options.monstersGrouped ?? false
    this.onWarning = options.onWarning
  }

  /** Board contents in the order they were added. */
  boardItems(): BoardItem[] {
    return [...this.board.values()]
  }

  has(name: string): boolean {
    return this.board.has(name)
  }

  items(): string[] {
    return [...this.heldItems]
  }

  /**
   * `Quest.Add`. Adding something already present is a no-op, which is what
   * lets an event be triggered more than once safely.
   *
   * DEVIATION: the C# calls `Application.Quit()` when a component is missing —
   * it terminates the process from inside the board logic. A dangling
   * reference in a community scenario should not close the app, so this warns
   * and carries on.
   */
  add(names: readonly string[], shop = false): void {
    for (const name of names) this.addOne(name, shop)
  }

  private addOne(name: string, shop: boolean): void {
    const component = this.components.get(name)
    if (component === undefined) {
      this.warn(`Error: Unable to create missing quest component: ${name}`)
      return
    }
    if (this.board.has(name)) return

    if (isBoardType(component.type)) {
      this.board.set(name, { name, component })
      return
    }

    if (component.type === 'QItem' && !shop) {
      const resolved = this.itemSelect.get(name)
      if (resolved === undefined) return

      this.heldItems.add(resolved)
      if (component.inspect !== undefined && component.inspect.length > 0) {
        this.itemInspect.set(resolved, component.inspect)
      }
    }
  }

  /**
   * Clears what a handover to another scenario does not carry across.
   *
   * `Quest.ChangeQuest` rebuilds the board, the monsters and the item state
   * and keeps the heroes; the variables are trimmed by the caller, because
   * which of those survive is `VarManager`'s rule rather than this one's.
   */
  resetForNewQuest(): void {
    this.board.clear()
    this.monsters.length = 0
    this.heldItems.clear()
    this.itemSelect.clear()
    this.itemInspect.clear()
    this.vars.setValue('#monsters', 0)
  }

  /** `Quest.Remove`. Removing something absent is a no-op. */
  remove(names: readonly string[]): void {
    for (const name of names) {
      if (this.removeGroup(name)) continue
      this.board.delete(name)
      const resolved = this.itemSelect.get(name)
      if (resolved !== undefined) {
        this.heldItems.delete(resolved)
        this.itemInspect.delete(resolved)
      }
    }
  }

  /**
   * The `#` names that clear a whole class of thing at once.
   *
   * A scenario ends its opening cutscene with `remove=#boardcomponents`, which
   * is the only way it has of taking its own interface back off the board.
   * Treating one of these as an ordinary component name removes nothing and
   * leaves the scenario stuck on the screen it meant to dismiss.
   *
   * Returns whether the name was one of them, because the C# tests these
   * before falling through to the by-name removal.
   */
  private removeGroup(name: string): boolean {
    if (!name.startsWith('#')) return false

    if (name === '#monsters') {
      this.monsters.length = 0
      this.vars.setValue('#monsters', 0)
      return true
    }

    if (name === '#boardcomponents') {
      this.board.clear()
      return true
    }

    const types = GROUPED_REMOVALS[name]
    if (types !== undefined) {
      for (const [key, item] of this.board) {
        if (types.includes(item.component.type)) this.board.delete(key)
      }
      return true
    }

    if (name === '#qitems') {
      // Every item the quest granted, which is what `itemSelect` maps.
      for (const resolved of this.itemSelect.values()) {
        this.heldItems.delete(resolved)
        this.itemInspect.delete(resolved)
      }
      return true
    }

    // An unknown `#` name is not a component either; the C# tests each in turn
    // and does nothing when none match.
    return true
  }

  /**
   * Spawns a monster.
   *
   * Descent groups identical monsters into one entry; Mansions keeps them
   * separate. `#monsters` is kept in step, because scenarios test it.
   */
  spawnMonster(
    monsterName: string,
    spawnedBy: string,
    unique = false,
    uniqueHealthMod = 0,
  ): MonsterInstance | null {
    const existing = this.monsters.find((m) => m.monsterName === monsterName)
    if (this.monstersGrouped && existing !== undefined) {
      // Descent groups identical monsters, so a unique spawn of a type already
      // present *promotes that group to a master* — it does not add a second
      // one. Adding one would put twice the monsters in front of the players.
      if (unique) {
        existing.unique = true
        existing.health = uniqueHealthMod
      }
      return existing
    }

    const monster: MonsterInstance = {
      monsterName,
      spawnedBy,
      unique,
      health: unique ? uniqueHealthMod : 0,
      damage: 0,
      activated: false,
      minionStarted: false,
      masterStarted: false,
      currentActivation: null,
    }
    this.monsters.push(monster)
    this.vars.setValue('#monsters', this.monsters.length)
    return monster
  }

  removeMonster(monster: MonsterInstance): void {
    const at = this.monsters.indexOf(monster)
    if (at === -1) return
    this.monsters.splice(at, 1)
    this.vars.setValue('#monsters', this.monsters.length)
  }

  /**
   * `Quest.GetHeroCount`: seats with an investigator in them.
   *
   * Monster health scales with it, so an empty seat has to be excluded rather
   * than counted as a hero who never acts.
   */
  heroCount(): number {
    return this.heroes.filter((hero) => hero.heroName !== null).length
  }

  /**
   * `Quest.Monster.GetHealth`. Banker's rounding, as `Mathf.RoundToInt` uses,
   * so a `healthPerHero` of 0.5 with an odd party rounds the same way.
   */
  monsterHealth(monster: MonsterInstance, type: MonsterHealthData): number {
    return roundToInt(type.healthBase + this.heroCount() * type.healthPerHero) + monster.health
  }

  /** Applies damage, clamped to the range the dialogs allow. */
  setDamage(monster: MonsterInstance, damage: number, health: number): void {
    monster.damage = Math.min(Math.max(damage, 0), health)
  }

  /** Every monster and hero is eligible again, at the start of a round. */
  resetActivations(): void {
    for (const monster of this.monsters) {
      monster.activated = false
      monster.minionStarted = false
      monster.masterStarted = false
      monster.currentActivation = null
    }
    for (const hero of this.heroes) hero.activated = false
  }

  private warn(message: string): void {
    this.onWarning?.(message)
    // Logged as an editor entry, so a scenario author sees it and players do
    // not — the same place the C# puts its warnings.
    this.log.add(new LogEntry(message, true))
  }
}

/** Component types that occupy a place on the board. */
function isBoardType(type: string): boolean {
  return type === 'Tile' || type === 'Token' || type === 'Door' || type === 'UI'
}
