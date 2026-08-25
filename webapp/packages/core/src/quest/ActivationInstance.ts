/**
 * Port of `Quest.ActivationInstance` (`unity/Assets/Scripts/Quest/Quest.cs:2679`).
 *
 * The activation a monster drew, with its text already resolved: translated,
 * `{0}` filled in, symbols replaced and newlines unescaped. The dialogs read
 * these strings directly, so this is where a scenario's activation text
 * actually becomes what the player sees.
 */

import type { Localization } from '../i18n/Localization.js'
import type { VarManager } from './VarManager.js'
import { outputSymbolReplace } from './symbols.js'

/** The subset of `StringKey` an activation needs. */
export interface TranslatableKey {
  fullKey: string
  translate(options?: { localization?: Localization }): string
}

/**
 * The shared shape of a content `MonsterActivation` and a quest `Activation`.
 *
 * The C# has `QuestActivation` subclass `ActivationData` to unify the two;
 * structural typing makes both usable directly.
 */
export interface ActivationView {
  sectionName: string
  ability: TranslatableKey
  minionActions: TranslatableKey
  masterActions: TranslatableKey
  moveButton: TranslatableKey
  move: TranslatableKey
  minionFirst: boolean
  masterFirst: boolean
}

export interface ActivationTextContext {
  /** The monster's translated name, which fills `{0}`. */
  monsterName: string
  gameType: 'MoM' | 'D2E'
  vars: VarManager
  localization?: Localization
  /**
   * `Quest.GetRandomHero().heroData.name.Translate()`, used only by Descent.
   *
   * DEVIATION: the C# draws this at activation time and never stores it, so a
   * save or an undo re-draws a different hero — the `FIXME` at `Quest.cs:2700`.
   * The port resolves it once here and the resolved text is what gets saved,
   * so the ability a player read is the ability they see again.
   */
  randomHeroName?: () => string
}

export class ActivationInstance {
  readonly ad: ActivationView
  readonly effect: string
  readonly move: string
  readonly minionActions: string
  readonly masterActions: string

  constructor(activation: ActivationView, context: ActivationTextContext) {
    this.ad = activation
    const { monsterName, localization } = context
    const options = localization === undefined ? {} : { localization }
    const symbols = { vars: context.vars, gameType: context.gameType }

    this.minionActions = outputSymbolReplace(
      activation.minionActions.translate(options).split('{0}').join(monsterName),
      symbols,
    )
    this.masterActions = outputSymbolReplace(
      activation.masterActions.translate(options).split('{0}').join(monsterName),
      symbols,
    )

    let effect: string
    if (context.gameType === 'MoM') {
      effect = activation.ability.translate(options).split('{0}').join(monsterName)
      this.move = unescapeNewlines(
        outputSymbolReplace(
          activation.move.translate(options).split('{0}').join(monsterName),
          symbols,
        ),
      )
    } else {
      // Descent names a hero in the ability text and the monster in `{1}`.
      const hero = context.randomHeroName?.() ?? ''
      effect = activation.ability.translate(options).split('{0}').join(hero)
      effect = effect.split('{1}').join(monsterName)
      this.move = ''
    }

    this.effect = unescapeNewlines(outputSymbolReplace(effect, symbols))
  }

  /** The half of the activation this dialog is showing. */
  actions(master: boolean): string {
    return master ? this.masterActions : this.minionActions
  }
}

function unescapeNewlines(text: string): string {
  return text.split('\\n').join('\n')
}
