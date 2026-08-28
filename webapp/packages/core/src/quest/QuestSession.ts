/**
 * A quest in progress: the engine wired together, and what should be on screen.
 *
 * The C# has no equivalent. Its screens call into `Game.Get().CurrentQuest`
 * directly and build themselves in their constructors, so "what should be
 * showing" is never a value anywhere — it is implied by which `GameObject`s
 * happen to exist. That is why the play loop cannot be tested there and can be
 * here: this exposes the same decision as data.
 *
 * The session owns no rendering. It answers `view()` and takes the player's
 * answers back.
 */

import { ActivationInstance } from './ActivationInstance.js'
import type { ActivationView } from './ActivationInstance.js'
import { EventManager } from './EventManager.js'
import { IniData } from '../ini/IniData.js'
import { readFromString } from '../ini/IniRead.js'
import { parseIntInvariant } from '../config/parse.js'
import { QuestLog } from './QuestLog.js'
import { packVariables } from '../content/packSelection.js'
import type { AudioRequest, CameraCommand } from './EventManager.js'
import { QuestRuntime } from './QuestRuntime.js'
import type { MonsterInstance } from './QuestRuntime.js'
import { MoMPhase, RoundControllerMoM, roundToInt } from './RoundController.js'
import { runtimeMonsterSelection } from './monsterSelection.js'
import type { TraitedMonster } from './monsterSelection.js'

/**
 * A content monster, as both selection and activation need it.
 *
 * `traits` decides whether a trait-based spawn matches it; `activations` and
 * the section name decide what it does on its turn. `MonsterData` supplies
 * both, so the session takes one map rather than two that could disagree.
 */
export interface ContentMonsterView extends TraitedMonster {
  sectionName?: string
  activations?: readonly string[]
}
import type { MonsterTypeView, RoundRequest } from './RoundController.js'
import type { QuestBundle } from './questAdapter.js'
import { QuestButtonData } from './QuestButtonData.js'
import type { QuestComponent } from './QuestComponent.js'
import { Puzzle as QuestPuzzle, QuestEvent, Spawn as QuestSpawn } from './QuestComponent.js'
import { PuzzleCode, PuzzleImage, PuzzleSlide, PuzzleTower, restorePuzzle } from './puzzles.js'
import type { PuzzleState } from './puzzles.js'
import type { ContentFields } from '../content/types.js'
import { outputSymbolReplace } from './symbols.js'
import type { Localization } from '../i18n/Localization.js'
import { LogEntry } from './QuestLog.js'

/** `CommonStringKeys.CONTINUE`, the fallback when nothing else is pressable. */
const CONTINUE_LABEL = 'Continue'

/** A button as the player sees it. */
export interface SessionButton {
  /** Already translated and symbol-substituted. */
  label: string
  /** The index to pass back to `press`. */
  index: number
  /** Shown but not pressable — a failed condition with the DISABLE action. */
  disabled: boolean
}

/** As `QuestComponent` reads them: a missing or unparseable field is zero. */
const intOrZero = (value: string | undefined): number =>
  value === undefined ? 0 : (parseIntInvariant(value) ?? 0)
const boolOrFalse = (value: string | undefined): boolean =>
  value !== undefined && value.trim().toLowerCase() === 'true'

/**
 * What an undo point records.
 *
 * None of the file metadata matters to an undo — it never leaves memory and
 * the quest it belongs to is already loaded — and the log is left out because
 * an undo does not rewind what the player has read.
 */
const UNDO_STATE: SaveStateOptions = {
  questPath: '',
  originalPath: '',
  questName: '',
  valkyrieVersion: '',
  packs: [],
  duration: 0,
  time: '',
  includeLog: false,
}

/** What a save records that the quest itself does not know. */
export interface SaveStateOptions {
  /** `path`: where the scenario was loaded from. */
  questPath: string
  /** `originalpath`: the package it came from, which a load re-extracts. */
  originalPath: string
  questName: string
  valkyrieVersion: string
  /** The packs that were loaded, so a load can ask for the same ones. */
  packs: readonly string[]
  /** Whole minutes played, carried across sessions. */
  duration: number
  /** Injected rather than read from a clock, so a replay is deterministic. */
  time: string
  /**
   * `ToString(false)`. The undo stack leaves the log out — an undo restores
   * the board, not what the player has read.
   */
  includeLog?: boolean
}

/**
 * An event that asks the player for a number, `DialogWindow.CreateQuotaWindow`.
 *
 * Not "press it N times": the dialog is a spinner the player dials, and what
 * they dial is either written into a variable or added to a running total.
 */
export interface QuotaRequest {
  /** What the spinner starts on. A `quotaVar` event starts on its value. */
  value: number
  /** `quotaInc` stops here. */
  max: number
}

