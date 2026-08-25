/**
 * Tests for monster selection (T-018).
 *
 * Which monster a spawn places decides what a scenario actually throws at the
 * players. The `spawn` differential compiles `AttemptMonsterMatch` and
 * `RuntimeMonsterSelection` sliced out of the real `Quest.cs`; these pin the
 * rules that are easiest to get subtly wrong.
 */

import { afterEach, describe, expect, it } from 'vitest'

import { setLogSink } from '../src/ini/logger.js'
import { QuestLog } from '../src/quest/QuestLog.js'
import { attemptMonsterMatch, runtimeMonsterSelection } from '../src/quest/monsterSelection.js'
import type { SelectionContext, SpawnView } from '../src/quest/monsterSelection.js'

const spawn = (over: Partial<SpawnView> = {}): SpawnView => ({
  sectionName: 'SpawnA',
  mTypes: [],
  mTraitsRequired: [],
  mTraitsPool: [],
  ...over,
})

function context(over: Partial<SelectionContext> = {}): SelectionContext {
  const questMonsters = over.questMonsters ?? new Map()
  return {
    contentMonsters: new Map([
      ['MonsterZombie', { traits: ['undead'] }],
      ['MonsterCultist', { traits: ['human'] }],
    ]),
    questMonsters,
    questComponents: new Set([...questMonsters.keys()]),
    selected: new Map(),
    onBoard: [],
    gameType: 'MoM',
    random: () => 0,
    log: new QuestLog(),
    ...over,
  }
}

afterEach(() => setLogSink(null))

describe('named types', () => {
  it('takes a content monster by name', () => {
    const ctx = context()
    expect(attemptMonsterMatch(spawn({ mTypes: ['MonsterZombie'] }), ctx)).toBe(true)
    expect(ctx.selected.get('SpawnA')).toBe('MonsterZombie')
  })

  it('treats the Monster prefix as optional', () => {
    const ctx = context()
    attemptMonsterMatch(spawn({ mTypes: ['Zombie'] }), ctx)

    expect(ctx.selected.get('SpawnA')).toBe('MonsterZombie')
  })

  it('leaves a CustomMonster name alone', () => {
    const questMonsters = new Map([['CustomMonsterEdith', { traits: ['human'], baseMonster: '' }]])
    const ctx = context({ questMonsters })
    attemptMonsterMatch(spawn({ mTypes: ['CustomMonsterEdith'] }), ctx)

    expect(ctx.selected.get('SpawnA')).toBe('CustomMonsterEdith')
  })

  it('tries each type in order', () => {
    const ctx = context()
    attemptMonsterMatch(spawn({ mTypes: ['MonsterNope', 'MonsterCultist'] }), ctx)

    expect(ctx.selected.get('SpawnA')).toBe('MonsterCultist')
  })

  it('reuses another spawn’s choice, so both place the same kind', () => {
    const ctx = context({ selected: new Map([['SpawnB', 'MonsterZombie']]) })
    attemptMonsterMatch(spawn({ mTypes: ['SpawnB'] }), ctx)

    expect(ctx.selected.get('SpawnA')).toBe('MonsterZombie')
  })

  it('gives up at an unresolved spawn reference rather than reading past it', () => {
    // Without the abort the loop falls through and quietly places the wrong
    // kind of monster.
    const ctx = context()
    const result = attemptMonsterMatch(spawn({ mTypes: ['SpawnB', 'MonsterZombie'] }), ctx)

    expect(result).toBe(false)
    expect(ctx.selected.has('SpawnA')).toBe(false)
  })

  it('keeps a choice once made', () => {
    const ctx = context({ selected: new Map([['SpawnA', 'MonsterCultist']]) })
    attemptMonsterMatch(spawn({ mTypes: ['MonsterZombie'] }), ctx)

    expect(ctx.selected.get('SpawnA')).toBe('MonsterCultist')
  })
})

