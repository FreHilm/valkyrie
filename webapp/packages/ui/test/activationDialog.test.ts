/**
 * @vitest-environment happy-dom
 *
 * Tests for the Mansions activation dialog (T-018).
 *
 * `ActivateDialogMoM.cs` has no tests and cannot have any: it builds its
 * canvas in the constructor. What is asserted here is the step machine — which
 * text shows when, what reaches the quest log, and the case where a monster
 * with no move text finishes instead of showing an empty step.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { activationDialog } from '../src/screens/activationDialog.js'
import type { ActivationView } from '../src/screens/activationDialog.js'

beforeEach(() => {
  document.body.replaceChildren()
})

const view = (overrides: Partial<ActivationView> = {}): ActivationView => ({
  monsterName: 'Zombie',
  effect: 'The Zombie lurches forward.',
  attack: 'Attack the nearest investigator.',
  move: 'Move one space toward the nearest investigator.',
  moveLabel: 'Monster moves',
  ...overrides,
})

function make(overrides: Partial<ActivationView> = {}) {
  const log: string[] = []
  const finished = vi.fn()
  const dialog = activationDialog({ onLog: (entry) => log.push(entry), onFinished: finished })
  document.body.append(dialog.element)
  dialog.show(view(overrides))
  return { dialog, log, finished }
}

const buttons = (root: HTMLElement): HTMLButtonElement[] => [...root.querySelectorAll('button')]

const press = (root: HTMLElement, name: string): void => {
  const target = buttons(root).find((b) => b.textContent?.includes(name))
  if (target === undefined) throw new Error(`no button matching ${name}`)
  target.click()
}

describe('activationDialog', () => {
  it('opens on the overview with the ability text and both buttons', () => {
    const { dialog } = make()

    expect(dialog.step()).toBe('overview')
    expect(dialog.element.textContent).toContain('The Zombie lurches forward.')
    expect(buttons(dialog.element).map((b) => b.textContent)).toEqual([
      'Monster attacks',
      'Monster moves',
    ])
  })

  it('shows the attack text on the attack step', () => {
    const { dialog } = make()
    press(dialog.element, 'Monster attacks')

    expect(dialog.step()).toBe('attack')
    expect(dialog.element.textContent).toContain('Attack the nearest investigator.')
    expect(dialog.element.textContent).not.toContain('lurches forward')
  })

  it('shows the move text on the move step', () => {
    const { dialog } = make()
    press(dialog.element, 'Monster moves')

    expect(dialog.step()).toBe('move')
    expect(dialog.element.textContent).toContain('Move one space')
  })

  it('finishes rather than showing an empty move step', () => {
    const { dialog, finished } = make({ move: '' })
    press(dialog.element, 'Monster moves')

    expect(finished).toHaveBeenCalledOnce()
    expect(dialog.step()).toBe('overview')
  })

  it('finishes from the attack step', () => {
    const { dialog, finished } = make()
    press(dialog.element, 'Monster attacks')
    press(dialog.element, 'Finished')

    expect(finished).toHaveBeenCalledOnce()
  })

  it('logs each step once, with newlines escaped as a save carries them', () => {
    const { dialog, log } = make({ effect: 'Line one\nLine two' })
    press(dialog.element, 'Monster attacks')

    expect(log).toEqual(['Line one\\nLine two', 'Attack the nearest investigator.'])
  })

  it('does not log an empty ability', () => {
    const { log } = make({ effect: '' })

    expect(log).toEqual([])
  })

  it('starts a different monster back at the overview', () => {
    const { dialog, log } = make()
    press(dialog.element, 'Monster attacks')
    dialog.show(view({ monsterName: 'Cultist', effect: 'The Cultist chants.' }))

    expect(dialog.step()).toBe('overview')
    expect(log).toContain('The Cultist chants.')
  })

  describe('health tracker', () => {
    const withHealth = (damage: number) => {
      const changes: number[] = []
      const defeated = vi.fn()
      const dialog = activationDialog({ onLog: () => {}, onFinished: () => {} })
      document.body.append(dialog.element)
      dialog.show(
        view({
          healthTracker: {
            health: 3,
            damage,
            onDamageChange: (next) => changes.push(next),
            onDefeated: defeated,
          },
        }),
      )
      return { dialog, changes, defeated }
    }

    it('cannot go below zero damage', () => {
      const { dialog } = withHealth(0)
      const minus = buttons(dialog.element).find((b) => b.textContent === '−')

      expect(minus?.disabled).toBe(true)
    })

    it('cannot exceed the monster’s health', () => {
      const { dialog } = withHealth(3)
      const plus = buttons(dialog.element).find((b) => b.textContent === '+')

      expect(plus?.disabled).toBe(true)
    })

    it('offers Defeated only at full damage', () => {
      expect(buttons(withHealth(2).dialog.element).map((b) => b.textContent)).not.toContain(
        'Defeated',
      )
      expect(buttons(withHealth(3).dialog.element).map((b) => b.textContent)).toContain('Defeated')
    })

    it('reports a damage change rather than mutating its own view', () => {
      const { dialog, changes } = withHealth(1)
      press(dialog.element, '+')

      expect(changes).toEqual([2])
    })
  })
})