/** A puzzle in progress, with the state the screens read. */
export interface ActivePuzzle {
  name: string
  kind: 'slide' | 'code' | 'image' | 'tower'
  state: PuzzleState
  /** Solved puzzles offer the event's button; unsolved ones offer a way out. */
  solved: boolean
}

export type SessionView =
  | {
      kind: 'event'
      name: string
      text: string
      buttons: SessionButton[]
      /** Present when the event asks for a number instead of a choice. */
      quota?: QuotaRequest
      /** `AddHighlight`: the board space this event points at. */
      highlight?: { x: number; y: number }
      /**
       * `DrawItem`: the one item this event hands over, already resolved to
       * the card it turned into. Shown on the board when the event is a
       * highlight, and beside the dialog when it is not.
       */
      grantedItem?: string
    }
  | { kind: 'puzzle'; puzzle: ActivePuzzle }
  | { kind: 'activation'; monster: MonsterInstance; activation: ActivationInstance }
  | { kind: 'phase'; phase: MoMPhase }
  | { kind: 'ended' }
  /**
   * The scenario is handing over to another one. `path` names its `quest.ini`
   * relative to the directory this quest was loaded from.
   */
  | { kind: 'changeQuest'; path: string }
  | { kind: 'board' }

export interface SessionOptions {
  bundle: QuestBundle
  /**
   * The content packs in play. `Quest.cs:237` turns each into a `#<packId>`
   * variable, and a scenario tests them to decide what it may ask the player
   * to place — House Lynch opens by checking for the first-edition tiles.
   */
  loadedPacks?: Iterable<string>
  /**
   * Whether a name a scenario queues is another scenario rather than one of
   * its own events. `EventManager.cs:129` answers it with `File.Exists`; the
   * caller here answers it from a listing, because the check has to be
   * synchronous and a filesystem behind promises is not.
   */
  isQuestTransition?: (name: string) => boolean
  /**
   * Where an event asks the camera to look, or how far it may be panned.
   * Pushed rather than pulled through `view()`, because it is an instruction
   * that happens once rather than a state the screen can re-read.
   */
  camera?: (command: CameraCommand) => void
  /**
   * Content monsters, in the order the content data yields them. Without them
   * a spawn that names a content type — which is most of them — resolves to
   * nothing and the scenario silently fights no one.
   */
  contentMonsters?: ReadonlyMap<string, ContentMonsterView>
  /**
   * Content `MonsterActivation` sections, keyed by section name. A monster
   * whose type names none of its own draws from these; without them every
   * activation fails and the monster phase does nothing.
   */
  contentActivations?: ReadonlyMap<string, ActivationView>
  /**
   * Slide puzzle layouts, from `Resources/slidepuzzles.txt`. They are shipped
   * data rather than generated, so without them a slide puzzle cannot be
   * built at all.
   */
  slideLayouts?: ReadonlyMap<string, ContentFields>
  /** The parsed components, for the text and buttons an event shows. */
  components: ReadonlyMap<string, QuestComponent>
  gameType?: 'MoM' | 'D2E'
  localization?: Localization
  /** `Random.Range(0, n)`, injectable so a session can be replayed. */
  random?: (count: number) => number
  /** A sound the quest asked for: an effect, a trait, or a music playlist. */
  playAudio?: (request: AudioRequest) => void
  save?: () => void
}

export class QuestSession {
  readonly runtime: QuestRuntime
  readonly events: EventManager
  readonly rounds: RoundControllerMoM

  private pending: RoundRequest | null = null

  /** Set once a scenario has handed over; the host reloads and starts again. */
  private pendingQuest: string | null = null
  /** `Quest.monsterSelect`: what each spawn section resolved to. */
  private readonly monsterSelect = new Map<string, string>()
  /** `Quest.puzzle`: puzzles in progress, kept until solved. */
  private readonly puzzles = new Map<string, PuzzleState>()
  /** `Quest.undo`: states to step back to, most recent last. */
  private readonly undoStack: string[] = []
  private readonly options: SessionOptions
  private readonly gameType: 'MoM' | 'D2E'
  private readonly random: (count: number) => number

