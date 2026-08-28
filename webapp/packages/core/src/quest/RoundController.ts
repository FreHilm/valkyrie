/**
 * The round and activation loop, ported from
 * `unity/Assets/Scripts/Quest/RoundController.cs` and `RoundControllerMoM.cs`.
 *
 * This is the layer between the event engine and the screens: whose turn it
 * is, which monster acts next, and when the round ticks over. The C# drives
 * the UI directly from here — `new ActivateDialog(m, ...)` sits in the middle
 * of the decision logic — so the controller cannot be run without a screen.
 * Here it emits a request instead and the caller decides what to show, which
 * is what lets the whole loop be tested.
 */

import type { AudioRequest } from './EventManager.js'
import type { HeroInstance, MonsterInstance, QuestRuntime } from './QuestRuntime.js'
import { ActivationInstance } from './ActivationInstance.js'
import type { ActivationTextContext, ActivationView } from './ActivationInstance.js'
import { LogEntry } from './QuestLog.js'
import { log } from '../ini/logger.js'
import type { VarTests } from './VarTests.js'

/** `Quest.MoMPhase`. */
export enum MoMPhase {
  investigator = 'investigator',
  mythos = 'mythos',
  monsters = 'monsters',
  horror = 'horror',
}

/** What the controller asks the UI to show. */
export type RoundRequest =
  | {
      kind: 'activation'
      monster: MonsterInstance
      /** Show the master half. */
      master: boolean
      /** Both halves at once, because only one of them exists. */
      both: boolean
    }
  | { kind: 'activationMoM'; monster: MonsterInstance }
  | { kind: 'phaseTransition'; phase: MoMPhase }

/** A quest-defined `Activation` section, with the tests that gate it. */
export interface QuestActivation extends ActivationView {
  tests: VarTests | null
}

/** A monster type, as far as activation selection is concerned. */
export interface MonsterTypeView {
  sectionName: string
  activations: readonly string[]
  /** Set for a `CustomMonster`; names the content monster it derives from. */
  derivedType?: string
  /** `CustomMonster` with no `activation` field falls back to its base type. */
  useMonsterTypeActivations?: boolean
}

/**
 * The slice of the event engine the round controller uses. `EventManager`
 * satisfies it; a harness can substitute a scripted stub so the controller's
 * decisions are compared against the C# with the engine held fixed.
 */
export interface EventsView {
  current: unknown
  readonly queued: readonly string[]
  monsterImage: MonsterInstance | null
  triggerType(type: string, trigger?: boolean): boolean
  triggerEvent(): void
  queue(name: string, trigger?: boolean): boolean
  isDisabled(name: string): boolean
}

export interface RoundContext {
  runtime: QuestRuntime
  events: EventsView
  /** Content monsters by section name. */
  monsterTypes: ReadonlyMap<string, MonsterTypeView>
  /** Content `MonsterActivation` sections by section name. */
  contentActivations: ReadonlyMap<string, ActivationView>
  /** Quest `Activation` sections, keyed without the `Activation` prefix. */
  questActivations: ReadonlyMap<string, QuestActivation>
  present: (request: RoundRequest) => void
  /** `Random.Range(0, n)`. */
  random: (count: number) => number
  /** `audioControl.PlayTrait`. */
  playAudio?: (request: AudioRequest) => void
  /** `SaveManager.Save(0)`. */
  save?: () => void
  /** Renders `{val:ROUND}` and the phase names for the quest log. */
  translate?: (key: string, ...parameters: string[]) => string
  /**
   * Resolves an activation's text for a monster: translation, `{0}`
   * substitution and symbol replacement. Injected so the controller does not
   * need a localization or a party to make its decisions.
   */
  resolveActivation?: (activation: ActivationView, monster: MonsterInstance) => ActivationInstance
}

export class RoundController {
  protected activationsFinished = false

  constructor(protected readonly context: RoundContext) {}

  /** `Reset`. */
  reset(): void {
    this.activationsFinished = false
  }

