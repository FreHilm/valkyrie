/**
 * Tests for investigator attack selection (T-018).
 *
 * `GetAttackTypes` and `GetRandomAttack` are all `InvestigatorAttack.cs` does:
 * which buttons the dialog offers, and which line of text pressing one
 * produces. The `attacks` differential compiles both methods sliced out of the
 * real sources; these pin the same cases.
 */

import { afterEach, describe, expect, it } from 'vitest'

import { StringKey } from '../src/i18n/StringKey.js'
import { setLogSink } from '../src/ini/logger.js'
import { attackTypes, randomAttack } from '../src/quest/monsterAttacks.js'
import type { AttackView } from '../src/quest/monsterAttacks.js'

const attack = (
  target: string,
  attackType: string,
  text = `${target}/${attackType}`,
): AttackView => ({
  target,
  attackType,
  text: new StringKey(null, text, false),
})

const first = (): number => 0

const HUMAN_HEAVY = attack('human', 'heavy')
const HUMAN_UNARMED = attack('human', 'unarmed')
const SPIRIT_HEAVY = attack('spirit', 'heavy')

afterEach(() => setLogSink(null))

describe('attackTypes', () => {
  it('offers the types the monster’s traits reach', () => {
    expect(attackTypes({ traits: ['human'] }, [HUMAN_HEAVY, HUMAN_UNARMED, SPIRIT_HEAVY])).toEqual([
      'heavy',
      'unarmed',
    ])
  })

  it('offers nothing to a monster with no traits', () => {
    expect(attackTypes({ traits: [] }, [HUMAN_HEAVY])).toEqual([])
  })

  it('collapses duplicates', () => {
    expect(
      attackTypes({ traits: ['human'] }, [HUMAN_HEAVY, attack('human', 'heavy', 'b')]),
    ).toEqual(['heavy'])
  })

  it('keeps the content order, which the button order follows', () => {
    expect(attackTypes({ traits: ['human'] }, [HUMAN_UNARMED, HUMAN_HEAVY])).toEqual([
      'unarmed',
      'heavy',
    ])
  })

  it('gathers across several traits', () => {
    expect(
      attackTypes({ traits: ['human', 'spirit'] }, [HUMAN_HEAVY, attack('spirit', 'fire')]),
    ).toEqual(['heavy', 'fire'])
  })
})

describe('randomAttack', () => {
  it('draws from the attacks of that type the monster’s traits allow', () => {
    const text = randomAttack({ traits: ['human'] }, 'heavy', [SPIRIT_HEAVY, HUMAN_HEAVY], first)

    expect(text?.fullKey).toBe('human/heavy')
  })

  it('draws at random among several', () => {
    const attacks = [HUMAN_HEAVY, attack('human', 'heavy', 'second')]
    expect(randomAttack({ traits: ['human'] }, 'heavy', attacks, () => 1)?.fullKey).toBe('second')
  })

  it('returns null rather than crashing when nothing matches', () => {
    // The C# indexes an empty list and dies with ArgumentOutOfRangeException,
    // taking the application with it.
    expect(randomAttack({ traits: ['human'] }, 'bite', [HUMAN_HEAVY], first)).toBeNull()
  })

  it('warns and takes every attack of the type when the monster has no traits', () => {
    const messages: string[] = []
    setLogSink((message) => messages.push(message))

    const text = randomAttack({ traits: [] }, 'heavy', [SPIRIT_HEAVY, HUMAN_HEAVY], first)

    expect(text?.fullKey).toBe('spirit/heavy')
    expect(messages).toContain('Monster with no traits, this should not happen')
  })

  describe('a quest monster’s own attack text', () => {
    const own = (texts: string[]) =>
      new Map([['heavy', texts.map((t) => new StringKey(null, t, false))]])

    it('replaces the content attacks for that type', () => {
      const text = randomAttack(
        { traits: ['human'], investigatorAttacks: own(['The Zombie recoils.']) },
        'heavy',
        [HUMAN_HEAVY],
        first,
      )

      expect(text?.fullKey).toBe('The Zombie recoils.')
    })

    it('draws among its own text', () => {
      const text = randomAttack(
        { traits: ['human'], investigatorAttacks: own(['first', 'second']) },
        'heavy',
        [HUMAN_HEAVY],
        () => 1,
      )

      expect(text?.fullKey).toBe('second')
    })

    it('falls through to content for types it does not define', () => {
      const text = randomAttack(
        { traits: ['human'], investigatorAttacks: own(['own']) },
        'unarmed',
        [HUMAN_UNARMED],
        first,
      )

      expect(text?.fullKey).toBe('human/unarmed')
    })

    it('stops rather than falling through when it defines a type with no text', () => {
      // `attacks=heavy:0` in a scenario. The scenario said this type has no
      // text, so content text would be the wrong answer — and the C# crashes.
      const text = randomAttack(
        { traits: ['human'], investigatorAttacks: new Map([['heavy', []]]) },
        'heavy',
        [HUMAN_HEAVY],
        first,
      )

      expect(text).toBeNull()
    })
  })
})