  constructor(options: SessionOptions) {
    this.options = options
    this.gameType = options.gameType ?? 'MoM'

    const random = options.random ?? ((count) => Math.floor(Math.random() * count))
    this.random = random
    this.runtime = new QuestRuntime({
      components: options.bundle.components,
      events: options.bundle.events,
      monstersGrouped: this.gameType === 'D2E',
    })

    this.events = new EventManager({
      vars: this.runtime.vars,
      log: this.runtime.log,
      events: options.bundle.events,
      runtime: this.runtime,
      random,
      ...(options.playAudio === undefined ? {} : { playAudio: options.playAudio }),
      // Presentation is pulled through `view()` rather than pushed, so the
      // engine does not need to know a screen exists.
      present: (event) => {
        this.placeSpawn(event.sectionName)
      },
      ...(options.isQuestTransition === undefined
        ? {}
        : { isQuestTransition: options.isQuestTransition }),
      startQuest: (path) => {
        this.pendingQuest = path
      },
      ...(options.camera === undefined ? {} : { camera: options.camera }),
      rounds: {
        inMonsterPhase: () => this.rounds.inMonsterPhase(),
        monsterActivated: () => this.rounds.monsterActivated(),
      },
    })

    this.rounds = new RoundControllerMoM({
      runtime: this.runtime,
      events: this.events,
      // Quest monsters and content monsters both need to be here: a spawn can
      // resolve to either, and a type absent from this map draws no
      // activations at all — which reads as "no activation data" and skips the
      // monster's turn entirely.
      monsterTypes: mergeMonsterTypes(options.bundle.monsterTypes, options.contentMonsters),
      contentActivations: options.contentActivations ?? new Map(),
      questActivations: options.bundle.activations,
      random,
      present: (request) => {
        this.pending = request
      },
      resolveActivation: (activation, monster) => this.resolve(activation, monster),
      ...(options.playAudio === undefined ? {} : { playAudio: options.playAudio }),
      ...(options.save === undefined ? {} : { save: options.save }),
    })

    this.setPackVariables()
  }

  /**
   * `Quest.cs:237`. Set in the constructor and again on a handover, because
   * `TrimQuest` drops them and the scenario being handed to tests them too.
   */
  private setPackVariables(): void {
    for (const [name, value] of packVariables(this.options.loadedPacks ?? [])) {
      this.runtime.vars.setValue(name, value)
    }
  }

  /** Fires the quest's `EventStart` trigger. */
  start(): void {
    this.events.triggerType('EventStart')
    this.settle()
    // `Quest.cs:770` writes the autosave once the opening event has run, so a
    // player who closes the tab during the first round still has a game.
    this.options.save?.()
  }

  /**
   * Drops the state a handover does not carry across.
   *
   * `Quest.ChangeQuest` keeps the heroes and the campaign-scoped variables —
   * `VarManager.TrimQuest` keeps `%` and `$%` and nothing else — and starts
   * the rest over. The board, the monsters and the items belong to the
   * scenario that is being left behind.
   */
  changeQuest(): void {
    this.pendingQuest = null
    this.pending = null
    this.runtime.vars.trimQuest()
    this.runtime.resetForNewQuest()
    this.setPackVariables()
  }

  /**
   * What should be on screen.
   *
   * Order matters: an open event outranks a pending activation, because an
   * event raised *during* an activation is what the player has to answer
   * first.
   */
  view(): SessionView {
    // Ahead of everything: the quest this is a view of is about to be
    // replaced, so nothing else it could report is worth reporting.
    if (this.pendingQuest !== null) return { kind: 'changeQuest', path: this.pendingQuest }
    if (this.events.questHasEnded) return { kind: 'ended' }

    const current = this.events.current
    if (current !== null) {
      const puzzle = this.puzzleFor(current.sectionName)
      // A puzzle event opens the puzzle instead of a dialog, and returns
      // (`EventManager.cs:309`); its buttons only appear once it is solved.
      if (puzzle !== null) return { kind: 'puzzle', puzzle }

      const quota = this.quotaFor(current.sectionName)
      const buttons = this.buttons(current.sectionName)
      const component = this.options.components.get(current.sectionName)
      const event = component instanceof QuestEvent ? component : null
      const granted = this.grantedItem(event)
      return {
        kind: 'event',
        name: current.sectionName,
        text: this.eventText(current.sectionName),
        // `CreateQuotaWindow` draws `GetButtons()[0]` and nothing else,
        // whatever the event declares — the second button is the outcome for
        // a total that has not got there yet, not something to press.
        buttons: quota === null ? buttons : buttons.slice(0, 1),
        ...(quota === null ? {} : { quota }),
        ...(event?.highlight === true ? { highlight: { ...event.location } } : {}),
        ...(granted === null ? {} : { grantedItem: granted }),
      }
    }

    const request = this.pending
    if (request !== null) {
      if (request.kind === 'activationMoM' && request.monster.currentActivation !== null) {
        return {
          kind: 'activation',
          monster: request.monster,
          activation: request.monster.currentActivation,
        }
      }
      if (request.kind === 'phaseTransition') return { kind: 'phase', phase: request.phase }
    }

    return { kind: 'board' }
  }