describe('traits', () => {
  const monsters = new Map([
    ['MonsterA', { traits: ['undead'] }],
    ['MonsterB', { traits: ['undead', 'huge'] }],
  ])

  it('requires every listed trait', () => {
    const ctx = context({ contentMonsters: monsters })
    attemptMonsterMatch(spawn({ mTraitsRequired: ['undead', 'huge'] }), ctx)

    expect(ctx.selected.get('SpawnA')).toBe('MonsterB')
  })

  it('needs only one trait from a pool', () => {
    const ctx = context({ contentMonsters: monsters, random: () => 1 })
    attemptMonsterMatch(spawn({ mTraitsPool: ['undead', 'huge'] }), ctx)

    expect(ctx.selected.get('SpawnA')).toBe('MonsterB')
  })

  it('treats an empty pool as no requirement at all', () => {
    const ctx = context({ contentMonsters: monsters })
    attemptMonsterMatch(spawn({ mTraitsRequired: ['huge'], mTraitsPool: [] }), ctx)

    expect(ctx.selected.get('SpawnA')).toBe('MonsterB')
  })

  it('excludes the types the spawn named', () => {
    const ctx = context({ contentMonsters: monsters })
    attemptMonsterMatch(spawn({ mTypes: ['MonsterA'], mTraitsRequired: ['undead'] }), ctx)

    expect(ctx.selected.get('SpawnA')).toBe('MonsterB')
  })

  it('reports an error when nothing matches', () => {
    const messages: string[] = []
    setLogSink((message) => messages.push(message))
    const ctx = context({ contentMonsters: monsters })

    expect(attemptMonsterMatch(spawn({ mTraitsRequired: ['nonexistent'] }), ctx)).toBe(false)
    expect(messages[0]).toContain('Unable to find monster of traits')
    expect(ctx.log?.toArray()[0]?.editor).toBe(true)
  })

  describe('custom monsters', () => {
    it('match on their own traits', () => {
      const questMonsters = new Map([['CustomMonsterX', { traits: ['human'], baseMonster: '' }]])
      const ctx = context({ contentMonsters: new Map(), questMonsters })
      attemptMonsterMatch(spawn({ mTraitsRequired: ['human'] }), ctx)

      expect(ctx.selected.get('SpawnA')).toBe('CustomMonsterX')
    })

    it('inherit their base type’s traits only when they declare none', () => {
      const questMonsters = new Map([
        ['CustomMonsterX', { traits: [], baseMonster: 'MonsterB' }],
        ['CustomMonsterY', { traits: ['undead'], baseMonster: 'MonsterB' }],
      ])
      const ctx = context({ contentMonsters: monsters, questMonsters })
      attemptMonsterMatch(spawn({ mTraitsRequired: ['huge'], mTypes: ['MonsterB'] }), ctx)

      // Only X inherits 'huge'; Y declared its own traits and keeps them.
      expect(ctx.selected.get('SpawnA')).toBe('CustomMonsterX')
    })
  })

  describe('Descent deduplication', () => {
    it('avoids a type already chosen by another spawn', () => {
      const ctx = context({
        contentMonsters: monsters,
        gameType: 'D2E',
        selected: new Map([['SpawnOther', 'MonsterA']]),
      })
      attemptMonsterMatch(spawn({ mTraitsRequired: ['undead'] }), ctx)

      expect(ctx.selected.get('SpawnA')).toBe('MonsterB')
    })

    it('avoids a type already on the board', () => {
      const ctx = context({ contentMonsters: monsters, gameType: 'D2E', onBoard: ['MonsterA'] })
      attemptMonsterMatch(spawn({ mTraitsRequired: ['undead'] }), ctx)

      expect(ctx.selected.get('SpawnA')).toBe('MonsterB')
    })

    it('does not apply to Mansions, whose monsters are individuals', () => {
      const ctx = context({ contentMonsters: monsters, gameType: 'MoM', onBoard: ['MonsterA'] })
      attemptMonsterMatch(spawn({ mTraitsRequired: ['undead'] }), ctx)

      expect(ctx.selected.get('SpawnA')).toBe('MonsterA')
    })
  })
})

describe('runtimeMonsterSelection', () => {
  it('is false for a spawn section that does not exist', () => {
    const spawns = new Map([['SpawnA', spawn({ mTypes: ['MonsterZombie'] })]])

    expect(runtimeMonsterSelection('SpawnMissing', spawns, context())).toBe(false)
  })

  it('resolves a known spawn', () => {
    const spawns = new Map([['SpawnA', spawn({ mTypes: ['MonsterZombie'] })]])
    const ctx = context()

    expect(runtimeMonsterSelection('SpawnA', spawns, ctx)).toBe(true)
    expect(ctx.selected.get('SpawnA')).toBe('MonsterZombie')
  })
})
