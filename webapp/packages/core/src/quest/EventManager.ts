/**
 * The event engine, ported from `unity/Assets/Scripts/Quest/EventManager.cs`.
 *
 * This is what drives a quest: events are queued onto a stack, triggered one at
 * a time, and chained through the buttons the player presses. Almost every
 * scenario behaviour is expressed through it.
 *
 * The C# reaches for `Game.Get()` throughout and calls into the UI from inside
 * the engine. Here the dependencies are injected, so the engine can run — and
 * be tested — with no game, no screen and no filesystem.
 */

import type { VarManager } from './VarManager.js'
import type { VarOperation, VarTests } from './VarTests.js'
import type { MonsterInstance, QuestRuntime } from './QuestRuntime.js'
import { LogEntry } from './QuestLog.js'
import type { QuestLog } from './QuestLog.js'

/** The event data a quest ini defines. A subset of `QuestData.Event`. */
export interface EventDefinition {
  sectionName: string
  /** `trigger`: fires automatically when this condition is reached. */
  trigger: string
  /** Var tests that must pass for the event to be available. */
  tests: VarTests | null
  /** Each button carries the events it chains to. */
  buttons: { eventNames: string[] }[]
  /** `add`: components placed on the board when the event runs. */
  addComponents?: string[]
  /** `remove`: components taken off the board. */
  removeComponents?: string[]
  /** `operations`: var changes applied when the event runs, in order. */
  operations?: readonly VarOperation[]
  /** `audio`: a sound played when the event runs. */
  audio?: string
  /** `music`: replaces the background playlist while this event stands. */
  music?: readonly string[]
  /** `randomEvents`: pick one chained event at random rather than the first. */
  randomEvents: boolean
  /** `xposition`/`yposition`, when the event carries them. */
  location?: { x: number; y: number }
  /** Set when the position is a place to look rather than a pan limit. */
  locationSpecified?: boolean
  /** `mincam` / `maxcam`: the position bounds how far the player may pan. */
  minCam?: boolean
  maxCam?: boolean
  /** A `UI` component's position places the element, not the camera. */
  isUi?: boolean
}

/**
 * A sound to play.
 *
 * `effect` names an `Audio` content section, or a file beside the quest when
 * no section matches. `trait` is a category — `newround`, `defeated` — and one
 * of the sounds carrying it is chosen at random. `music` replaces the
 * background playlist.
 */
export type AudioRequest =
  | { kind: 'effect'; name: string }
  | { kind: 'trait'; trait: string }
  | { kind: 'music'; names: readonly string[] }

/** What an event asks of the camera. `CameraController`'s three setters. */
export type CameraCommand =
  | { kind: 'look'; at: { x: number; y: number } }
  | { kind: 'min'; at: { x: number; y: number } }
  | { kind: 'max'; at: { x: number; y: number } }

/**
 * What the engine needs from the wider game.
 *
 * Deliberately small: the C# version of this is `Game.Get()`, which is why its
 * engine cannot be exercised without a running application.
 */
export interface EventContext {
  vars: VarManager
  log: QuestLog
  /** Events by section name. */
  events: ReadonlyMap<string, EventDefinition>
  /**
   * Whether a name refers to another quest file rather than an event. The C#
   * probes the filesystem; the caller decides here.
   */
  /** Where an event asks the camera to look, or how far it may be panned. */
  camera?: (command: CameraCommand) => void
  isQuestTransition?: (name: string) => boolean
  /**
   * A scenario is handing over to another one, named by a path relative to
   * the quest it came from. `EventManager.cs:171` checks for this before
   * anything else it would do with an event, because there is no event —
   * the whole quest is about to be replaced.
   */
  startQuest?: (path: string) => void
  /** The board and party state an event mutates. */
  runtime?: QuestRuntime
  /**
   * `RoundController.CheckNewRound`, asked before every event.
   *
   * Supplied by the session, which owns the round controller; the event
   * manager is constructed first, so this is a hook rather than a reference.
   */
  checkNewRound?: () => boolean
  /** Presents an event and resolves when the player answers with a button. */
  present?: (event: EventDefinition) => void
  /** Plays a sound named by the event. */
  /**
   * A sound the quest asked for.
   *
   * `Play(file)` and `PlayTrait(trait)` are different things in the C# — one
   * names a sound, the other picks at random among every sound carrying a
   * trait — so which is meant is said rather than guessed from the string.
   */
  playAudio?: (request: AudioRequest) => void
  /** `Random.Range(0, n)`, injectable so tests are deterministic. */
  random?: (count: number) => number
  /**
   * `game.roundControl`. Set once the round controller exists — the C# reaches
   * back into it from `EndEvent` when the stack drains during the monster
   * phase.
   */
  rounds?: RoundHook
}