  /** `HeroActivated`: the party has finished, so a monster goes next. */
  heroActivated(): void {
    const heroesDone = this.heroesActivated()
    const monstersDone = this.activateMonster()

    if (monstersDone && heroesDone) {
      this.activationsFinished = true
      this.endRound()
    }
  }

  /** `ParticalActivationComplete` — the C#'s spelling. */
  partialActivationComplete(monster: MonsterInstance): void {
    this.context.present({
      kind: 'activation',
      monster,
      master: monster.minionStarted,
      both: false,
    })
    monster.minionStarted = true
    monster.masterStarted = true
  }

  /** `MonsterActivated`: one half or one whole monster activation finished. */
  monsterActivated(): void {
    for (const monster of this.context.runtime.monsters) {
      if (monster.minionStarted !== monster.masterStarted) {
        this.partialActivationComplete(monster)
        return
      }
      if (monster.minionStarted && monster.masterStarted) monster.activated = true
    }

    if (!this.heroesActivated()) {
      this.adjustMorale(0)
      return
    }

    if (this.activateMonster()) {
      this.activationsFinished = true
      this.adjustMorale(0)
      this.endRound()
    }
  }

  /** `ActivateMonster()`: true once every monster has acted. */
  activateMonster(): boolean {
    const monsters = this.context.runtime.monsters
    const waiting = monsters.filter((m) => !m.activated)
    if (waiting.length === 0) return true

    const chosen = waiting[this.context.random(waiting.length)] ?? waiting[0]
    if (chosen === undefined) return true
    return this.activateOne(chosen)
  }

  /** `ActivateMonster(Quest.Monster)`. Always false — an activation started. */
  activateOne(monster: MonsterInstance): boolean {
    // The list is rebuilt on every activation, even when one was already
    // drawn, because that is when the C# emits its missing-activation
    // warnings — a monster with a broken activation list warns each round.
    const choices = this.activationsFor(monster)
    if (choices.length === 0) return this.noActivations(monster)

    if (monster.currentActivation === null) {
      const picked = choices[this.context.random(choices.length)] ?? choices[0]
      if (picked !== undefined) monster.currentActivation = this.newActivation(picked, monster)
    }

    const activation = monster.currentActivation
    if (activation === null) return true

    const hasMinion = activation.ad.minionActions.fullKey.length > 0
    const hasMaster = activation.ad.masterActions.fullKey.length > 0

    if (!hasMinion || !hasMaster) {
      monster.minionStarted = true
      monster.masterStarted = true
      this.context.present({ kind: 'activation', monster, master: !hasMinion, both: true })
      return false
    }

    monster.minionStarted = this.context.random(2) === 0
    if (activation.ad.masterFirst) monster.minionStarted = false
    if (activation.ad.minionFirst) monster.minionStarted = true
    monster.masterStarted = !monster.minionStarted

    this.context.present({
      kind: 'activation',
      monster,
      master: monster.masterStarted,
      both: false,
    })
    return false
  }

  /**
   * A monster whose type names no activation at all.
   *
   * DEVIATION: the C# logs this and calls `Application.Quit()`, closing the
   * app from inside the round loop because a community scenario named a
   * monster with no activation. The monster is skipped instead, and the
   * scenario author gets a quest-log entry as well as the diagnostic.
   */
  protected noActivations(monster: MonsterInstance): boolean {
    const message = `Error: Unable to find any activation data for monster type: ${monster.monsterName}`
    log(message)
    this.warn(message)
    monster.activated = true
    return this.activateMonster()
  }

  /**
   * `Quest.Monster.NewActivation`: resolves the drawn activation's text.
   *
   * Without a resolver the raw data is wrapped untranslated, which is what a
   * caller that only wants the controller's decisions — a test, the
   * differential harness — needs.
   */
  protected newActivation(
    activation: ActivationView,
    monster: MonsterInstance,
  ): ActivationInstance {
    const resolve = this.context.resolveActivation
    if (resolve !== undefined) return resolve(activation, monster)
    return new ActivationInstance(activation, UNRESOLVED)
  }