  /**
   * The puzzle for an event, created on first sight and kept until solved.
   *
   * `Quest.puzzle` holds them so a player who steps away comes back to the
   * same board rather than a fresh one.
   */
  private puzzleFor(name: string): ActivePuzzle | null {
    const component = this.options.components.get(name)
    if (!(component instanceof QuestPuzzle)) return null

    let state = this.puzzles.get(name)
    if (state === undefined) {
      const built = this.createPuzzle(component)
      if (built === null) {
        this.warn(`Error: Unable to build the ${component.puzzleClass} puzzle: ${name}`)
        return null
      }
      state = built
      this.puzzles.set(name, state)
    }

    return {
      name,
      kind: component.puzzleClass as ActivePuzzle['kind'],
      state,
      solved: state.solved(),
    }
  }

  private createPuzzle(component: QuestPuzzle): PuzzleState | null {
    const range = (min: number, max: number): number => min + this.random(max - min)
    switch (component.puzzleClass) {
      case 'code':
        return PuzzleCode.create(
          component.puzzleLevel,
          component.puzzleAltLevel,
          component.puzzleSolution,
          range,
        )
      case 'image':
        return PuzzleImage.generate(component.puzzleLevel, component.puzzleAltLevel, range)
      case 'tower':
        return PuzzleTower.generate(component.puzzleLevel, range)
      case 'slide':
        // The layouts are shipped data rather than generated, so a caller that
        // has not supplied them gets nothing rather than an empty board.
        return PuzzleSlide.generate(
          component.puzzleLevel,
          this.options.slideLayouts ?? new Map(),
          range,
        )
      default:
        return null
    }
  }

  /**
   * The player solved a puzzle and took the event's button.
   *
   * The state is discarded, so a scenario that opens the same puzzle again
   * gets a fresh one — which is what `Finished` does in the C#.
   */
  finishPuzzle(name: string): void {
    this.puzzles.delete(name)
    this.pending = null
    this.events.endEvent(0)
    this.settle()
  }

  /**
   * The player closed a puzzle without solving it.
   *
   * The state is kept, so they come back to the same board. The event is
   * cleared rather than ended, because nothing has been chosen yet.
   */
  closePuzzle(): void {
    this.pending = null
    this.events.current = null
    this.events.triggerEvent()
    this.settle()
  }

  /** The player pressed a button. */
  /**
   * The single item an event hands over, resolved to the card it became.
   *
   * `TokenBoard.AddHighlight` and `DialogWindow.DrawItem` ask the same
   * question: exactly one `QItem` among the components this event adds, and
   * one the quest has already resolved. Anything else — none, or several — and
   * neither draws a card.
   */
  private grantedItem(event: QuestEvent | null): string | null {
    if (event === null) return null
    const items = event.addComponents.filter((name) => name.startsWith('QItem'))
    if (items.length !== 1) return null
    return this.runtime.itemSelect.get(items[0]!) ?? null
  }

  /** `quotaInc` greys out at ten, so that is as high as the spinner goes. */
  private static readonly QUOTA_MAX = 10

  /**
   * The spinner an event asks for, or null when it asks for a choice.
   *
   * `DialogWindow.cs:48`: either a numeric `quota` or a `quotaVar` naming the
   * variable to read and write. A `quotaVar` dialog opens on that variable's
   * current value; a numeric one opens on nothing.
   */
  private quotaFor(name: string): QuotaRequest | null {
    const component = this.options.components.get(name)
    if (!(component instanceof QuestEvent)) return null
    if (component.quota <= 0 && component.quotaVar.length === 0) return null

    const value =
      component.quotaVar.length > 0 ? Math.round(this.runtime.vars.getValue(component.quotaVar)) : 0
    return { value, max: QuestSession.QUOTA_MAX }
  }

  /**
   * The player dialled a number and pressed the button, `DialogWindow.onQuota`.
   *
   * A `quotaVar` event writes it to the variable and takes its first button.
   * A numeric one adds it to the event's running total and takes the first
   * button only once the total has got there — otherwise the second, which is
   * where a scenario writes "you found nothing this time".
   */
  pressQuota(value: number): void {
    const current = this.events.current
    if (current === null) return
    const component = this.options.components.get(current.sectionName)
    if (!(component instanceof QuestEvent)) return

    const dialled = Math.round(value)

    if (component.quotaVar.length > 0) {
      this.runtime.vars.setValue(component.quotaVar, dialled)
      this.press(0)
      return
    }

    const name = current.sectionName
    const total = (this.runtime.eventQuota.get(name) ?? 0) + dialled
    this.runtime.eventQuota.set(name, total)

    if (total >= component.quota) {
      // Dropped rather than left at the total, so a scenario that runs the
      // same event again starts it over.
      this.runtime.eventQuota.delete(name)
      this.press(0)
      return
    }
    this.press(1)
  }

