/**
 * Tests for the monster dialog the play screen shows.
 *
 * This is the join `MonsterDialogMoM` makes against a live `Game`: the type,
 * its health, the attacks its traits allow and the text each of them draws.
 * What is asserted is the part that fails quietly — a monster with no attack
 * types offers no buttons, and the C#'s one asymmetry between attack text and
 * evade text is easy to lose.
 */

import { describe, expect, it, vi } from 'vitest'

import {
  ContentData,
  ContentLoader,
  headlessContext,
  loadQuestSections,
  MoMPhase,
  QuestRuntime,
  readFromString,
  VarManager,
} from '@valkyrie/core'
import type { MonsterInstance } from '@valkyrie/core'
import { monsterDialogView } from '../src/monsterView.js'

const CONTENT = `[MonsterManiac]
traits=humanoid
health=2
healthperhero=1
image=img/maniac

[AttackHumanoidBladed]
target=humanoid
attacktype=bladed
text=You slash at the {0} for {will} damage.

[EvadeManiac]
monster=Maniac
text=The {0} lunges past you, {will} unspent.
`

function content(ini = CONTENT): ContentData {
  const context = headlessContext({
    resolveTextureFile: (name) => `${name}.webp`,
    tilePixelPerSquare: 100,
  })
  const data = new ContentData(context)
  new ContentLoader(data, context).loadIni(readFromString(ini), '/pack', 'pack')
  return data
}

function monster(over: Partial<MonsterInstance> = {}): MonsterInstance {
  return {
    monsterName: 'MonsterManiac',
    spawnedBy: 'SpawnA',
    unique: false,
    health: 0,
    damage: 0,
    activated: false,
    minionStarted: false,
    masterStarted: false,
    currentActivation: null,
    ...over,
  }
}

function view(options: {
  ini?: string
  quest?: string
  instance?: MonsterInstance
  phase?: MoMPhase
  close?: () => void
  refresh?: () => void
  activate?: (name: string) => void
  defeat?: (m: MonsterInstance) => void
}) {
  const runtime = new QuestRuntime({ components: new Map() })
  runtime.heroes.push({ heroName: 'HeroA', activated: false })
  const instance = options.instance ?? monster()
  runtime.monsters.push(instance)

  const components = loadQuestSections(readFromString(options.quest ?? ''), 'test.ini', {
    format: 18,
  })

  const session = {
    runtime: {
      monsters: runtime.monsters,
      vars: new VarManager(),
      monsterHealth: (m: MonsterInstance, t: { healthBase: number; healthPerHero: number }) =>
        runtime.monsterHealth(m, t),
      setDamage: (m: MonsterInstance, damage: number, health: number) => {
        runtime.setDamage(m, damage, health)
      },
    },
    rounds: { phase: options.phase ?? MoMPhase.investigator },
    activate: options.activate ?? (() => {}),
    defeat: options.defeat ?? (() => {}),
  }

  return {
    built: monsterDialogView(
      {
        session,
        content: content(options.ini),
        components,
        questPath: '/quests/one',
        gameType: 'MoM',
        resolveTexture: (name) => (name.length === 0 ? null : `${name}.webp`),
        imageUrl: (path) => `url:${path}`,
        close: options.close ?? (() => {}),
        refresh: options.refresh ?? (() => {}),
        random: () => 0,
      },
      0,
    ),
    instance,
    runtime,
  }
}

describe('monsterDialogView', () => {
  it('resolves the type, its art and its health', () => {
    // health 2 + 1 per hero, with one investigator.
    const { built } = view({})

    expect(built?.monsterName).toBe('Maniac')
    // Content art is resolved against the pack it was declared in.
    expect(built?.image).toBe('url:/pack/img/maniac.webp')
    expect(built?.health.health).toBe(3)
  })

  it('offers only the attacks the monster’s traits allow', () => {
    expect(view({}).built?.attackTypes).toEqual(['bladed'])
  })

  it('replaces symbols in the attack text, as InvestigatorAttack does', () => {
    const text = view({}).built?.onAttack('bladed')

    expect(text).toContain('Maniac')
    expect(text).not.toContain('{will}')
  })

  it('leaves the evade text unreplaced, as InvestigatorEvade does', () => {
    // Only InvestigatorAttack.cs:68 calls OutputSymbolReplace; the evade and
    // horror dialogs draw their text without it.
    const text = view({}).built?.onEvade()

    expect(text).toContain('Maniac')
    expect(text).toContain('{will}')
  })

  it('runs the scenario’s own evade event instead of content text', () => {
    const activate = vi.fn()
    const close = vi.fn()
    const { built } = view({
      instance: monster({ monsterName: 'CustomMonsterEdith' }),
      quest: `[CustomMonsterEdith]
base=MonsterManiac
evadeevent=EventEdithSlips
[EventEdithSlips]
buttons=1
event1=
`,
      activate,
      close,
    })

    expect(built?.onEvade()).toBeNull()
    expect(activate).toHaveBeenCalledWith('EventEdithSlips')
    expect(close).toHaveBeenCalled()
  })

  it('inherits traits and health from the base monster', () => {
    const { built } = view({
      instance: monster({ monsterName: 'CustomMonsterEdith' }),
      quest: '[CustomMonsterEdith]\nbase=MonsterManiac\n',
    })

    expect(built?.attackTypes).toEqual(['bladed'])
    expect(built?.health.health).toBe(3)
  })

  it('swaps the options for a horror check in the horror phase', () => {
    expect(view({ phase: MoMPhase.horror }).built?.horrorPhase).toBe(true)
  })

  it('defeats the monster and closes, in that order', () => {
    const order: string[] = []
    const { built, instance } = view({
      close: () => order.push('close'),
      defeat: (m) => order.push(`defeat:${m.monsterName}`),
    })

    built?.health.onDefeated()

    expect(order).toEqual(['close', `defeat:${instance.monsterName}`])
  })

  it('shows nothing for a monster the content does not have', () => {
    expect(view({ instance: monster({ monsterName: 'MonsterGhoul' }) }).built).toBeNull()
  })
})
