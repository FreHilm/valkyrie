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
import { QuestRuntime } from './QuestRuntime.js'
import type { MonsterInstance } from './QuestRuntime.js'
import { MoMPhase, RoundControllerMoM } from './RoundController.js'
import type { RoundRequest } from './RoundController.js'
import type { QuestBundle } from './questAdapter.js'
import { QuestButtonData } from './QuestButtonData.js'
import type { QuestComponent } from './QuestComponent.js'
import { QuestEvent } from './QuestComponent.js'
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

export type SessionView =
  | { kind: 'event'; name: string; text: string; buttons: SessionButton[] }
  | { kind: 'activation'; monster: MonsterInstance; activation: ActivationInstance }
  | { kind: 'phase'; phase: MoMPhase }
  | { kind: 'ended' }
  | { kind: 'board' }

export interface SessionOptions {
  bundle: QuestBundle
  /** The parsed components, for the text and buttons an event shows. */
  components: ReadonlyMap<string, QuestComponent>
  gameType?: 'MoM' | 'D2E'
  localization?: Localization
  /** `Random.Range(0, n)`, injectable so a session can be replayed. */
  random?: (count: number) => number
  playAudio?: (name: string) => void
  save?: () => void
}

export class QuestSession {
  readonly runtime: QuestRuntime
  readonly events: EventManager
  readonly rounds: RoundControllerMoM

  private pending: RoundRequest | null = null
  private readonly options: SessionOptions
  private readonly gameType: 'MoM' | 'D2E'

  constructor(options: SessionOptions) {
    this.options = options
    this.gameType = options.gameType ?? 'MoM'

    const random = options.random ?? ((count) => Math.floor(Math.random() * count))
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
      present: () => {},
      rounds: {
        inMonsterPhase: () => this.rounds.inMonsterPhase(),
        monsterActivated: () => this.rounds.monsterActivated(),
      },
    })

    this.rounds = new RoundControllerMoM({
      runtime: this.runtime,
      events: this.events,
      monsterTypes: options.bundle.monsterTypes,
      contentActivations: new Map(),
      questActivations: options.bundle.activations,
      random,
      present: (request) => {
        this.pending = request
      },
      resolveActivation: (activation, monster) => this.resolve(activation, monster),
      ...(options.playAudio === undefined ? {} : { playAudio: options.playAudio }),
      ...(options.save === undefined ? {} : { save: options.save }),
    })
  }

  /** Fires the quest's `EventStart` trigger. */
  start(): void {
    this.events.triggerType('EventStart')
    this.settle()
  }

  /**
   * What should be on screen.
   *
   * Order matters: an open event outranks a pending activation, because an
   * event raised *during* an activation is what the player has to answer
   * first.
   */
  view(): SessionView {
    if (this.events.questHasEnded) return { kind: 'ended' }

    const current = this.events.current
    if (current !== null) {
      return {
        kind: 'event',
        name: current.sectionName,
        text: this.eventText(current.sectionName),
        buttons: this.buttons(current.sectionName),
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

  /** The player pressed a button. */
  press(index: number): void {
    this.pending = null
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
    this.pending = null
    this.rounds.heroActivated()
  }

  /** The player clicked something on the board that fires an event. */
  activate(name: string): void {
    this.events.queue(name)
  }

  /** A monster was defeated. */
  defeat(monster: MonsterInstance): void {
    this.pending = null
    this.rounds.defeated(monster)
  }

  /** Advances the round when the engine allows it. */
  endRound(): boolean {
    return this.rounds.checkNewRound()
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
