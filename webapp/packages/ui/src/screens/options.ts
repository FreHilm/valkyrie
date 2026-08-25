/**
 * The options screen, replacing `OptionsScreen.cs`.
 *
 * Language, fallback language, and the two audio volumes — the settings the
 * web build can honour. Values are written straight through as the player
 * changes them, matching the C#, which saves on every slider move rather than
 * on a confirm.
 *
 * DEVIATION: resolution and fullscreen are dropped. Resolution belongs to the
 * browser window, and there is nothing meaningful to set; the C# enumerates
 * Unity's display modes and needs a restart to apply them. Fullscreen is left
 * to the browser's own control, which is where users already look for it and
 * which works without a permission prompt only from a real gesture.
 */

import { button, label, panel } from '../components.js'
import { clear, el } from '../dom.js'
import { rawText } from '../text.js'
import type { Text } from '../text.js'

export interface LanguageChoice {
  /** The dictionary's own name for the language, e.g. "English". */
  id: string
  /** What to show the player — normally the language's own endonym. */
  name: string
}

export interface OptionsView {
  languages: readonly LanguageChoice[]
  language: string
  /** The language to fall back to for missing keys, or null for none. */
  fallback: string | null
  /** 0–1, as the config stores them. */
  music: number
  effects: number
}

export interface OptionsStrings {
  title: Text
  language: Text
  fallbackLanguage: Text
  none: Text
  music: Text
  effects: Text
  close: Text
}

const DEFAULT_STRINGS: OptionsStrings = {
  title: rawText('Options'),
  language: rawText('Language'),
  fallbackLanguage: rawText('Fallback language'),
  none: rawText('None'),
  music: rawText('Music'),
  effects: rawText('Sound effects'),
  close: rawText('Close'),
}

export interface OptionsHandlers {
  onLanguage: (id: string) => void
  onFallback: (id: string | null) => void
  onMusic: (volume: number) => void
  onEffects: (volume: number) => void
  onClose: () => void
  strings?: Partial<OptionsStrings>
}

export interface Options {
  element: HTMLElement
  show: (view: OptionsView) => void
}

export function options(handlers: OptionsHandlers): Options {
  const strings = { ...DEFAULT_STRINGS, ...handlers.strings }
  const element = panel({ class: 'vk-options' })

  return {
    element,
    show: (view) => {
      clear(element)
      element.append(label(strings.title, { heading: 2, size: 'large' }))

      element.append(
        selectRow(strings.language, 'vk-opt-language', view.languages, view.language, (id) =>
          handlers.onLanguage(id),
        ),
      )

      // "None" is a real choice, not an absent one: with no fallback a missing
      // key shows as the raw key, which is what a translator wants to see.
      const fallbackChoices = [{ id: '', name: textOf(strings.none) }, ...view.languages]
      element.append(
        selectRow(
          strings.fallbackLanguage,
          'vk-opt-fallback',
          fallbackChoices,
          view.fallback ?? '',
          (id) => handlers.onFallback(id === '' ? null : id),
        ),
      )

      element.append(volumeRow(strings.music, 'vk-opt-music', view.music, handlers.onMusic))
      element.append(volumeRow(strings.effects, 'vk-opt-effects', view.effects, handlers.onEffects))

      element.append(button(strings.close, { onPress: handlers.onClose, size: 'medium' }))
    },
  }
}

function selectRow(
  name: Text,
  id: string,
  choices: readonly LanguageChoice[],
  selected: string,
  onChange: (id: string) => void,
): HTMLElement {
  const row = el('div', { class: 'vk-options__row' })
  row.append(el('label', { text: textOf(name), attrs: { for: id } }))

  const select = el('select', { class: 'vk-options__select', attrs: { id } })
  for (const choice of choices) {
    const option = el('option', { text: choice.name, attrs: { value: choice.id } })
    if (choice.id === selected) option.selected = true
    select.append(option)
  }
  select.addEventListener('change', () => onChange(select.value))
  row.append(select)
  return row
}

function volumeRow(
  name: Text,
  id: string,
  value: number,
  onChange: (volume: number) => void,
): HTMLElement {
  const row = el('div', { class: 'vk-options__row' })
  row.append(el('label', { text: textOf(name), attrs: { for: id } }))

  const slider = el('input', {
    class: 'vk-options__slider',
    attrs: {
      id,
      type: 'range',
      min: '0',
      max: '1',
      step: '0.05',
      value: String(value),
    },
  })
  const readout = el('span', {
    class: 'vk-options__readout',
    text: percent(value),
    attrs: { 'aria-hidden': 'true' },
  })
  slider.addEventListener('input', () => {
    readout.textContent = percent(Number(slider.value))
    onChange(Number(slider.value))
  })
  row.append(slider)
  row.append(readout)
  return row
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function textOf(text: Text): string {
  return text.kind === 'raw' ? text.value : text.key.fullKey
}