/** The slice of the round controller the event engine calls back into. */
export interface RoundHook {
  /** True while the quest is in `MoMPhase.monsters`. */
  inMonsterPhase(): boolean
  monsterActivated(): void
}

export class EventManager {
  /** Events waiting to run, most recent first. `Stack<Event>` in the C#. */
  private readonly stack: string[] = []
  /** Names resolved to quest transitions, which the C# adds to `events`. */
  private readonly questTransitions = new Set<string>()

  current: EventDefinition | null = null

  /**
   * Puts a saved queue back, `EventManager(saveData)`.
   *
   * The current event is restored by name only: what it *is* comes from the
   * quest's own components, which are loaded before this runs.
   */
  definition(name: string): EventDefinition | null {
    return this.context.events.get(name) ?? null
  }

  /** `[EventList]`: the events already answered, which the end screen lists. */
  restoreHistory(names: readonly string[]): void {
    this.answered.length = 0
    this.answered.push(...names)
  }

  restoreQueue(queued: readonly string[], current: EventDefinition | null): void {
    this.stack.length = 0
    this.stack.push(...queued)
    this.current = current
  }
  /**
   * `monsterimage`: the monster whose portrait an event shows. Cleared when
   * the event stack drains, matching the C#.
   */
  monsterImage: MonsterInstance | null = null

  /**
   * `Quest.eventList`: the events the player has answered, in order.
   *
   * Recorded when a button is pressed rather than when the event fires, which
   * is where `DialogWindow.cs:313` puts it — so an event queued but never
   * reached is absent, and one answered twice appears twice.
   */
  private readonly answered: string[] = []

  /** The events answered so far, oldest first. Written into a save. */
  get history(): readonly string[] {
    return this.answered
  }
  /** Set when `$end` is non-zero at the end of an event. */
  questHasEnded = false

  constructor(private readonly context: EventContext) {}

  /** Events currently queued, outermost last. Exposed for tests and saves. */
  get queued(): readonly string[] {
    return this.stack
  }

  /**
   * `EventTriggerType`: queues every event whose `trigger` matches.
   *
   * Note it queues *all* matches, not the first, and the return value is the
   * OR of whether any queued — which the C# uses to decide whether anything
   * happened at all.
   */
  triggerType(type: string, trigger = true): boolean {
    let queued = false
    for (const [name, event] of this.context.events) {
      if (event.trigger === type) queued = this.queue(name, trigger) || queued
    }
    return queued
  }

  /**
   * `QueueEvent`: pushes an event, and runs it if nothing else is running.
   *
   * A name that is not an event may be another quest file, which the C# turns
   * into a `StartEventDefinition`. An unknown name is logged and skipped rather
   * than throwing — scenarios do ship with dangling references.
   */
  queue(name: string, trigger = true): boolean {
    if (!this.context.events.has(name)) {
      if (this.context.isQuestTransition?.(name) === true) {
        this.questTransitions.add(name)
      } else {
        this.warn(`Warning: Missing event called: ${name}`)
        return false
      }
    }

    if (this.isDisabled(name)) return false

    this.stack.push(name)
    if (this.current === null && trigger) this.triggerEvent()
    return true
  }

  /** Whether an event's var tests currently fail. `Event.Disabled()`. */
  isDisabled(name: string): boolean {
    if (this.questTransitions.has(name)) return false
    const event = this.context.events.get(name)
    if (event === undefined) return true
    return !this.context.vars.test(event.tests)
  }

  /**
   * `TriggerEvent`: takes the next event off the stack and presents it.
   *
   * The C# re-checks `Disabled` here as well as on queueing, because a var can
   * change between the two.
   */
  triggerEvent(): void {
    if (this.current !== null) return

    // `EventManager.cs:161`, and the first thing it does: every attempt to run
    // the next event asks whether the round should turn over first. It is what
    // moves the mythos on when nothing was added — `HeroActivated` says as
    // much where it calls this — and without it a phase with no events of its
    // own waits for a button that should not have to exist.
    if (this.context.checkNewRound?.() === true) return

    while (this.stack.length > 0) {
      const name = this.stack.pop()
      if (name === undefined) return

      // Before the lookup, not after: a transition has no event to find, and
      // treating it as a missing one drops the handover silently.
      if (this.questTransitions.has(name)) {
        this.context.startQuest?.(name)
        return
      }

      if (this.isDisabled(name)) continue

      const event = this.context.events.get(name)
      if (event === undefined) continue

      this.current = event
      this.applyEffects(event)
      this.context.present?.(event)
      return
    }
  }