  press(index: number): void {
    this.pending = null
    // `DialogWindow.cs:302`: an event the player chose to open is one they can
    // back out of, and the point to return to is recorded before it runs.
    const opening = this.events.current
    if (opening !== null && this.isCancelable(opening.sectionName)) this.pushUndo()
    // `DialogWindow.onButton` writes the text the player just read into the
    // log before ending the event, escaping its newlines the way a save file
    // carries them. Only a dialog does this — an invisible event is ended
    // through `settle`, and the C# never builds a window for one, so the glue
    // a scenario chains between its pages stays out of the log.
    const current = this.events.current
    if (current !== null) {
      this.runtime.log.add(
        new LogEntry(this.eventText(current.sectionName).replace(/\n/g, '\\n')),
      )
    }
    this.events.endEvent(index)
    this.settle()
  }

  /**
   * Runs out every event the player is not meant to see.
   *
   * `display=false` marks an event as glue: the C# never raises a dialog for
   * one, it calls `EndEvent(firstEnabledButtonIndex)` straight away
   * (`EventManager.cs:347`). A scenario chains dozens of these between the
   * events a player actually reads, so without this the quest stops at the
   * first one — which is exactly what it did.
   *
   * The index is the count of *leading disabled* buttons, so a chain whose
   * first option is gated falls through to the next.
   */
  private settle(): void {
    // Bounded: a scenario can chain invisible events into a cycle, and a
    // hang is worse than a stuck quest that says so.
    for (let guard = 0; guard < 1000; guard++) {
      const current = this.events.current
      if (current === null) return
      const component = this.options.components.get(current.sectionName)
      if (!(component instanceof QuestEvent) || component.display) return
      this.events.endEvent(this.firstEnabledButton(component))
    }
    this.warn('Warning: too many chained invisible events; the quest may be looping')
  }

  /** `TakeWhile(b => !IsButtonEnabled(b)).Count()`. */
  private firstEnabledButton(component: QuestEvent): number {
    let index = 0
    for (const button of component.buttons) {
      if (this.isButtonEnabled(button)) return index
      index++
    }
    return index
  }

  /** `IsButtonEnabled`: an unconditional button, or one whose tests pass. */
  private isButtonEnabled(button: QuestButtonData): boolean {
    if (button.conditionFailedAction === 'NONE') return true
    if (!button.hasCondition) return true
    return this.runtime.vars.test(button.condition)
  }

  /**
   * The quest's live state as save-file text, `Quest.ToString`.
   *
   * `includeLog` is false for the undo stack, which the C# also writes without
   * it: an undo restores the board, not what the player has read.
   *
   * DEVIATION, settled in `adr/0001`: saves do not interoperate with the Unity
   * build, so this records what this port models rather than every key the C#
   * emits. Absent are the camera position, hero skills and classes, and shops
   * — none of which exist here. The shape is the C#'s because the reader
   * already parses it, not because a Unity build could open it.
   */
  toSaveString(options: SaveStateOptions): string {
    const nl = '\n'
    let r = `[Quest]${nl}`
    r += `time=${options.time}${nl}`
    r += `duration=${String(options.duration)}${nl}`
    r += `valkyrie=${options.valkyrieVersion}${nl}`
    r += `path=${options.questPath}${nl}`
    r += `originalpath=${options.originalPath}${nl}`
    r += `questname=${options.questName}${nl}`
    r += `horror=${this.rounds.phase === MoMPhase.horror ? 'True' : 'False'}${nl}`
    r += `heroesSelected=${this.runtime.heroes.length > 0 ? 'True' : 'False'}${nl}`

    r += `${nl}[Packs]${nl}`
    for (const pack of options.packs) r += `${pack}${nl}`

    // `ordered_boardItems` in the C#, and ordered for the same reason: what
    // covers what on the board is the order things were added in.
    r += `${nl}[Board]${nl}`
    // A name starting with '#' would be read back as a comment, which is why
    // the C# escapes every one of them.
    for (const item of this.runtime.boardItems()) r += `\\${item.name}${nl}`

    r += nl + this.runtime.vars.toString()

    r += `[Items]${nl}`
    for (const item of this.runtime.items()) r += `${item}${nl}`

    r += `${nl}[EventQuota]${nl}`
    for (const [name, count] of this.runtime.eventQuota) r += `${name}=${String(count)}${nl}`

    for (const [index, hero] of this.runtime.heroes.entries()) {
      r += `${nl}[Hero${String(index)}]${nl}`
      r += `id=${String(index)}${nl}`
      r += `activated=${hero.activated ? 'True' : 'False'}${nl}`
      if (hero.heroName !== null) r += `type=${hero.heroName}${nl}`
    }

    for (const [index, monster] of this.runtime.monsters.entries()) {
      // The C# keys this by type plus a duplicate number; the index is what
      // makes it unique here, and it is what the board order already uses.
      r += `${nl}[Monster${String(index)}]${nl}`
      r += `type=${monster.monsterName}${nl}`
      r += `activated=${monster.activated ? 'True' : 'False'}${nl}`
      r += `minionStarted=${monster.minionStarted ? 'True' : 'False'}${nl}`
      r += `masterStarted=${monster.masterStarted ? 'True' : 'False'}${nl}`
      r += `unique=${monster.unique ? 'True' : 'False'}${nl}`
      r += `damage=${String(monster.damage)}${nl}`
      r += `healthmod=${String(monster.health)}${nl}`
      r += `spawnEventName=${monster.spawnedBy}${nl}`
      const activation = monster.currentActivation
      if (activation !== null) r += `activation=${activation.ad.sectionName}${nl}`
    }

    for (const [name, puzzle] of this.puzzles) r += nl + puzzle.toSectionString(name)

    r += `${nl}[Log]${nl}`
    if (options.includeLog !== false) r += this.runtime.log.toString()

    r += `${nl}[EventList]${nl}`
    for (const [index, name] of this.events.history.entries()) {
      r += `Event${String(index)}=${name}${nl}`
    }

    r += `${nl}[SelectMonster]${nl}`
    for (const [spawn, monster] of this.monsterSelect) r += `${spawn}=${monster}${nl}`

    r += `${nl}[SelectItem]${nl}`
    for (const [item, resolved] of this.runtime.itemSelect) r += `${item}=${resolved}${nl}`

    r += `${nl}[ItemInspect]${nl}`
    for (const [item, event] of this.runtime.itemInspect) r += `${item}=${event}${nl}`

    r += `${nl}[EventManager]${nl}`
    r += `queue=${this.events.queued.join(' ')}${nl}`
    if (this.events.current !== null) r += `currentevent=${this.events.current.sectionName}${nl}`

    return r
  }