  /** `EndRound`. */
  endRound(): void {
    const { events, runtime } = this.context
    events.triggerType('EndRound', false)
    events.triggerType(`EndRound${roundToInt(runtime.vars.getValue('#round'))}`, false)

    if (
      runtime.vars.getValue('#eliminatedprev') > 0 &&
      runtime.vars.getValue('#eliminatedcomplete') <= 0
    ) {
      runtime.vars.setValue('#eliminatedcomplete', 1)
      events.triggerType('Eliminated', false)
    }

    if (runtime.vars.getValue('#eliminated') > 0) {
      runtime.vars.setValue('#eliminatedprev', 1)
    }

    events.triggerEvent()
  }

  /** `CheckNewRound`: true when the round actually advanced. */
  checkNewRound(): boolean {
    if (!this.roundMayEnd()) return false
    if (!this.activationsFinished) return false
    this.activationsFinished = false

    this.context.runtime.resetActivations()
    this.advanceRoundCounter()

    this.context.playAudio?.({ kind: 'trait', trait: 'newround' })
    this.context.events.triggerType('StartRound')
    this.context.save?.()
    return true
  }

  /** No round boundary while an event is open or waiting. */
  protected roundMayEnd(): boolean {
    return this.context.events.current === null && this.context.events.queued.length === 0
  }

  protected advanceRoundCounter(): number {
    const { runtime } = this.context
    const round = roundToInt(runtime.vars.getValue('#round')) + 1
    runtime.vars.setValue('#round', round)
    runtime.log.add(new LogEntry(this.translate('ROUND', String(round))))
    return round
  }

  protected heroesActivated(): boolean {
    return this.context.runtime.heroes.every(
      (hero: HeroInstance) => hero.activated || hero.heroName === null,
    )
  }

  /**
   * `Quest.AdjustMorale`. Descent only — Mansions has no morale track, so the
   * MoM controller never reaches a call with a non-zero delta.
   *
   * DEVIATION: the C# clamps a negative morale into a local variable *after*
   * writing the unclamped value to the var, so `$%morale` keeps going
   * negative while the display shows zero. The clamp is written through here.
   */
  protected adjustMorale(delta: number): void {
    const { runtime } = this.context
    const morale = runtime.vars.getValue('$%morale') + delta
    if (morale < 0) {
      runtime.vars.setValue('$%morale', 0)
      this.context.events.triggerType('NoMorale')
      return
    }
    runtime.vars.setValue('$%morale', morale)
  }

  /**
   * Which activations this monster may draw from.
   *
   * Quest-specific monsters name their own; everything else takes every
   * content activation whose name starts with the monster type, plus the
   * common ones the type lists.
   */
  protected activationsFor(monster: MonsterInstance): ActivationView[] {
    const { monsterTypes, contentActivations, questActivations, runtime } = this.context
    const type = monsterTypes.get(monster.monsterName)
    if (type === undefined) return []

    if (type.useMonsterTypeActivations === false) {
      const list: ActivationView[] = []
      for (const name of type.activations) {
        const quest = questActivations.get(name)
        if (quest !== undefined && runtime.vars.test(quest.tests)) {
          list.push(quest)
          continue
        }
        const content = contentActivations.get(`MonsterActivation${name}`)
        if (content !== undefined) {
          list.push(content)
          continue
        }
        // Reached when the quest component exists but its tests fail and
        // content has no fallback, as well as when nothing is defined at all.
        this.warn(
          `Warning: Unable to find activation: ${name} for monster type: ${monster.monsterName}`,
        )
      }
      return list
    }

    const base =
      type.derivedType !== undefined ? (monsterTypes.get(type.derivedType) ?? type) : type
    const list: ActivationView[] = []
    // `Monster` is stripped so `MonsterGoblin` matches `MonsterActivationGoblin`
    // and every variety of it.
    const prefix = `MonsterActivation${base.sectionName.slice('Monster'.length)}`
    for (const [name, activation] of contentActivations) {
      if (name.startsWith(prefix)) list.push(activation)
    }
    for (const name of base.activations) {
      const activation = contentActivations.get(`MonsterActivation${name}`)
      if (activation !== undefined) list.push(activation)
      // The C# sends this one to the console rather than the quest log, unlike
      // the quest-specific branch above. Kept as it is: the two warnings reach
      // different audiences on purpose.
      else log(`Warning: Unable to find activation: ${name} for monster type: ${base.sectionName}`)
    }
    return list
  }

