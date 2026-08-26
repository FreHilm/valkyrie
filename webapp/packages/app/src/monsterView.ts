/**
 * Assembling the monster dialog from content, the runtime and the scenario.
 *
 * `MonsterDialogMoM` reads everything it shows off one resolved `MonsterData`
 * and asks `InvestigatorAttack`, `InvestigatorEvade` and `HorrorCheck` for the
 * text — four files reaching into a live `Game`. Here the joins are explicit
 * and the result is a plain view the dialog renders, so what a player is about
 * to be shown can be checked without a screen.
 */

import {
  attackTypes,
  AttackData,
  customMonsterEvent,
  EvadeData,
  HorrorData,
  MoMPhase,
  outputSymbolReplace,
  pickMonsterText,
  randomAttack,
} from '@valkyrie/core'
import type {
  ContentData,
  MonsterInstance,
  MonsterTextData,
  QuestComponent,
  VarManager,
} from '@valkyrie/core'
import type { MonsterDialogView } from '@valkyrie/ui'
import { monsterProfile } from './questArt.js'

/** The slice of a running session the dialog reads and writes. */
export interface MonsterSession {
  runtime: {
    monsters: readonly MonsterInstance[]
    vars: VarManager
    monsterHealth: (monster: MonsterInstance, type: MonsterHealthLike) => number
    setDamage: (monster: MonsterInstance, damage: number, health: number) => void
  }
  rounds: { phase: MoMPhase }
  activate: (name: string) => void
  defeat: (monster: MonsterInstance) => void
}

interface MonsterHealthLike {
  healthBase: number
  healthPerHero: number
}

export interface MonsterViewOptions {
  session: MonsterSession
  content: ContentData
  components: ReadonlyMap<string, QuestComponent>
  /** The scenario's directory, which its own art is named relative to. */
  questPath: string
  gameType: 'MoM' | 'D2E'
  resolveTexture: (name: string) => string | null
  /** Turns a resolved art file into something an `<img>` can show. */
  imageUrl: (path: string) => string | null
  /** Closes the dialog. */
  close: () => void
  /** Redraws whatever is showing it. */
  refresh: () => void
  /** Injected so a test can pin the draw. */
  random?: (count: number) => number
}

/** `getAll` yields [name, value] pairs; the selection helpers want the values. */
function valuesOf<T>(pairs: readonly [string, T][]): T[] {
  return pairs.map(([, value]) => value)
}

/**
 * The dialog for the monster at `index`, or null when there is nothing to show.
 *
 * A monster whose type the content does not have returns null rather than
 * opening an empty dialog — which is what the C# effectively does by never
 * creating the icon that would open it.
 */
export function monsterDialogView(
  options: MonsterViewOptions,
  index: number,
): MonsterDialogView | null {
  const { session, content, components, questPath, resolveTexture, imageUrl } = options
  const random = options.random ?? ((count: number) => Math.floor(Math.random() * count))

  const instance = session.runtime.monsters[index]
  if (instance === undefined) return null
  const profile = monsterProfile(content, components, instance.monsterName, questPath)
  if (profile === null) return null

  const { resolved, custom } = profile
  const health = session.runtime.monsterHealth(instance, resolved)
  const art = resolveTexture(resolved.image)
  const url = art === null ? null : imageUrl(art)
  const named = (text: string): string => text.split('{0}').join(resolved.name.translate())
  const type = {
    traits: resolved.traits,
    ...(custom === null ? {} : { investigatorAttacks: custom.investigatorAttacks }),
  }

  // `PickEvade` and `PickHorror` both open by asking whether the scenario
  // named an event of its own, which replaces the content text entirely.
  const questEvent = (name: string): boolean => {
    if (customMonsterEvent(name, new Set(components.keys())) === null) return false
    options.close()
    session.activate(name)
    options.refresh()
    return true
  }

  const contentText = (entries: readonly MonsterTextData[]): string | null => {
    const picked = pickMonsterText(instance, resolved, entries, random)
    return picked === null ? null : named(picked.text.translate())
  }

  return {
    monsterName: resolved.name.translate(),
    ...(url === null ? {} : { image: url }),
    horrorPhase: session.rounds.phase === MoMPhase.horror,
    health: {
      health,
      damage: instance.damage,
      onDamageChange: (damage: number) => {
        session.runtime.setDamage(instance, damage, health)
        options.refresh()
      },
      onDefeated: () => {
        options.close()
        session.defeat(instance)
        options.refresh()
      },
    },
    attackTypes: attackTypes(type, valuesOf(content.getAll(AttackData))),
    onAttack: (chosen: string) => {
      const text = randomAttack(type, chosen, valuesOf(content.getAll(AttackData)), random)
      if (text === null) return null
      // `InvestigatorAttack.cs:68` translates, substitutes the name, then
      // replaces symbols — and it is the only one of the three that does.
      // Evade and horror text is drawn without it, so the dice and stat glyphs
      // an attack line carries stay raw there.
      return outputSymbolReplace(named(text.translate()), {
        vars: session.runtime.vars,
        gameType: options.gameType,
      })
    },
    onEvade: () => {
      if (custom !== null && questEvent(custom.evadeEvent)) return null
      return contentText(valuesOf(content.getAll(EvadeData)))
    },
    onHorror: () => {
      if (custom !== null && questEvent(custom.horrorEvent)) return null
      return contentText(valuesOf(content.getAll(HorrorData)))
    },
    onCancel: options.close,
  }
}
