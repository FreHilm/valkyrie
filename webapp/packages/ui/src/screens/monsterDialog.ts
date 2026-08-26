/**
 * The Mansions monster dialog: attack, evade and the horror check.
 *
 * Replaces `MonsterDialogMoM.cs`, `InvestigatorAttack.cs`, `InvestigatorEvade.cs`
 * and `HorrorCheck.cs` — four files that are one screen with four states. The
 * C# tears down the canvas between each; here the same element re-renders, so
 * focus survives and the health tracker does not jump.
 *
 * Which options appear depends on the phase: horror checks in the horror
 * phase, attack and evade otherwise, and everything but the horror check is
 * closed off once the monster is at full damage.
 */

import { button, label, panel } from '../components.js'
import { clear, el } from '../dom.js'
import { rawText } from '../text.js'
import type { Text } from '../text.js'
import type { RichTextOptions } from '../richText.js'

/** Which state the dialog is in. */
export type MonsterStep = 'options' | 'attackTypes' | 'text'

export interface MonsterHealth {
  /** `GetHealth()`. */
  health: number
  damage: number
  onDamageChange: (damage: number) => void
  onDefeated: () => void
}

export interface MonsterDialogView {
  monsterName: string
  image?: string
  /** True in `MoMPhase.horror`, which swaps the options for a horror check. */
  horrorPhase: boolean
  health: MonsterHealth
  /** `GetAttackTypes()`. Empty means the monster cannot be attacked. */
  attackTypes: readonly string[]
  /** Resolves an attack type to its text. Null when nothing matches. */
  onAttack: (type: string) => string | null
  /** Evade text, or null when the content pack has none for this monster. */
  onEvade: () => string | null
  /** Horror text, or null. */
  onHorror: () => string | null
  onCancel: () => void
}

export interface MonsterDialogStrings {
  attack: Text
  evade: Text
  horrorCheck: Text
  attackPrompt: Text
  cancel: Text
  finished: Text
  defeated: Text
  damage: Text
  health: Text
  nothingHappens: Text
}

const DEFAULT_STRINGS: MonsterDialogStrings = {
  attack: rawText('Attack'),
  evade: rawText('Evade'),
  horrorCheck: rawText('Horror check'),
  attackPrompt: rawText('Choose an attack'),
  cancel: rawText('Cancel'),
  finished: rawText('Finished'),
  defeated: rawText('Defeated'),
  damage: rawText('Damage'),
  health: rawText('Health'),
  nothingHappens: rawText('There is no text for this monster.'),
}

export interface MonsterDialogOptions {
  onLog: (entry: string) => void
  /** Renders quest prose as the game does: `<i>`, `<b>` and symbol icons. */
  rich?: RichTextOptions
  strings?: Partial<MonsterDialogStrings>
}

export interface MonsterDialog {
  element: HTMLElement
  show: (view: MonsterDialogView) => void
  step: () => MonsterStep
}

