/**
 * Tests for resolving a CustomMonster against its base (QuestMonster.cs).
 *
 * Every assertion here is a field that falls back on a different test, and
 * each one fails quietly in a different way: lose the traits and the attack
 * buttons vanish, lose the health and the monster dies at the wrong point.
 */

import { describe, expect, it } from 'vitest'

import { StringKey } from '../src/i18n/StringKey.js'
import { contentMonster, resolveQuestMonster } from '../src/quest/questMonster.js'
import type { BaseMonsterView, CustomMonsterSection } from '../src/quest/questMonster.js'

const raw = (value: string): StringKey => new StringKey(null, value, false)
/** The quest defined no value, so the section's key was never written. */
const missing = new StringKey('qst', 'Absent', true)

const base: BaseMonsterView = {
  name: raw('Zombie'),
  info: raw('Slow and relentless.'),
  traits: ['undead', 'human'],
  image: 'content/zombie.png',
  activations: ['MonsterActivationShamble'],
  healthBase: 4,
  healthPerHero: 1,
  horror: 2,
  awareness: 3,
}

function custom(over: Partial<CustomMonsterSection> = {}): CustomMonsterSection {
  return {
    sectionName: 'CustomMonsterEdith',
    baseMonster: 'MonsterZombie',
    monsterName: missing,
    info: missing,
    traits: [],
    imagePath: '',
    imagePlace: '',
    activations: [],
    healthBase: 0,
    healthPerHero: 0,
    healthDefined: false,
    horror: 0,
    horrorDefined: false,
    awareness: 0,
    awarenessDefined: false,
    ...over,
  }
}

/** Stands in for the localization: only keys the quest wrote exist. */
const exists = (key: StringKey): boolean => key !== missing

describe('resolveQuestMonster', () => {
  it('takes the base name, traits and health when the quest defines none', () => {
    const resolved = resolveQuestMonster(custom(), base, '/quests/one', exists)

    expect(resolved.name).toBe(base.name)
    expect(resolved.traits).toEqual(['undead', 'human'])
    expect(resolved.healthBase).toBe(4)
    expect(resolved.healthPerHero).toBe(1)
    expect(resolved.derivedType).toBe('MonsterZombie')
  })

  it('keeps what the quest does define', () => {
    const resolved = resolveQuestMonster(
      custom({ traits: ['spirit'], healthDefined: true, healthBase: 9, healthPerHero: 2 }),
      base,
      '/quests/one',
      exists,
    )

    expect(resolved.traits).toEqual(['spirit'])
    expect(resolved.healthBase).toBe(9)
    expect(resolved.healthPerHero).toBe(2)
  })

  it('treats health as one field, not two', () => {
    // `healthDefined` is set by either key, so a monster giving only `health`
    // keeps its own zero per-hero rather than inheriting the base's.
    const resolved = resolveQuestMonster(
      custom({ healthDefined: true, healthBase: 9 }),
      base,
      '',
      exists,
    )

    expect(resolved.healthPerHero).toBe(0)
  })

  it('resolves a quest image against the quest directory', () => {
    const resolved = resolveQuestMonster(
      custom({ imagePath: 'art/edith.png' }),
      base,
      '/quests/one',
      exists,
    )

    expect(resolved.image).toBe('/quests/one/art/edith.png')
  })

  it("falls back to the base's portrait for the board marker", () => {
    // QuestMonster.cs:71 reads `baseObject.image` — the base's *portrait* —
    // and not the quest's own, which is why a monster that supplies only a
    // portrait still shows the base art on the board.
    const resolved = resolveQuestMonster(
      custom({ imagePath: 'art/edith.png' }),
      base,
      '/quests/one',
      exists,
    )

    expect(resolved.image).toBe('/quests/one/art/edith.png')
    expect(resolved.imagePlace).toBe('content/zombie.png')
  })

  it('falls back to its own portrait when there is no base at all', () => {
    const resolved = resolveQuestMonster(
      custom({ imagePath: 'art/edith.png' }),
      undefined,
      '/quests/one',
      exists,
    )

    expect(resolved.imagePlace).toBe('/quests/one/art/edith.png')
  })

  it('skips every fallback when base names nothing the game has', () => {
    const resolved = resolveQuestMonster(
      custom({ traits: [], healthDefined: false }),
      undefined,
      '',
      exists,
    )

    expect(resolved.derivedType).toBe('')
    expect(resolved.traits).toEqual([])
    expect(resolved.healthBase).toBe(0)
    expect(resolved.useMonsterTypeActivations).toBe(false)
  })

  it('borrows the base activations only when the quest declares none', () => {
    expect(resolveQuestMonster(custom(), base, '', exists).useMonsterTypeActivations).toBe(true)
    expect(
      resolveQuestMonster(custom({ activations: ['MonsterActivationLunge'] }), base, '', exists)
        .useMonsterTypeActivations,
    ).toBe(false)
  })
})

describe('contentMonster', () => {
  it('uses the portrait as the marker when no placement image is set', () => {
    const resolved = contentMonster('MonsterZombie', { ...base, imagePlace: '' })

    expect(resolved.imagePlace).toBe('content/zombie.png')
    expect(resolved.derivedType).toBe('')
  })
})
