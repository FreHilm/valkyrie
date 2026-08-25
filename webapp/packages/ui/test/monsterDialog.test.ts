/**
 * @vitest-environment happy-dom
 *
 * Tests for the Mansions monster dialog (T-018).
 *
 * Four C# files — `MonsterDialogMoM`, `InvestigatorAttack`, `InvestigatorEvade`
 * and `HorrorCheck` — are one screen with four states here. None of them has a
 * test, and none can: each builds its canvas in a constructor. What is asserted
 * is the state machine and the gating: which options a phase offers, what a
 * dead monster still allows, and what happens when the content pack has no
 * text at all.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { monsterDialog } from '../src/screens/monsterDialog.js'
import type { MonsterDialogView } from '../src/screens/monsterDialog.js'

beforeEach(() => {
  document.body.replaceChildren()
})

function make(overrides: Partial<MonsterDialogView> = {}) {
  const log: string[] = []
  const cancel = vi.fn()
  const defeated = vi.fn()
  const damage: number[] = []
  const dialog = monsterDialog({ onLog: (entry) => log.push(entry) })
  document.body.append(dialog.element)

  const view: MonsterDialogView = {
    monsterName: 'Zombie',
    horrorPhase: false,
    health: {
      health: 3,
      damage: 0,
      onDamageChange: (next) => damage.push(next),
      onDefeated: defeated,
    },
    attackTypes: ['heavy', 'unarmed'],
    onAttack: (type) => `You hit the Zombie with a ${type} blow.`,
    onEvade: () => 'You slip past the Zombie.',
    onHorror: () => 'The Zombie is a horror to behold.',
    onCancel: cancel,
    ...overrides,
  }
  dialog.show(view)
  return { dialog, log, cancel, defeated, damage }
}

const buttons = (root: HTMLElement): HTMLButtonElement[] => [...root.querySelectorAll('button')]
const names = (root: HTMLElement): (string | null)[] => buttons(root).map((b) => b.textContent)

const press = (root: HTMLElement, name: string): void => {
  const target = buttons(root).find((b) => b.textContent === name)
  if (target === undefined) throw new Error(`no button matching ${name}`)
  target.click()
}

describe('monsterDialog', () => {
  it('offers attack, evade and cancel outside the horror phase', () => {
    const { dialog } = make()

    expect(names(dialog.element)).toEqual(['Attack', 'Evade', 'Cancel', '−', '+'])
  })

  it('offers only the horror check in the horror phase', () => {
    const { dialog } = make({ horrorPhase: true })

    expect(names(dialog.element)).toEqual(['Horror check', 'Cancel', '−', '+'])
  })

  it('lists the attack types the monster’s traits allow', () => {
    const { dialog } = make()
    press(dialog.element, 'Attack')

    expect(dialog.step()).toBe('attackTypes')
    expect(names(dialog.element)).toEqual(['heavy', 'unarmed', 'Cancel', '−', '+'])
  })

  it('shows and logs the attack text', () => {
    const { dialog, log } = make()
    press(dialog.element, 'Attack')
    press(dialog.element, 'heavy')

    expect(dialog.element.textContent).toContain('You hit the Zombie with a heavy blow.')
    expect(log).toEqual(['You hit the Zombie with a heavy blow.'])
  })

  it('shows and logs the evade text', () => {
    const { dialog, log } = make()
    press(dialog.element, 'Evade')

    expect(dialog.element.textContent).toContain('You slip past the Zombie.')
    expect(log).toEqual(['You slip past the Zombie.'])
  })

  it('shows and logs the horror text', () => {
    const { dialog, log } = make({ horrorPhase: true })
    press(dialog.element, 'Horror check')

    expect(dialog.element.textContent).toContain('The Zombie is a horror to behold.')
    expect(log).toEqual(['The Zombie is a horror to behold.'])
  })

  it('says so when the content pack has no text, rather than doing nothing', () => {
    // The C# draws no dialog at all here, so the player presses Evade and sees
    // no response whatsoever.
    const { dialog, log } = make({ onEvade: () => null })
    press(dialog.element, 'Evade')

    expect(dialog.step()).toBe('text')
    expect(dialog.element.textContent).toContain('There is no text for this monster.')
    expect(log).toEqual([])
  })

  it('escapes newlines into the log, as a save carries them', () => {
    const { dialog, log } = make({ onEvade: () => 'Line one\nLine two' })
    press(dialog.element, 'Evade')

    expect(log).toEqual(['Line one\\nLine two'])
  })

  it('returns to the options from the text step', () => {
    const { dialog } = make()
    press(dialog.element, 'Evade')
    press(dialog.element, 'Finished')

    expect(dialog.step()).toBe('options')
  })

  it('cancels out of the attack list without attacking', () => {
    const { dialog, log } = make()
    press(dialog.element, 'Attack')
    press(dialog.element, 'Cancel')

    expect(dialog.step()).toBe('options')
    expect(log).toEqual([])
  })

  describe('a monster at full damage', () => {
    // Built fresh each time: a shared object would carry one spy across tests
    // and quietly shadow the one `make` wires up.
    const dead = (onDefeated = vi.fn()) => ({
      health: { health: 2, damage: 2, onDamageChange: () => {}, onDefeated },
    })

    it('cannot be attacked, evaded or dismissed', () => {
      const { dialog } = make(dead())
      const enabled = buttons(dialog.element).filter((b) => !b.disabled)

      expect(enabled.map((b) => b.textContent)).toEqual(['−', 'Defeated'])
    })

    it('still allows a horror check', () => {
      const { dialog } = make({ ...dead(), horrorPhase: true })
      const horror = buttons(dialog.element).find((b) => b.textContent === 'Horror check')

      expect(horror?.disabled).toBe(false)
    })

    it('offers Defeated', () => {
      const onDefeated = vi.fn()
      const { dialog } = make(dead(onDefeated))
      press(dialog.element, 'Defeated')

      expect(onDefeated).toHaveBeenCalledOnce()
    })
  })

  it('reports damage changes rather than mutating its own view', () => {
    const { dialog, damage } = make()
    press(dialog.element, '+')

    expect(damage).toEqual([1])
  })

  it('starts a different monster back at the options', () => {
    const { dialog } = make()
    press(dialog.element, 'Evade')
    dialog.show({
      monsterName: 'Cultist',
      horrorPhase: false,
      health: { health: 2, damage: 0, onDamageChange: () => {}, onDefeated: vi.fn() },
      attackTypes: [],
      onAttack: () => null,
      onEvade: () => null,
      onHorror: () => null,
      onCancel: vi.fn(),
    })

    expect(dialog.step()).toBe('options')
    expect(dialog.element.textContent).toContain('Cultist')
  })
})