export function monsterDialog(options: MonsterDialogOptions): MonsterDialog {
  const strings = { ...DEFAULT_STRINGS, ...options.strings }
  const element = panel({ class: 'vk-monster' })
  element.setAttribute('aria-live', 'polite')

  let current: MonsterDialogView | null = null
  let step: MonsterStep = 'options'
  let shown = ''

  const alive = (view: MonsterDialogView): boolean => view.health.damage < view.health.health

  function render(): void {
    const view = current
    if (view === null) return
    clear(element)

    element.append(label(rawText(view.monsterName), { heading: 2, size: 'medium' }))
    if (view.image !== undefined) {
      element.append(
        el('img', { class: 'vk-monster__portrait', attrs: { src: view.image, alt: '' } }),
      )
    }

    if (step === 'options') renderOptions(view)
    else if (step === 'attackTypes') renderAttackTypes(view)
    else renderText(view)

    element.append(healthTracker(view.health))
  }

  function renderOptions(view: MonsterDialogView): void {
    const actions = group()
    if (view.horrorPhase) {
      actions.append(
        button(strings.horrorCheck, {
          onPress: () => showText(view.onHorror()),
          variant: 'primary',
          size: 'medium',
        }),
      )
      actions.append(button(strings.cancel, { onPress: view.onCancel, size: 'medium' }))
      element.append(actions)
      return
    }

    // Everything but the horror check closes off once the monster is dead.
    const canAct = alive(view)
    actions.append(
      button(strings.attack, {
        onPress: () => {
          step = 'attackTypes'
          render()
        },
        variant: 'primary',
        size: 'medium',
        disabled: !canAct,
      }),
    )
    actions.append(
      button(strings.evade, {
        onPress: () => showText(view.onEvade()),
        size: 'medium',
        disabled: !canAct,
      }),
    )
    actions.append(
      button(strings.cancel, { onPress: view.onCancel, size: 'medium', disabled: !canAct }),
    )
    element.append(actions)
  }

  function renderAttackTypes(view: MonsterDialogView): void {
    element.append(label(strings.attackPrompt))
    const actions = group()
    for (const type of view.attackTypes) {
      // The type name is content, not interface copy — a content pack names
      // its own attack types.
      actions.append(
        button(rawText(type), {
          onPress: () => showText(view.onAttack(type)),
          size: 'medium',
        }),
      )
    }
    actions.append(
      button(strings.cancel, {
        onPress: () => {
          step = 'options'
          render()
        },
        size: 'medium',
        disabled: !alive(view),
      }),
    )
    element.append(actions)
  }

  function renderText(view: MonsterDialogView): void {
    if (shown.length === 0) {
      // The C# draws no dialog at all here, leaving the player with no
      // feedback. Saying so is better than saying nothing.
      element.append(label(strings.nothingHappens))
    } else {
      const block = el('div', { class: 'vk-monster__text' })
      for (const paragraph of shown.split(/\n{2,}/)) {
        if (paragraph.trim().length === 0) continue
        block.append(
          label(
            rawText(paragraph.trim()),
            options.rich === undefined ? {} : { rich: options.rich },
          ),
        )
      }
      element.append(block)
    }

    const actions = group()
    actions.append(
      button(strings.finished, {
        onPress: () => {
          step = 'options'
          render()
        },
        variant: 'primary',
        size: 'medium',
        disabled: !alive(view),
      }),
    )
    element.append(actions)
  }

  function showText(text: string | null): void {
    shown = text ?? ''
    if (shown.length > 0) options.onLog(shown.split('\n').join('\\n'))
    step = 'text'
    render()
  }

  function healthTracker(view: MonsterHealth): HTMLElement {
    const row = el('div', { class: 'vk-monster__health', attrs: { role: 'group' } })
    row.append(label(strings.health, { class: 'vk-visually-hidden' }))
    row.append(el('span', { class: 'vk-monster__hp', text: String(view.health) }))
    row.append(
      button(rawText('−'), {
        onPress: () => view.onDamageChange(view.damage - 1),
        describedBy: strings.damage,
        disabled: view.damage === 0,
      }),
    )
    row.append(label(strings.damage, { class: 'vk-visually-hidden' }))
    row.append(el('span', { class: 'vk-monster__damage', text: String(view.damage) }))
    row.append(
      button(rawText('+'), {
        onPress: () => view.onDamageChange(view.damage + 1),
        describedBy: strings.damage,
        disabled: view.damage >= view.health,
      }),
    )
    if (view.damage >= view.health) {
      row.append(button(strings.defeated, { onPress: view.onDefeated, variant: 'danger' }))
    }
    return row
  }

  function group(): HTMLElement {
    return el('div', { class: 'vk-monster__buttons', attrs: { role: 'group' } })
  }

  return {
    element,
    show: (view) => {
      if (current?.monsterName !== view.monsterName) {
        step = 'options'
        shown = ''
      }
      current = view
      render()
    },
    step: () => step,
  }
}