  /**
   * `Quest.Save`: records a point an undo can return to.
   *
   * Pushed *before* the thing that might be undone, which is why the C# calls
   * it from the button handler rather than after the event has run.
   *
   * The stack is unbounded, as the C#'s is. A long quest keeps every state it
   * has been in, which is a few tens of KB per entry and the price of being
   * able to step back more than once.
   */
  private isCancelable(name: string): boolean {
    const component = this.options.components.get(name)
    return component instanceof QuestEvent && component.cancelable
  }

  pushUndo(): void {
    this.undoStack.push(this.toSaveString(UNDO_STATE))
  }

  /** Whether there is anything to step back to. */
  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  /**
   * `Quest.Undo`: steps back to the last recorded point.
   *
   * The log is not rewound. The C# carries the live log across the restore
   * and appends a notice, because what the player has read is a record of the
   * session rather than part of the state being undone — and losing it would
   * hide that the undo happened at all.
   */
  undo(): boolean {
    const previous = this.undoStack.pop()
    if (previous === undefined) return false

    const log = this.runtime.log.toArray()
    this.restoreFrom(readFromString(previous))
    this.runtime.restoreLog(QuestLog.fromEntries(log))
    this.runtime.log.add(new LogEntry('Notice: Undo', true))
    return true
  }

