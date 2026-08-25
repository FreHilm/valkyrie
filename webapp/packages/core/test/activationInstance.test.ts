/**
 * Tests for `Quest.ActivationInstance` (T-018).
 *
 * This is where an activation's text becomes what the player reads. The order
 * of the steps is the whole point — translate, then `{0}`, then symbols, then
 * newlines — and the `activation` differential harness checks it against the
 * class sliced out of the real `Quest.cs`. These pin the same cases so a
 * regression shows up in `npm test`.
 */

import { describe, expect, it } from 'vitest'

import { ActivationInstance } from '../src/quest/ActivationInstance.js'
import type { ActivationView } from '../src/quest/ActivationInstance.js'
import { DictionaryI18n } from '../src/i18n/DictionaryI18n.js'
import { Localization } from '../src/i18n/Localization.js'
import { StringKey } from '../src/i18n/StringKey.js'
import { VarManager } from '../src/quest/VarManager.js'

const literal = (text: string): StringKey => new StringKey(null, text, false)

function view(spec: Partial<Record<keyof ActivationView, string>> = {}): ActivationView {
  return {
    sectionName: 'MonsterActivationX',
    ability: literal((spec.ability as string) ?? ''),
    minionActions: literal((spec.minionActions as string) ?? ''),
    masterActions: literal((spec.masterActions as string) ?? ''),
    moveButton: literal((spec.moveButton as string) ?? ''),
    move: literal((spec.move as string) ?? ''),
    minionFirst: false,
    masterFirst: false,
  }
}

function localizationWith(entries: Record<string, string>): Localization {
  const localization = new Localization()
  const lines = ['.,English', ...Object.entries(entries).map(([k, v]) => `${k},${v}`)]
  localization.addDictionary('val', new DictionaryI18n(lines))
  return localization
}

function build(
  activation: ActivationView,
  overrides: { monsterName?: string; gameType?: 'MoM' | 'D2E'; hero?: string } & {
    vars?: Record<string, number>
    localization?: Localization
  } = {},
): ActivationInstance {
  const vars = new VarManager()
  for (const [name, value] of Object.entries(overrides.vars ?? {})) vars.setValue(name, value)
  return new ActivationInstance(activation, {
    monsterName: overrides.monsterName ?? 'Zombie',
    gameType: overrides.gameType ?? 'MoM',
    vars,
    ...(overrides.localization === undefined ? {} : { localization: overrides.localization }),
    randomHeroName: () => overrides.hero ?? 'Syrus',
  })
}

describe('ActivationInstance', () => {
  it('substitutes the monster name everywhere it appears', () => {
    const instance = build(
      view({ ability: 'The {0} lurches.', minionActions: '{0} and {0}', move: '{0} advances' }),
    )

    expect(instance.effect).toBe('The Zombie lurches.')
    expect(instance.minionActions).toBe('Zombie and Zombie')
    expect(instance.move).toBe('Zombie advances')
  })

  it('replaces symbols after substituting, so a marker in the name still resolves', () => {
    // `{will}` is a Mansions marker; substitution has to happen first for the
    // marker arriving through the monster name to become a glyph.
    const plain = build(view({ ability: 'The {0} moves.' }), { monsterName: 'Zombie' })
    const marked = build(view({ ability: 'The {0} moves.' }), { monsterName: '{will}' })

    expect(plain.effect).toBe('The Zombie moves.')
    expect(marked.effect).not.toContain('{will}')
  })

  it('resolves variables in every field', () => {
    const instance = build(
      view({
        ability: 'Doom {var:$doom}',
        minionActions: 'Gold {var:$g}',
        masterActions: 'Gold {var:$g}',
        move: 'Move {var:$m}',
      }),
      { vars: { $doom: 3, $g: 7, $m: 2 } },
    )

    expect(instance.effect).toBe('Doom 3')
    expect(instance.minionActions).toBe('Gold 7')
    expect(instance.masterActions).toBe('Gold 7')
    expect(instance.move).toBe('Move 2')
  })

  it('unescapes newlines that arrive through the monster name', () => {
    // A literal key and a dictionary value are both unescaped by `translate`,
    // so the unescape at the end is only reachable through a substituted name.
    const instance = build(view({ ability: 'The {0} moves.' }), { monsterName: 'Zom\\nbie' })

    expect(instance.effect).toBe('The Zom\nbie moves.')
  })

  it('resolves text through a dictionary key', () => {
    const localization = localizationWith({ ABILITY: 'The {0} howls.' })
    const instance = build(
      { ...view(), ability: StringKey.parse('{val:ABILITY}', localization) },
      { localization },
    )

    expect(instance.effect).toBe('The Zombie howls.')
  })

  describe('Descent', () => {
    it('names a random hero in {0} and the monster in {1}', () => {
      const instance = build(view({ ability: '{0} is attacked by the {1}.' }), {
        gameType: 'D2E',
        hero: 'Syrus',
      })

      expect(instance.effect).toBe('Syrus is attacked by the Zombie.')
    })

    it('leaves move empty, because Descent has no move text', () => {
      const instance = build(view({ move: 'never read' }), { gameType: 'D2E' })

      expect(instance.move).toBe('')
    })

    it('still substitutes the monster into the action text', () => {
      const instance = build(view({ minionActions: '{0} attacks' }), { gameType: 'D2E' })

      expect(instance.minionActions).toBe('Zombie attacks')
    })
  })

  describe('Mansions', () => {
    it('uses the monster for {0} and never a hero', () => {
      const instance = build(view({ ability: '{0} advances. {1} is ignored.' }), { hero: 'Syrus' })

      expect(instance.effect).toBe('Zombie advances. {1} is ignored.')
    })
  })

  it('picks the half the dialog is showing', () => {
    const instance = build(view({ minionActions: 'minion', masterActions: 'master' }))

    expect(instance.actions(true)).toBe('master')
    expect(instance.actions(false)).toBe('minion')
  })
})
