/**
 * Choosing an investigator's attack, ported from `GetAttackTypes` and
 * `GetRandomAttack` in `unity/Assets/Scripts/Content/ContentTypes.cs` and the
 * `QuestMonster` override in `unity/Assets/Scripts/Quest/QuestMonster.cs`.
 *
 * `InvestigatorAttack.cs` is the dialog around these two calls: the buttons it
 * shows are the attack types, and pressing one draws a line of attack text.
 * The selection is the part worth porting — a quest monster overriding its own
 * attack text, and the traits that decide which attacks apply at all.
 */

import type { TranslatableKey } from './ActivationInstance.js'
import { log } from '../ini/logger.js'

/** The shape of a content `Attack` section. */
export interface AttackView {
  /** Which monster trait this attack applies to: human, spirit, … */
  target: string
  /** Which investigator attack this is: heavy, unarmed, … */
  attackType: string
  text: TranslatableKey
}

/** A monster type, as far as attack selection is concerned. */
export interface AttackableMonster {
  traits: readonly string[]
  /**
   * `CustomMonster.investigatorAttacks`: text a quest supplies for a type,
   * overriding the content attacks entirely.
   */
  investigatorAttacks?: ReadonlyMap<string, readonly TranslatableKey[]>
}

/**
 * `GetAttackTypes`: the attack types the dialog offers as buttons.
 *
 * Every content attack whose `target` is one of the monster's traits
 * contributes its `attackType`. The C# collects these in a `HashSet`, so
 * duplicates collapse; a `Set` here keeps insertion order, which is what the
 * C# yields in practice and what the button order depends on.
 *
 * A monster with no traits gets no buttons at all.
 */
export function attackTypes(monster: AttackableMonster, attacks: Iterable<AttackView>): string[] {
  const types = new Set<string>()
  for (const attack of attacks) {
    if (monster.traits.includes(attack.target)) types.add(attack.attackType)
  }
  return [...types]
}

/**
 * `GetRandomAttack`: one line of attack text for the chosen type.
 *
 * A quest monster that defines its own text for the type uses that and never
 * looks at content. Otherwise the content attacks of that type are filtered to
 * the monster's traits and one is drawn.
 *
 * DEVIATION: the C# indexes the result list without checking it is non-empty,
 * so `validAttacks[Random.Range(0, 0)]` throws `IndexOutOfRangeException` and
 * the app dies. A scenario reaches this by writing `attacks=Fire:0`, which
 * registers the type with no text behind it. The port returns null and the
 * caller shows nothing.
 */
export function randomAttack(
  monster: AttackableMonster,
  type: string,
  attacks: Iterable<AttackView>,
  random: (count: number) => number,
): TranslatableKey | null {
  const own = monster.investigatorAttacks?.get(type)
  if (own !== undefined) {
    if (own.length === 0) return null
    return own[random(own.length)] ?? own[0] ?? null
  }

  const valid: AttackView[] = []
  for (const attack of attacks) {
    if (attack.attackType !== type) continue
    if (monster.traits.length === 0) {
      // Unreachable from the dialog — a monster with no traits gets no attack
      // buttons — but preserved, and it is where the C# warning comes from.
      log('Monster with no traits, this should not happen')
      valid.push(attack)
    } else if (monster.traits.includes(attack.target)) {
      valid.push(attack)
    }
  }

  if (valid.length === 0) return null
  return valid[random(valid.length)]?.text ?? valid[0]?.text ?? null
}
