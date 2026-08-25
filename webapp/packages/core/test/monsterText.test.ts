/**
 * Tests for evade and horror text selection (T-018).
 *
 * `InvestigatorEvade.cs` and `HorrorCheck.cs` are dialogs, but the part that
 * matters is the selection: which entry a monster gets, what the fallback to a
 * derived type does, and when nothing is shown at all. The `monstertext`
 * differential compiles both C# files unmodified against UI shims; these pin
 * the same cases.
 */

import { describe, expect, it } from 'vitest'

import { StringKey } from '../src/i18n/StringKey.js'
import { customMonsterEvent, pickMonsterText } from '../src/quest/monsterText.js'
import type { MonsterTextData } from '../src/quest/monsterText.js'
import type { MonsterInstance } from '../src/quest/QuestRuntime.js'
import type { MonsterTypeView } from '../src/quest/RoundController.js'

const entry = (monster: string, text = monster): MonsterTextData => ({
  monster,
  text: new StringKey(null, text, false),
})

const monster = (type: string): MonsterInstance => ({
  monsterName: type,
  spawnedBy: '',
  unique: false,
  health: 0,
  damage: 0,
  activated: false,
  minionStarted: false,
  masterStarted: false,
  currentActivation: null,
})

const contentType = (name: string): MonsterTypeView => ({ sectionName: name, activations: [] })
const questType = (name: string, derivedType: string): MonsterTypeView => ({
  sectionName: name,
  activations: [],
  derivedType,
})

/** Always draws the first match, so the assertions are about selection. */
const first = (): number => 0

describe('pickMonsterText', () => {
  it('matches on the monster section name, prefix included', () => {
    const chosen = pickMonsterText(
      monster('MonsterZombie'),
      contentType('MonsterZombie'),
      [entry('Cultist'), entry('Zombie')],
      first,
    )

    expect(chosen?.monster).toBe('Zombie')
  })

  it('requires the whole name, not a prefix of it', () => {
    const chosen = pickMonsterText(
      monster('MonsterZombie'),
      contentType('MonsterZombie'),
      [entry('Zomb'), entry('ZombieLord')],
      first,
    )

    expect(chosen).toBeNull()
  })

  it('returns null rather than inventing text', () => {
    // The C# draws no dialog at all, so a player pressing Evade sees nothing.
    // Preserved: silently substituting other text would be worse.
    expect(pickMonsterText(monster('MonsterZombie'), contentType('MonsterZombie'), [], first)).toBe(
      null,
    )
  })

  it('draws at random among several matches', () => {
    const entries = [entry('Zombie', 'first'), entry('Zombie', 'second')]
    const chosen = pickMonsterText(
      monster('MonsterZombie'),
      contentType('MonsterZombie'),
      entries,
      () => 1,
    )

    expect(chosen?.text.fullKey).toBe('second')
  })

  describe('derived type fallback', () => {
    it('falls back to the type a custom monster is based on', () => {
      const chosen = pickMonsterText(
        monster('MonsterCustomThing'),
        questType('MonsterCustomThing', 'MonsterZombie'),
        [entry('Zombie')],
        first,
      )

      expect(chosen?.monster).toBe('Zombie')
    })

    it('prefers the monster’s own entries over the derived ones', () => {
      const chosen = pickMonsterText(
        monster('MonsterCustomThing'),
        questType('MonsterCustomThing', 'MonsterZombie'),
        [entry('CustomThing', 'own'), entry('Zombie', 'derived')],
        first,
      )

      expect(chosen?.text.fullKey).toBe('own')
    })

    it('treats a blank base as no base', () => {
      // `IsNullOrWhiteSpace` in the C#. Unobservable in practice — a blank name
      // can never equal "Monster" + anything — but kept for faithfulness.
      expect(
        pickMonsterText(
          monster('MonsterCustomThing'),
          questType('MonsterCustomThing', '   '),
          [entry('Zombie')],
          first,
        ),
      ).toBeNull()
    })

    it('does not apply to a content monster', () => {
      expect(
        pickMonsterText(
          monster('MonsterCustomThing'),
          contentType('MonsterCustomThing'),
          [entry('Zombie')],
          first,
        ),
      ).toBeNull()
    })
  })
})

describe('customMonsterEvent', () => {
  it('takes the event when the scenario defines it', () => {
    expect(customMonsterEvent('EventCustom', new Set(['EventCustom']))).toBe('EventCustom')
  })

  it('falls through when the named event is missing', () => {
    // A CustomMonster naming an event the scenario never defines should show
    // the content text rather than nothing at all.
    expect(customMonsterEvent('EventMissing', new Set(['EventOther']))).toBeNull()
  })

  it('falls through when no event is named', () => {
    expect(customMonsterEvent('', new Set(['EventOther']))).toBeNull()
  })
})
