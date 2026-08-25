/**
 * Choosing the evade and horror text for a monster, ported from the selection
 * halves of `InvestigatorEvade.cs` and `HorrorCheck.cs`.
 *
 * Both files are dialogs, but the part worth porting is not the dialog: it is
 * which entry gets picked and what happens when nothing matches. A scenario
 * whose custom monster derives from a content type relies on the fallback,
 * and a silently-empty result means a player pressing Evade sees nothing at
 * all — which is what the C# does today, and is preserved here.
 */

import type { TranslatableKey } from './ActivationInstance.js'
import type { MonsterInstance } from './QuestRuntime.js'
import type { MonsterTypeView } from './RoundController.js'

/** The shared shape of `EvadeData` and `HorrorData`. */
export interface MonsterTextData {
  /** The monster type this text belongs to, *without* the `Monster` prefix. */
  monster: string
  text: TranslatableKey
}

/** `MonsterData.type`, the prefix every monster section name carries. */
const MONSTER_PREFIX = 'Monster'

/**
 * `PickEvade` / `PickHorror`.
 *
 * Entries are matched on the monster's own section name first. A quest monster
 * that matched nothing falls back to its `derivedType` — which is how a custom
 * monster inherits the evade and horror text of the content monster it is
 * based on.
 *
 * Returns null when nothing matches, which the C# expresses by drawing no
 * dialog at all.
 */
export function pickMonsterText(
  monster: MonsterInstance,
  type: MonsterTypeView | undefined,
  entries: Iterable<MonsterTextData>,
  random: (count: number) => number,
): MonsterTextData | null {
  const all = [...entries]
  const matches = all.filter((entry) => monster.monsterName === MONSTER_PREFIX + entry.monster)

  if (matches.length === 0) {
    const derived = type?.derivedType
    // `IsNullOrWhiteSpace`: a `base` field of spaces is no base at all.
    if (derived !== undefined && derived.trim().length > 0) {
      matches.push(...all.filter((entry) => derived === MONSTER_PREFIX + entry.monster))
    }
  }

  if (matches.length === 0) return null
  return matches[random(matches.length)] ?? matches[0] ?? null
}

/** The custom event a quest monster names instead of the content text. */
export interface MonsterEventText {
  evadeEvent: string
  horrorEvent: string
}

/**
 * `InvestigatorEvade` and `HorrorCheck` both open with the same test: a quest
 * monster that names an event the scenario actually defines runs that event
 * instead of any content text.
 *
 * The event has to exist. A `CustomMonster` naming a missing one falls through
 * to the content text rather than doing nothing. A monster naming no event at
 * all takes the same path, because no component is called "".
 */
export function customMonsterEvent(
  name: string,
  questComponents: ReadonlySet<string>,
): string | null {
  return questComponents.has(name) ? name : null
}
