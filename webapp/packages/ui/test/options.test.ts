/**
 * @vitest-environment happy-dom
 *
 * Tests for the options screen (T-018).
 *
 * Settings are written through as they change, matching the C#, which saves on
 * every slider move rather than on a confirm — so what is asserted is that each
 * control reports immediately and that "no fallback language" survives as a
 * real choice rather than collapsing into an unset one.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { options } from '../src/screens/options.js'
import type { OptionsView } from '../src/screens/options.js'

beforeEach(() => {
  document.body.replaceChildren()
})

const VIEW: OptionsView = {
  languages: [
    { id: 'English', name: 'English' },
    { id: 'French', name: 'Français' },
    { id: 'German', name: 'Deutsch' },
  ],
  language: 'French',
  fallback: 'English',
  music: 0.6,
  effects: 1,
}

function make(view: Partial<OptionsView> = {}) {
  const handlers = {
    onLanguage: vi.fn(),
    onFallback: vi.fn(),
    onMusic: vi.fn(),
    onEffects: vi.fn(),
    onClose: vi.fn(),
  }
  const screen = options(handlers)
  document.body.append(screen.element)
  screen.show({ ...VIEW, ...view })
  return { screen, handlers }
}

const select = (root: HTMLElement, id: string): HTMLSelectElement => {
  const found = root.querySelector<HTMLSelectElement>(`#${id}`)
  if (found === null) throw new Error(`no select ${id}`)
  return found
}

const slider = (root: HTMLElement, id: string): HTMLInputElement => {
  const found = root.querySelector<HTMLInputElement>(`#${id}`)
  if (found === null) throw new Error(`no slider ${id}`)
  return found
}

describe('options', () => {
  it('lists the languages by their own names', () => {
    const { screen } = make()
    const names = [...select(screen.element, 'vk-opt-language').options].map((o) => o.textContent)

    expect(names).toEqual(['English', 'Français', 'Deutsch'])
  })

  it('shows the current language as selected', () => {
    const { screen } = make()

    expect(select(screen.element, 'vk-opt-language').value).toBe('French')
  })

  it('reports a language change', () => {
    const { screen, handlers } = make()
    const control = select(screen.element, 'vk-opt-language')
    control.value = 'German'
    control.dispatchEvent(new Event('change'))

    expect(handlers.onLanguage).toHaveBeenCalledWith('German')
  })

  describe('fallback language', () => {
    it('offers None ahead of the languages', () => {
      const { screen } = make()
      const names = [...select(screen.element, 'vk-opt-fallback').options].map((o) => o.textContent)

      expect(names[0]).toBe('None')
    })

    it('reports None as null rather than an empty string', () => {
      // A missing key shows as the raw key with no fallback, which is what a
      // translator wants — so "none" has to survive as a real choice.
      const { screen, handlers } = make()
      const control = select(screen.element, 'vk-opt-fallback')
      control.value = ''
      control.dispatchEvent(new Event('change'))

      expect(handlers.onFallback).toHaveBeenCalledWith(null)
    })

    it('shows None as selected when there is no fallback', () => {
      const { screen } = make({ fallback: null })

      expect(select(screen.element, 'vk-opt-fallback').value).toBe('')
    })

    it('reports a chosen fallback', () => {
      const { screen, handlers } = make()
      const control = select(screen.element, 'vk-opt-fallback')
      control.value = 'German'
      control.dispatchEvent(new Event('change'))

      expect(handlers.onFallback).toHaveBeenCalledWith('German')
    })
  })

  describe('volumes', () => {
    it('starts at the stored values', () => {
      const { screen } = make()

      expect(slider(screen.element, 'vk-opt-music').value).toBe('0.6')
      expect(slider(screen.element, 'vk-opt-effects').value).toBe('1')
    })

    it('reports as the slider moves, not on release', () => {
      const { screen, handlers } = make()
      const control = slider(screen.element, 'vk-opt-music')
      control.value = '0.25'
      control.dispatchEvent(new Event('input'))

      expect(handlers.onMusic).toHaveBeenCalledWith(0.25)
    })

    it('keeps the readout in step', () => {
      const { screen } = make()
      const control = slider(screen.element, 'vk-opt-effects')
      control.value = '0.4'
      control.dispatchEvent(new Event('input'))

      expect(screen.element.textContent).toContain('40%')
    })

    it('labels each control, so a slider is not an unnamed number', () => {
      const { screen } = make()
      const labels = [...screen.element.querySelectorAll('label')].map((l) => l.getAttribute('for'))

      expect(labels).toContain('vk-opt-music')
      expect(labels).toContain('vk-opt-effects')
    })
  })

  it('closes', () => {
    const { screen, handlers } = make()
    const close = [...screen.element.querySelectorAll('button')].find(
      (b) => b.textContent === 'Close',
    )
    close?.click()

    expect(handlers.onClose).toHaveBeenCalledOnce()
  })
})
