/**
 * The Mansions monster-activation dialog.
 *
 * Replaces `ActivateDialogMoM.cs`, which walks the player through three steps:
 * what the monster does, then its attack, then its move. The C# tears the
 * whole canvas down and rebuilds it for each step; here the same element is
 * re-rendered, so focus and scroll position survive the transition.
 *
 * Each step's text is added to the quest log as the player reaches it, which
 * is how a Mansions session ends up with a readable account of the round.
 */

import { button, label, panel } from '../components.js'
import { clear, el } from '../dom.js'
import { rawText } from '../text.js'
import type { Text } from '../text.js'

/** Which step of the activation is showing. */
export type ActivationStep = 'overview' | 'attack' | 'move'

export interface MonsterHealthView {
  /** The monster's full health, `GetHealth()` in the C#. */
  health: number
  damage: number
  onDamageChange: (damage: number) => void
  onDefeated: () => void
}

export interface ActivationView {
  /** The monster's translated name. */
  monsterName: string
  /** `ActivationInstance.effect` — already translated and substituted. */
  effect: string
  /** `ActivationInstance.masterActions`. */
  attack: string
  /** `ActivationInstance.move`. Empty means the move step is skipped. */
  move: string
  /** The label on the move button, from `moveButton`. */
  moveLabel: string
  /** The monster's portrait, if the content pack supplied one. */
  image?: string
  /** Shown when the dialog is reached from the investigator phase. */
  healthTracker?: MonsterHealthView
}

export interface ActivationDialogOptions {
  /** Adds a line to the quest log, as each step does in the C#. */
  onLog: (entry: string) => void
  /** `activated()`: the activation is finished. */
  onFinished: () => void
  strings?: Partial<ActivationStrings>
}

export interface ActivationStrings {
  attacks: Text
  finished: Text
  defeated: Text
  damage: Text
  moreDamage: Text
  lessDamage: Text
  health: Text
}

const DEFAULT_STRINGS: ActivationStrings = {
  attacks: rawText('Monster attacks'),
  finished: rawText('Finished'),
  defeated: rawText('Defeated'),
  damage: rawText('Damage'),
  moreDamage: rawText('More damage'),
  lessDamage: rawText('Less damage'),
  health: rawText('Health'),
}

export interface ActivationDialog {
  element: HTMLElement
  show: (view: ActivationView) => void
  /** The step currently displayed, for tests and for a save to restore. */
  step: () => ActivationStep
}

export function activationDialog(options: ActivationDialogOptions): ActivationDialog {
  const strings = { ...DEFAULT_STRINGS, ...options.strings }
  const element = panel({ class: 'vk-activation' })
  element.setAttribute('aria-live', 'polite')

  let current: ActivationView | null = null
  let step: ActivationStep = 'overview'
  // Each step logs once. Re-rendering for a damage change must not log again.
  let logged = new Set<ActivationStep>()

  function render(): void {
    const view = current
    if (view === null) return
    clear(element)

    element.append(label(rawText(view.monsterName), { heading: 2, size: 'medium' }))
    if (view.image !== undefined) {
      element.append(
        el('img', {
          class: 'vk-activation__portrait',
          attrs: { src: view.image, alt: '' },
        }),
      )
    }

    if (step === 'overview') renderOverview(view)
    else renderStep(step === 'attack' ? view.attack : view.move)

    if (view.healthTracker !== undefined) element.append(healthTracker(view.healthTracker))
  }

  function renderOverview(view: ActivationView): void {
    if (view.effect.length > 0) {
      logOnce('overview', view.effect)
      element.append(paragraphs(view.effect))
    }

    const actions = el('div', { class: 'vk-activation__buttons', attrs: { role: 'group' } })
    actions.append(
      button(strings.attacks, {
        onPress: () => goTo('attack'),
        variant: 'primary',
        size: 'medium',
      }),
    )
    // The move button carries the activation's own label, which is why it is
    // text from content rather than a fixed string.
    actions.append(
      button(rawText(view.moveLabel), {
        onPress: () => goTo('move'),
        size: 'medium',
      }),
    )
    element.append(actions)
  }

  function renderStep(text: string): void {
    logOnce(step, text)
    element.append(paragraphs(text))
    const actions = el('div', { class: 'vk-activation__buttons', attrs: { role: 'group' } })
    actions.append(
      button(strings.finished, {
        onPress: options.onFinished,
        variant: 'primary',
        size: 'medium',
      }),
    )
    element.append(actions)
  }

  function goTo(next: ActivationStep): void {
    // An activation with no move text finishes rather than showing an empty
    // step — `CreateMoveWindow` returns straight to `activated()`.
    if (next === 'move' && (current?.move.length ?? 0) === 0) {
      options.onFinished()
      return
    }
    step = next
    render()
  }

  function logOnce(at: ActivationStep, text: string): void {
    if (logged.has(at)) return
    logged.add(at)
    // Stored with newlines escaped, which is how the C# writes them into the
    // log and therefore how a save round-trips them.
    options.onLog(text.split('\n').join('\\n'))
  }

  function healthTracker(view: MonsterHealthView): HTMLElement {
    const row = el('div', { class: 'vk-activation__health', attrs: { role: 'group' } })
    // The number is the visible part; the label is there for a screen reader,
    // which otherwise hears two bare numbers with no idea which is which.
    row.append(label(strings.health, { class: 'vk-visually-hidden' }))
    row.append(el('span', { class: 'vk-activation__hp', text: String(view.health) }))

    row.append(
      button(rawText('−'), {
        onPress: () => view.onDamageChange(view.damage - 1),
        describedBy: strings.lessDamage,
        disabled: view.damage === 0,
      }),
    )
    row.append(label(strings.damage, { class: 'vk-visually-hidden' }))
    row.append(el('span', { class: 'vk-activation__damage', text: String(view.damage) }))
    row.append(
      button(rawText('+'), {
        onPress: () => view.onDamageChange(view.damage + 1),
        describedBy: strings.moreDamage,
        disabled: view.damage >= view.health,
      }),
    )

    if (view.damage >= view.health) {
      row.append(button(strings.defeated, { onPress: view.onDefeated, variant: 'danger' }))
    }
    return row
  }

  return {
    element,
    show: (view) => {
      const sameMonster = current?.monsterName === view.monsterName
      current = view
      if (!sameMonster) {
        step = 'overview'
        logged = new Set()
      }
      render()
    },
    step: () => step,
  }
}

/** Blank lines separate paragraphs, as the event dialog does. */
function paragraphs(text: string): HTMLElement {
  const block = el('div', { class: 'vk-activation__text' })
  for (const paragraph of text.split(/\n{2,}/)) {
    if (paragraph.trim().length === 0) continue
    block.append(label(rawText(paragraph.trim())))
  }
  return block
}