  /**
   * Puts a saved state back onto a freshly loaded quest, `Quest(saveData)`.
   *
   * The quest's components are already loaded — a save records *state*, not
   * content — so everything here is looked up by name against what the
   * scenario declares. A name the scenario no longer has is dropped rather
   * than resurrected, which is what happens when a save outlives an edit.
   */
  restoreFrom(data: IniData): void {
    const runtime = this.runtime

    // Board, in the order it was written: what covers what depends on it.
    runtime.clearBoard()
    for (const name of data.getSection('Board')?.keys() ?? []) {
      // Written escaped so a leading '#' is not read as a comment.
      runtime.restoreBoardItem(name.startsWith('\\') ? name.slice(1) : name)
    }

    runtime.vars.restoreFrom(data.getSection('Vars') ?? new Map())

    runtime.restoreItems([...(data.getSection('Items')?.keys() ?? [])])

    runtime.eventQuota.clear()
    for (const [name, count] of data.getSection('EventQuota') ?? []) {
      runtime.eventQuota.set(name, intOrZero(count))
    }

    runtime.heroes.length = 0
    for (const [section, fields] of data.data) {
      if (!section.startsWith('Hero')) continue
      const type = fields.get('type')
      runtime.heroes.push({
        heroName: type === undefined || type.length === 0 ? null : type,
        activated: boolOrFalse(fields.get('activated')),
      })
    }

    runtime.monsters.length = 0
    for (const [section, fields] of data.data) {
      if (!section.startsWith('Monster')) continue
      const type = fields.get('type')
      if (type === undefined || type.length === 0) continue
      runtime.monsters.push({
        monsterName: type,
        spawnedBy: fields.get('spawnEventName') ?? '',
        unique: boolOrFalse(fields.get('unique')),
        health: intOrZero(fields.get('healthmod')),
        damage: intOrZero(fields.get('damage')),
        activated: boolOrFalse(fields.get('activated')),
        minionStarted: boolOrFalse(fields.get('minionStarted')),
        masterStarted: boolOrFalse(fields.get('masterStarted')),
        // The activation is redrawn rather than restored: the C# notes it
        // "currently doesn't save the effect string", so what it writes could
        // not be shown again anyway.
        currentActivation: null,
      })
    }

    this.puzzles.clear()
    for (const [section, fields] of data.data) {
      if (!section.startsWith('Puzzle')) continue
      const built = restorePuzzle(section, fields)
      if (built !== null) this.puzzles.set(built.name, built.state)
    }

    runtime.restoreLog(QuestLog.fromSection(data.getSection('Log') ?? new Map()))

    // `Event0=`, `Event1=` ... in order, which is what the end screen counts.
    this.events.restoreHistory([...(data.getSection('EventList')?.values() ?? [])])

    this.monsterSelect.clear()
    for (const [spawn, monster] of data.getSection('SelectMonster') ?? []) {
      this.monsterSelect.set(spawn, monster)
    }
    runtime.itemSelect.clear()
    for (const [item, resolved] of data.getSection('SelectItem') ?? []) {
      runtime.itemSelect.set(item, resolved)
    }
    runtime.itemInspect.clear()
    for (const [item, event] of data.getSection('ItemInspect') ?? []) {
      runtime.itemInspect.set(item, event)
    }

    this.rounds.phase =
      data.get('Quest', 'horror').toLowerCase() === 'true' ? MoMPhase.horror : MoMPhase.investigator

    // Last, because it decides what is on screen: the events the player had
    // not answered yet, and the one they were looking at.
    const queued = data.get('EventManager', 'queue').split(' ').filter((n) => n.length > 0)
    const currentName = data.get('EventManager', 'currentevent')
    const current = currentName.length === 0 ? null : this.events.definition(currentName)
    this.events.restoreQueue(queued, current)
    this.pending = null
  }

  /**
   * Records something the player read, in the log they can open.
   *
   * The combat dialogs each write their own text as they show it —
   * `ActivateDialogMoM.cs:35`, `InvestigatorAttack.cs:69`,
   * `InvestigatorEvade.cs:49`, `HorrorCheck.cs:65` — and all four escape the
   * newlines on the way in, which is how a save carries them.
   */
  logEntry(text: string): void {
    if (text.length === 0) return
    this.runtime.log.add(new LogEntry(text))
  }

  /** Records a setup problem in the quest log, as the C# logs one. */
  logWarning(message: string): void {
    this.warn(message)
  }

  private warn(message: string): void {
    this.runtime.log.add(new LogEntry(message, true))
  }

  /** The player finished a monster's activation. */
  activationDone(): void {
    this.pending = null
    this.rounds.monsterActivated()
  }

  /** The player acknowledged a phase change. */
  phaseAcknowledged(): void {
    this.pending = null
  }

  /** The investigators have finished their turn. */
  investigatorsDone(): void {
    // `NextStageButton.Next` records a point before advancing the round.
    this.pushUndo()
    this.pending = null
    this.rounds.heroActivated()
  }

  /** The player clicked something on the board that fires an event. */
  activate(name: string): void {
    this.events.queue(name)
    // Settling matters most here: a scenario's own UI is a chain of
    // `display=false` events — the button that turns a cutscene page adds the
    // next page and removes itself, and showing that as a dialog puts its
    // untranslated key on screen instead of turning the page.
    this.settle()
  }

  /** A monster was defeated. */
  defeat(monster: MonsterInstance): void {
    this.pending = null
    this.rounds.defeated(monster)
    // `defeated` fires `Defeated<type>` and `Defeated<spawn>`, and a scenario
    // usually writes those as invisible events that drop loot or open a door.
    this.settle()
  }

  /** Advances the round when the engine allows it. */
  endRound(): boolean {
    const advanced = this.rounds.checkNewRound()
    this.settle()
    return advanced
  }