  /**
   * `EndEvent`: the player pressed button `state`, so chain onward.
   *
   * The order matters and is easy to get wrong: the chained events are
   * filtered to those currently enabled, `$end` is checked *before* anything
   * is queued, and only **one** event is queued — the first, or a random one
   * when `randomEvents` is set. The rest of the button's list is discarded.
   */
  endEvent(state = 0): void {
    const event = this.current
    if (event === null) return

    this.answered.push(event.sectionName)

    const names = event.buttons[state]?.eventNames ?? []
    const enabled: string[] = []

    for (const name of names) {
      if (!this.context.events.has(name)) {
        if (this.context.isQuestTransition?.(name) === true) {
          this.questTransitions.add(name)
          enabled.push(name)
        } else {
          this.warn(`Warning: Missing event called: ${name}`)
        }
      } else if (!this.isDisabled(name)) {
        enabled.push(name)
      }
    }

    // Checked before queueing anything: an event that sets $end ends the
    // quest even if its button also chains onward.
    if (this.context.vars.getValue('$end') !== 0) {
      this.questHasEnded = true
      this.current = null
      return
    }

    this.current = null

    if (enabled.length > 0) {
      const index = event.randomEvents ? (this.context.random ?? defaultRandom)(enabled.length) : 0
      const chosen = enabled[index] ?? enabled[0]
      if (chosen !== undefined) this.queue(chosen, false)
    }

    this.addCustomTriggers()

    if (this.stack.length === 0) {
      this.monsterImage = null
      if (this.context.rounds?.inMonsterPhase() === true) {
        this.context.rounds.monsterActivated()
        return
      }
    }

    this.triggerEvent()
  }

  /**
   * `AddCustomTriggers`: a scenario raises `@name` and the engine fires
   * `Varname`, resetting the flag so it fires once.
   *
   * The two prefixes are separate namespaces — `@` is quest-scoped and `$@`
   * survives between quests in a campaign — but both collapse to the same
   * `Var` trigger name.
   */
  private addCustomTriggers(): void {
    for (const [key, value] of this.context.vars.getPrefixVars('@')) {
      if (value <= 0) continue
      this.context.vars.setValue(key, 0)
      this.triggerType(`Var${key.slice(1)}`, false)
    }
    for (const [key, value] of this.context.vars.getPrefixVars('$@')) {
      if (value <= 0) continue
      this.context.vars.setValue(key, 0)
      this.triggerType(`Var$${key.slice(2)}`, false)
    }
  }

  /**
   * What an event does when it runs, before the player sees it.
   *
   * The order is the C#'s and matters: audio, then operations, then the board
   * changes. An operation can gate a component that the same event adds, so
   * running `add` first would place something the operation was meant to
   * prevent.
   */
  private applyEffects(event: EventDefinition): void {
    if (event.audio !== undefined && event.audio.length > 0) {
      this.context.playAudio?.({ kind: 'effect', name: event.audio })
    }

    // `EventManager.cs:196`. An empty list leaves the playlist alone, which is
    // what lets music carry across the events between two that set it.
    if (event.music !== undefined && event.music.length > 0) {
      this.context.playAudio?.({ kind: 'music', names: event.music })
    }

    if (event.operations !== undefined) {
      this.context.vars.performAll(event.operations)
    }

    const runtime = this.context.runtime
    if (runtime === undefined) return

    if (event.addComponents !== undefined) runtime.add(event.addComponents)
    if (event.removeComponents !== undefined) runtime.remove(event.removeComponents)

    // After the board changes and in this order, as `EventManager.cs:304`
    // does it: a position on an ordinary event says where to look, and one on
    // an event carrying `mincam`/`maxcam` bounds the panning instead. A `UI`
    // element's position places the element and never the camera.
    const at = event.location
    if (at !== undefined) {
      if (event.locationSpecified === true && event.isUi !== true) {
        this.context.camera?.({ kind: 'look', at })
      }
      if (event.minCam === true) this.context.camera?.({ kind: 'min', at })
      if (event.maxCam === true) this.context.camera?.({ kind: 'max', at })
    }
  }

  private warn(message: string): void {
    // The C# logs these into the quest log as editor entries, so a scenario
    // author sees them without them reaching players.
    this.context.log.add(new LogEntry(message, true))
  }
}

function defaultRandom(count: number): number {
  return Math.floor(Math.random() * count)
}