  protected translate(key: string, ...parameters: string[]): string {
    return this.context.translate?.(key, ...parameters) ?? `${key} ${parameters.join(' ')}`.trim()
  }

  protected warn(message: string): void {
    this.context.runtime.log.add(new LogEntry(message, true))
  }
}

/**
 * `RoundControllerMoM`: Mansions runs investigator → mythos → monsters →
 * horror rather than Descent's interleaved hero and monster activations.
 */
export class RoundControllerMoM extends RoundController {
  private endRoundRequested = false
  phase: MoMPhase = MoMPhase.investigator

  override heroActivated(): void {
    const { runtime, events } = this.context
    for (const hero of runtime.heroes) hero.activated = true

    if (
      runtime.vars.getValue('#eliminatedprev') > 0 &&
      runtime.vars.getValue('#eliminatedcomplete') <= 0
    ) {
      runtime.vars.setValue('#eliminatedcomplete', 1)
      if (events.triggerType('Eliminated', false)) {
        events.triggerEvent()
        return
      }
    }

    this.phase = MoMPhase.mythos
    // Announced before the events run, where the C# announces it after.
    // `TriggerEvent` can turn the round straight over when the mythos has
    // nothing to add, and that raises the investigators' own announcement —
    // so announcing afterwards puts the two in the wrong order. The C# does
    // not notice because its windows stack and expire together; this port
    // shows them one at a time, so the order is the story's.
    this.context.present({ kind: 'phaseTransition', phase: MoMPhase.mythos })

    events.triggerType('BeforeMonsterActivation', false)
    events.triggerType('Mythos', false)
    events.triggerType('EndInvestigatorTurn', false)
    events.triggerEvent()
  }

  override monsterActivated(): void {
    for (const monster of this.context.runtime.monsters) {
      if (monster.minionStarted || monster.masterStarted) monster.activated = true
    }

    if (this.activateMonster()) this.checkNewRound()
  }

  override activateMonster(): boolean {
    const monsters = this.context.runtime.monsters
    const waiting: MonsterInstance[] = []

    for (const monster of monsters) {
      if (monster.activated) continue
      // A monster whose only activation is a disabled event can never act, so
      // it is marked done rather than blocking the phase forever.
      const event = this.eventActivation(monster)
      if (event !== null && this.context.events.isDisabled(event)) {
        monster.activated = true
        continue
      }
      waiting.push(monster)
    }

    if (waiting.length === 0) return true

    const chosen = waiting[this.context.random(waiting.length)] ?? waiting[0]
    if (chosen === undefined) return true

    const event = this.eventActivation(chosen)
    if (event !== null) {
      chosen.masterStarted = true
      chosen.activated = true
      this.context.events.monsterImage = chosen
      this.context.events.queue(event)
    } else {
      this.activateOne(chosen)
    }
    return false
  }

  override activateOne(monster: MonsterInstance): boolean {
    const choices = this.activationsFor(monster)
    if (choices.length === 0) return this.noActivations(monster)

    if (monster.currentActivation === null) {
      const picked = choices[this.context.random(choices.length)] ?? choices[0]
      if (picked !== undefined) monster.currentActivation = this.newActivation(picked, monster)
    }

    // Mansions shows one dialog covering the whole activation rather than
    // splitting minion and master.
    monster.masterStarted = true
    this.context.present({ kind: 'activationMoM', monster })
    return false
  }

  override endRound(): void {
    this.endRoundRequested = true
    super.endRound()
  }