  /**
   * The players are finished with the horror phase.
   *
   * `RoundControllerMoM.checkNewRound` refuses to turn the round over in the
   * horror phase while monsters remain, so that a random event cannot flip the
   * game back to the investigators before the horror checks are taken. Asking
   * explicitly is what lifts that.
   */
  endPhase(): boolean {
    this.pending = null
    this.rounds.endRound()
    this.settle()
    return this.endRound()
  }

  /**
   * A `Spawn` event places its monster when it runs.
   *
   * The C# does this inside `TriggerEvent` (`EventManager.cs:236`): resolve the
   * type, then add it — unless the game groups monsters and one of that type is
   * already present, in which case a unique spawn promotes the existing group
   * rather than adding a second.
   */
  private placeSpawn(name: string): void {
    const spawn = this.options.bundle.spawns.get(name)
    if (spawn === undefined) return

    const resolved = runtimeMonsterSelection(name, this.options.bundle.spawns, {
      contentMonsters: this.options.contentMonsters ?? new Map(),
      questMonsters: this.options.bundle.customMonsters,
      questComponents: new Set(this.options.components.keys()),
      selected: this.monsterSelect,
      onBoard: this.runtime.monsters.map((m) => m.monsterName),
      gameType: this.gameType,
      random: this.random,
      log: this.runtime.log,
    })
    if (!resolved) {
      this.warn(`Warning: Monster type unknown in event: ${name}`)
      return
    }

    const type = this.monsterSelect.get(name)
    if (type === undefined) return

    const component = this.options.components.get(name)
    const unique = component instanceof QuestSpawn && component.unique
    const healthMod =
      component instanceof QuestSpawn
        ? roundToInt(
            component.uniqueHealthBase + this.runtime.heroCount() * component.uniqueHealthHero,
          )
        : 0
    this.runtime.spawnMonster(type, name, unique, healthMod)
  }

  private resolve(activation: ActivationView, monster: MonsterInstance): ActivationInstance {
    return new ActivationInstance(activation, {
      monsterName: monster.monsterName,
      gameType: this.gameType,
      vars: this.runtime.vars,
      ...(this.options.localization === undefined
        ? {}
        : { localization: this.options.localization }),
      randomHeroName: () => this.runtime.heroes.find((h) => h.heroName !== null)?.heroName ?? '',
    })
  }

  /** An event's body text, translated and with symbols replaced. */
  private eventText(name: string): string {
    const component = this.options.components.get(name)
    if (!(component instanceof QuestEvent)) return ''
    const raw = component.text.translate(
      this.options.localization === undefined ? {} : { localization: this.options.localization },
    )
    return outputSymbolReplace(raw, {
      vars: this.runtime.vars,
      gameType: this.gameType,
    })
      .split('\\n')
      .join('\n')
  }

  /**
   * The buttons an event shows.
   *
   * A failed condition either hides the button or greys it out, and which one
   * is the button's own `conditionFailedAction` — conditional buttons disable
   * by default. The index passed back is the button's original position, so
   * hiding one does not renumber the rest.
   */
  private buttons(name: string): SessionButton[] {
    const component = this.options.components.get(name)
    if (!(component instanceof QuestEvent)) return []

    const result: SessionButton[] = []
    component.buttons.forEach((button: QuestButtonData, index: number) => {
      const failed = button.hasCondition && !this.runtime.vars.test(button.condition)
      if (failed && button.conditionFailedAction === 'HIDE') return
      result.push({
        label: this.buttonLabel(button),
        index,
        disabled: failed,
      })
    })

    // With nothing enabled the player would be trapped, so the C# adds a
    // Continue that simply ends the event. Its index is past the real buttons,
    // which `endEvent` reads as "no chained event".
    if (!component.buttons.some((button) => this.isButtonEnabled(button))) {
      result.push({ label: CONTINUE_LABEL, index: component.buttons.length, disabled: false })
    }
    return result
  }

  private buttonLabel(button: QuestButtonData): string {
    const raw = button.label.translate(
      this.options.localization === undefined ? {} : { localization: this.options.localization },
    )
    return outputSymbolReplace(raw, { vars: this.runtime.vars, gameType: this.gameType })
  }
}

/** Quest custom monsters over content monsters of the same name. */
function mergeMonsterTypes(
  questTypes: ReadonlyMap<string, MonsterTypeView>,
  contentMonsters: ReadonlyMap<string, ContentMonsterView> | undefined,
): Map<string, MonsterTypeView> {
  const merged = new Map<string, MonsterTypeView>()
  for (const [name, monster] of contentMonsters ?? []) {
    merged.set(name, {
      sectionName: monster.sectionName ?? name,
      activations: monster.activations ?? [],
    })
  }
  // A quest may redefine a content monster; its version wins, as the C#'s
  // `qd.components` check runs before the content lookup.
  for (const [name, type] of questTypes) merged.set(name, type)
  return merged
}
