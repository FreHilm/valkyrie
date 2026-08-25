/**
 * @vitest-environment happy-dom
 *
 * A smoke test for the shell's monster-activation screen.
 *
 * The screen wires the real round controller to the real dialog, so this is
 * the only place the two are exercised together. It exists because a wiring
 * mistake — presenting before the renderer is built, resolving an activation
 * with the wrong context — throws at runtime and no unit test would see it.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { ActivationInstance, MoMPhase, QuestRuntime, RoundControllerMoM } from '@valkyrie/core'
import type { ActivationView, EventsView, MonsterInstance } from '@valkyrie/core'
import { StringKey } from '@valkyrie/core'
import { activationDialog } from '@valkyrie/ui'

const NO_EVENTS: EventsView = {
  current: null,
  monsterImage: null,
  queued: [],
  triggerType: () => false,
  triggerEvent: () => {},
  queue: () => false,
  isDisabled: () => false,
}

const literal = (value: string): StringKey => new StringKey(null, value, false)

const ZOMBIE: ActivationView = {
  sectionName: 'MonsterActivationZombieA',
  ability: literal('The {0} drags itself toward the nearest light.'),
  minionActions: literal(''),
  masterActions: literal('Attack the nearest investigator.'),
  moveButton: literal('The {0} moves'),
  move: literal('Move the {0} one space.'),
  minionFirst: false,
  masterFirst: false,
}

function wire() {
  const runtime = new QuestRuntime({ components: new Map() })
  const log: string[] = []
  let finished = 0
  let showing: MonsterInstance | null = null

  const dialog = activationDialog({
    onLog: (entry) => log.push(entry),
    onFinished: () => {
      finished++
      controller.monsterActivated()
    },
  })

  const render = (): void => {
    const instance = showing?.currentActivation
    if (instance === undefined || instance === null) return
    dialog.show({
      monsterName: 'Zombie',
      effect: instance.effect,
      attack: instance.masterActions,
      move: instance.move,
      moveLabel: instance.ad.moveButton.translate().split('{0}').join('Zombie'),
    })
  }

  const controller = new RoundControllerMoM({
    runtime,
    events: NO_EVENTS,
    monsterTypes: new Map([['MonsterZombie', { sectionName: 'MonsterZombie', activations: [] }]]),
    contentActivations: new Map([['MonsterActivationZombieA', ZOMBIE]]),
    questActivations: new Map(),
    random: () => 0,
    resolveActivation: (activation) =>
      new ActivationInstance(activation, {
        monsterName: 'Zombie',
        gameType: 'MoM',
        vars: runtime.vars,
      }),
    present: (request) => {
      if (request.kind !== 'activationMoM') return
      showing = request.monster
      render()
    },
  })

  runtime.spawnMonster('MonsterZombie', 'demo')
  controller.phase = MoMPhase.monsters
  document.body.append(dialog.element)
  controller.activateMonster()

  return { controller, dialog, log, runtime, finishedCount: () => finished }
}

const press = (root: HTMLElement, name: string): void => {
  const target = [...root.querySelectorAll('button')].find((b) => b.textContent?.includes(name))
  if (target === undefined) throw new Error(`no button matching ${name}`)
  target.click()
}

beforeEach(() => {
  document.body.replaceChildren()
})

describe('the activation screen wired to the round controller', () => {
  it('resolves the activation text through ActivationInstance', () => {
    const { dialog } = wire()

    expect(dialog.element.textContent).toContain(
      'The Zombie drags itself toward the nearest light.',
    )
    // The move button carries the activation's own label, substituted.
    expect(dialog.element.textContent).toContain('The Zombie moves')
  })

  it('walks attack then finished, and marks the monster activated', () => {
    const { controller, dialog, runtime, finishedCount } = wire()
    press(dialog.element, 'Monster attacks')

    expect(dialog.element.textContent).toContain('Attack the nearest investigator.')
    press(dialog.element, 'Finished')

    expect(finishedCount()).toBe(1)
    expect(runtime.monsters[0]?.activated).toBe(true)
    expect(controller.activateMonster()).toBe(true)
  })

  it('logs the ability and the attack in the order the player reads them', () => {
    const { dialog, log } = wire()
    press(dialog.element, 'Monster attacks')

    expect(log).toEqual([
      'The Zombie drags itself toward the nearest light.',
      'Attack the nearest investigator.',
    ])
  })
})
