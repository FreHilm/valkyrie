/**
 * The end-of-quest screen, replacing `EndGameScreen.cs`.
 *
 * Shows what happened in the session, then asks whether the party won, for a
 * rating out of ten, and for any comments.
 *
 * DEVIATION, and the important one: the C# posts every answer to a Google Form
 * owned by the upstream maintainer — scenario and quest name, victory, rating,
 * free-text comments, language, the investigator list, the complete event trace
 * and every non-zero quest variable. This port sends nothing. `onSubmit` is
 * optional and left unwired by the application, so a fork does not quietly
 * feed someone else's spreadsheet, and collecting free-text comments from
 * players stays an explicit choice rather than a default.
 */

import { button, label, panel } from '../components.js'
import { clear, el } from '../dom.js'
import { rawText } from '../text.js'
import type { Text } from '../text.js'

export interface QuestSummary {
  questName: string
  /** Investigator or hero names, in selection order. */
  party: readonly string[]
  /** Events the player answered, in order. */
  events: readonly string[]
  /** Whole minutes played, across every session of this quest. */
  minutes: number
  rounds: number
}

export interface EndGameFeedback {
  /** Null until the player answers; submission is refused while it is null. */
  won: boolean | null
  /** 1–10, or 0 for unanswered. */
  rating: number
  comments: string
}

export interface EndGameStrings {
  title: Text
  askVictory: Text
  yes: Text
  no: Text
  askRating: Text
  askComments: Text
  send: Text
  menu: Text
  missing: Text
  summary: Text
  party: Text
  duration: Text
  rounds: Text
  eventsSeen: Text
}

const DEFAULT_STRINGS: EndGameStrings = {
  title: rawText('The quest is over'),
  askVictory: rawText('Did the investigators win?'),
  yes: rawText('Yes'),
  no: rawText('No'),
  askRating: rawText('How would you rate this scenario?'),
  askComments: rawText('Any comments?'),
  send: rawText('Send feedback'),
  menu: rawText('Main menu'),
  missing: rawText('Answer the victory and rating questions before sending.'),
  summary: rawText('This session'),
  party: rawText('Party'),
  duration: rawText('Time played'),
  rounds: rawText('Rounds'),
  eventsSeen: rawText('Events seen'),
}

export interface EndGameOptions {
  onMenu: () => void
  /**
   * Receives the feedback. Left unset by the application, which is what keeps
   * the port from sending anything anywhere — see the note at the top.
   */
  onSubmit?: (feedback: EndGameFeedback) => void
  strings?: Partial<EndGameStrings>
}

export interface EndGame {
  element: HTMLElement
  show: (summary: QuestSummary) => void
  /** The answers so far, for tests. */
  feedback: () => EndGameFeedback
}

const RATINGS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

export function endGame(options: EndGameOptions): EndGame {
  const strings = { ...DEFAULT_STRINGS, ...options.strings }
  const element = panel({ class: 'vk-endgame' })

  let summary: QuestSummary | null = null
  let feedback: EndGameFeedback = { won: null, rating: 0, comments: '' }
  let error = false

  function render(): void {
    if (summary === null) return
    clear(element)

    element.append(label(strings.title, { heading: 2, size: 'large' }))
    element.append(label(rawText(summary.questName), { class: 'vk-endgame__quest' }))
    element.append(summaryList(summary))

    if (options.onSubmit !== undefined) element.append(feedbackForm())

    const actions = el('div', { class: 'vk-endgame__actions', attrs: { role: 'group' } })
    if (options.onSubmit !== undefined) {
      actions.append(
        button(strings.send, {
          onPress: submit,
          variant: 'primary',
          size: 'medium',
        }),
      )
    }
    actions.append(button(strings.menu, { onPress: options.onMenu, size: 'medium' }))
    element.append(actions)

    if (error) {
      element.append(label(strings.missing, { class: 'vk-endgame__error' }))
    }
  }

  function summaryList(view: QuestSummary): HTMLElement {
    const list = el('dl', { class: 'vk-endgame__summary' })
    const row = (term: Text, value: string): void => {
      list.append(el('dt', { text: termText(term) }))
      list.append(el('dd', { text: value }))
    }
    row(strings.party, view.party.join(', '))
    row(strings.rounds, String(view.rounds))
    row(strings.duration, formatMinutes(view.minutes))
    row(strings.eventsSeen, String(view.events.length))
    return list
  }

  function feedbackForm(): HTMLElement {
    const form = el('div', { class: 'vk-endgame__form' })

    form.append(label(strings.askVictory, { heading: 3 }))
    const victory = el('div', { class: 'vk-endgame__victory', attrs: { role: 'group' } })
    for (const [text, value] of [
      [strings.yes, true],
      [strings.no, false],
    ] as const) {
      const control = button(text, {
        onPress: () => {
          feedback = { ...feedback, won: value }
          error = false
          render()
        },
      })
      // The C# signals the choice with a background colour alone, which a
      // screen reader cannot see and a colour-blind player may not either.
      control.setAttribute('aria-pressed', feedback.won === value ? 'true' : 'false')
      victory.append(control)
    }
    form.append(victory)

    form.append(label(strings.askRating, { heading: 3 }))
    const rating = el('div', { class: 'vk-endgame__rating', attrs: { role: 'group' } })
    for (const value of RATINGS) {
      const control = button(rawText(String(value)), {
        onPress: () => {
          feedback = { ...feedback, rating: value }
          error = false
          render()
        },
        class: 'vk-endgame__rating-button',
      })
      control.setAttribute('aria-pressed', feedback.rating === value ? 'true' : 'false')
      rating.append(control)
    }
    form.append(rating)

    form.append(label(strings.askComments, { heading: 3 }))
    const comments = el('textarea', {
      class: 'vk-endgame__comments',
      attrs: { rows: '3', 'aria-label': termText(strings.askComments) },
    })
    comments.value = feedback.comments
    comments.addEventListener('input', () => {
      feedback = { ...feedback, comments: comments.value }
    })
    form.append(comments)
    return form
  }

  function submit(): void {
    // Both questions must be answered, as `SendStats` requires.
    if (feedback.won === null || feedback.rating === 0) {
      error = true
      render()
      return
    }
    options.onSubmit?.(feedback)
  }

  return {
    element,
    show: (view) => {
      summary = view
      render()
    },
    feedback: () => feedback,
  }
}

function termText(text: Text): string {
  return text.kind === 'raw' ? text.value : text.key.fullKey
}

/** Whole minutes as hours and minutes, so a long session reads sensibly. */
function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}
