/**
 * @vitest-environment happy-dom
 *
 * Tests for the end-of-quest screen (T-018).
 *
 * The most important assertion here is a negative one: with no `onSubmit`
 * supplied — which is how the application wires it — nothing is collected and
 * no feedback form is shown at all. The C# posts every answer to a Google Form
 * owned by the upstream maintainer, and a fork must not inherit that.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { endGame } from '../src/screens/endGame.js'
import type { QuestSummary } from '../src/screens/endGame.js'

beforeEach(() => {
  document.body.replaceChildren()
})

const SUMMARY: QuestSummary = {
  questName: 'The Fall of House Lynch',
  party: ['Ashcan Pete', 'Agnes Baker'],
  events: ['EventIntro', 'EventHallway', 'EventCellar'],
  minutes: 95,
  rounds: 12,
}

const buttons = (root: HTMLElement): HTMLButtonElement[] => [...root.querySelectorAll('button')]

const press = (root: HTMLElement, name: string): void => {
  const target = buttons(root).find((b) => b.textContent === name)
  if (target === undefined) throw new Error(`no button matching ${name}`)
  target.click()
}

function make(onSubmit?: (feedback: unknown) => void) {
  const onMenu = vi.fn()
  const screen = endGame(onSubmit === undefined ? { onMenu } : { onMenu, onSubmit })
  document.body.append(screen.element)
  screen.show(SUMMARY)
  return { screen, onMenu }
}

describe('endGame', () => {
  it('summarises the session', () => {
    const { screen } = make()
    const text = screen.element.textContent ?? ''

    expect(text).toContain('The Fall of House Lynch')
    expect(text).toContain('Ashcan Pete, Agnes Baker')
    expect(text).toContain('12') // rounds
    expect(text).toContain('3') // events seen
  })

  it('reads a long session as hours and minutes', () => {
    const { screen } = make()

    expect(screen.element.textContent).toContain('1 h 35 min')
  })

  it('reads a short session as minutes', () => {
    const screen = endGame({ onMenu: vi.fn() })
    document.body.append(screen.element)
    screen.show({ ...SUMMARY, minutes: 45 })

    expect(screen.element.textContent).toContain('45 min')
  })

  describe('with no submission handler, as the application wires it', () => {
    it('shows no feedback form at all', () => {
      const { screen } = make()

      expect(screen.element.textContent).not.toContain('Did the investigators win?')
      expect(screen.element.querySelector('textarea')).toBeNull()
    })

    it('offers only the way back to the menu', () => {
      const { screen, onMenu } = make()

      expect(buttons(screen.element).map((b) => b.textContent)).toEqual(['Main menu'])
      press(screen.element, 'Main menu')
      expect(onMenu).toHaveBeenCalledOnce()
    })
  })

  describe('when a submission handler is supplied', () => {
    it('asks the victory and rating questions', () => {
      const { screen } = make(vi.fn())

      expect(screen.element.textContent).toContain('Did the investigators win?')
      expect(screen.element.textContent).toContain('How would you rate this scenario?')
    })

    it('refuses to submit until both are answered', () => {
      const onSubmit = vi.fn()
      const { screen } = make(onSubmit)
      press(screen.element, 'Send feedback')

      expect(onSubmit).not.toHaveBeenCalled()
      expect(screen.element.textContent).toContain('Answer the victory and rating questions')
    })

    it('still refuses with only the victory answered', () => {
      const onSubmit = vi.fn()
      const { screen } = make(onSubmit)
      press(screen.element, 'Yes')
      press(screen.element, 'Send feedback')

      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('submits once both are answered', () => {
      const onSubmit = vi.fn()
      const { screen } = make(onSubmit)
      press(screen.element, 'No')
      press(screen.element, '7')
      press(screen.element, 'Send feedback')

      expect(onSubmit).toHaveBeenCalledWith({ won: false, rating: 7, comments: '' })
    })

    it('carries the comments', () => {
      const onSubmit = vi.fn()
      const { screen } = make(onSubmit)
      const comments = screen.element.querySelector('textarea')
      if (comments === null) throw new Error('no comments field')
      comments.value = 'The cellar puzzle was excellent.'
      comments.dispatchEvent(new Event('input'))
      press(screen.element, 'Yes')
      press(screen.element, '9')
      press(screen.element, 'Send feedback')

      expect(onSubmit).toHaveBeenCalledWith({
        won: true,
        rating: 9,
        comments: 'The cellar puzzle was excellent.',
      })
    })

    it('announces the selection rather than signalling it by colour alone', () => {
      const { screen } = make(vi.fn())
      press(screen.element, 'Yes')

      const yes = buttons(screen.element).find((b) => b.textContent === 'Yes')
      const no = buttons(screen.element).find((b) => b.textContent === 'No')
      expect(yes?.getAttribute('aria-pressed')).toBe('true')
      expect(no?.getAttribute('aria-pressed')).toBe('false')
    })

    it('keeps only the latest rating selected', () => {
      const { screen } = make(vi.fn())
      press(screen.element, '3')
      press(screen.element, '8')

      const pressed = buttons(screen.element)
        .filter((b) => b.getAttribute('aria-pressed') === 'true')
        .map((b) => b.textContent)
      expect(pressed).toEqual(['8'])
      expect(screen.feedback().rating).toBe(8)
    })

    it('clears the error once the missing answer is given', () => {
      const { screen } = make(vi.fn())
      press(screen.element, 'Send feedback')
      expect(screen.element.textContent).toContain('Answer the victory')

      press(screen.element, 'Yes')
      expect(screen.element.textContent).not.toContain('Answer the victory')
    })
  })
})