  override checkNewRound(): boolean {
    if (!this.roundMayEnd()) return false
    if (this.phase === MoMPhase.investigator) return false

    if (this.phase === MoMPhase.mythos) {
      if (this.context.runtime.monsters.length > 0) {
        if (this.activateMonster()) {
          // Nothing could act — activation conditions may rule every monster
          // out — so skip straight to the horror phase.
          this.phase = MoMPhase.horror
          return false
        }
        // `activateMonster` recurses through the event engine, which can have
        // moved the phase on already — so it is re-read rather than narrowed.
        if (this.phaseNow() !== MoMPhase.horror) {
          this.phase = MoMPhase.monsters
          return this.context.events.current !== null
        }
      } else {
        this.phase = MoMPhase.horror
        this.endRound()
        return this.context.events.current !== null
      }
    }

    if (this.phase === MoMPhase.monsters) {
      this.phase = MoMPhase.horror
      return false
    }

    // The horror test is the player's to take: without this a random event
    // would flip the game back to the investigator phase underneath them.
    if (
      !this.endRoundRequested &&
      this.phase === MoMPhase.horror &&
      this.context.runtime.monsters.length > 0
    ) {
      return false
    }

    this.endRoundRequested = false
    this.context.runtime.resetActivations()

    const { runtime, events } = this.context
    this.advanceRoundCounter()
    runtime.log.add(new LogEntry(this.translate('PHASE_INVESTIGATOR')))

    this.phase = MoMPhase.investigator
    this.context.playAudio?.({ kind: 'trait', trait: 'newround' })

    if (
      runtime.vars.getValue('#eliminatedprev') > 0 &&
      runtime.vars.getValue('#eliminatedcomplete') <= 0
    ) {
      events.triggerType('StartFinalRound')
    }
    events.triggerType('StartRound')
    this.context.save?.()

    this.context.present({ kind: 'phaseTransition', phase: MoMPhase.investigator })
    return true
  }

  /**
   * The phase as it stands now, read through a call so the compiler cannot
   * narrow it: `activateMonster` runs events that change it underneath us.
   */
  private phaseNow(): MoMPhase {
    return this.phase
  }

  /** The single `Event…` activation a quest monster may carry, if it has one. */
  private eventActivation(monster: MonsterInstance): string | null {
    const type = this.context.monsterTypes.get(monster.monsterName)
    if (type === undefined) return null
    if (type.activations.length !== 1) return null
    const only = type.activations[0]
    if (only === undefined || !only.startsWith('Event')) return null
    return only
  }

  /**
   * `MonsterDialogMoM.Defeated`: the investigators killed it.
   *
   * The order matters and is the C#'s. The event is cleared *before* the
   * triggers fire — a hack the C# comments as "fix #1112", because a monster
   * defeated from inside an event would otherwise leave that event open and
   * the new one unable to start. Preserved, because a scenario that relies on
   * a `Defeated` event running immediately depends on it.
   */
  defeated(monster: MonsterInstance): void {
    const { runtime, events } = this.context
    runtime.removeMonster(monster)
    this.context.playAudio?.({ kind: 'trait', trait: 'defeated' })

    events.current = null
    events.triggerType(`Defeated${monster.monsterName}`)
    events.triggerType(`Defeated${monster.spawnedBy}`)

    // Without this the monster phase stalls: the monster that was mid-
    // activation is gone, so nothing else will call back in.
    if (this.phase === MoMPhase.monsters && events.current === null) {
      this.monsterActivated()
    }
  }

  /** `inMonsterPhase`, for the event engine's callback. */
  inMonsterPhase(): boolean {
    return this.phase === MoMPhase.monsters
  }
}

/** Wraps an activation with no translation, for callers that only decide. */
const UNRESOLVED: ActivationTextContext = {
  monsterName: '',
  gameType: 'MoM',
  vars: { getValue: () => 0 } as never,
}

/**
 * `Mathf.RoundToInt`, which is banker's rounding — `2.5` rounds to `2`, not
 * `3`. Reachable because a scenario can add a fraction to `#round`.
 */
export function roundToInt(value: number): number {
  const floor = Math.floor(value)
  const fraction = value - floor
  if (fraction !== 0.5) return Math.round(value)
  return floor % 2 === 0 ? floor : floor + 1
}
