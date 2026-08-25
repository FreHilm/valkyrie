/**
 * Importing a licensed install's assets.
 *
 * The Unity app finds the install by guessing at well-known paths and imports
 * silently on first run. A browser cannot look at the disk at all, so the
 * player has to hand over the game's data folder — which means the screen has
 * to explain what is being asked for and why, and say plainly where the files
 * end up.
 *
 * That explanation is the screen's real job. The import itself is a progress
 * bar over work that happens elsewhere.
 */

import { button, label, panel } from '../components.js'
import { clear, el } from '../dom.js'
import { rawText } from '../text.js'
import type { Text } from '../text.js'

export type ImportPhase = 'idle' | 'picking' | 'importing' | 'done' | 'failed' | 'unsupported'

export interface ImportProgress {
  done: number
  total: number
  what: string
}

export interface ImportSummary {
  textures: number
  audio: number
  text: number
  bytesWritten: number
  skipped: number
}

export interface ImportStrings {
  title: Text
  explain: Text
  privacy: Text
  choose: Text
  cancel: Text
  retry: Text
  unsupported: Text
  finished: Text
  failed: Text
}

const DEFAULT_STRINGS: ImportStrings = {
  title: rawText('Import your game files'),
  explain: rawText(
    'Valkyrie needs the artwork and audio from a copy of the game you own. ' +
      'Choose the game’s data folder and they will be read once.',
  ),
  privacy: rawText(
    'The files stay in this browser on this device. Nothing is uploaded, and ' +
      'Valkyrie can only read the folder you choose.',
  ),
  choose: rawText('Choose the game folder'),
  cancel: rawText('Cancel'),
  retry: rawText('Try again'),
  unsupported: rawText(
    'This browser cannot open a folder. Chrome, Edge and Opera on a desktop can; ' +
      'Firefox and Safari cannot yet.',
  ),
  finished: rawText('Import finished'),
  failed: rawText('The import did not finish'),
}

export interface ImportOptions {
  /** Opens the picker and runs the import. Rejects if the player cancels. */
  onImport: (report: (progress: ImportProgress) => void) => Promise<ImportSummary>
  /** Whether this browser can open a directory at all. */
  supported: boolean
  onDone?: (summary: ImportSummary) => void
  onCancel?: () => void
  strings?: Partial<ImportStrings>
  /** Renders a byte count; the app passes its own formatter. */
  formatBytes?: (bytes: number) => string
}

export interface ImportScreen {
  element: HTMLElement
  phase: () => ImportPhase
}

export function importScreen(options: ImportOptions): ImportScreen {
  const strings = { ...DEFAULT_STRINGS, ...options.strings }
  const format = options.formatBytes ?? ((bytes: number) => `${bytes} bytes`)
  const element = panel({ class: 'vk-import' })

  let phase: ImportPhase = options.supported ? 'idle' : 'unsupported'
  let progress: ImportProgress = { done: 0, total: 0, what: '' }
  let summary: ImportSummary | null = null
  let failure = ''

  function render(): void {
    clear(element)
    element.append(label(strings.title, { heading: 2, size: 'large' }))

    if (phase === 'unsupported') {
      element.append(label(strings.unsupported, { class: 'vk-import__note' }))
      if (options.onCancel !== undefined) {
        element.append(button(strings.cancel, { onPress: options.onCancel }))
      }
      return
    }

    if (phase === 'idle' || phase === 'failed') {
      element.append(label(strings.explain))
      // Said before the picker opens, not after: by then the choice is made.
      element.append(label(strings.privacy, { class: 'vk-import__privacy' }))
      if (phase === 'failed') {
        element.append(label(strings.failed, { class: 'vk-import__error' }))
        if (failure.length > 0) {
          element.append(label(rawText(failure), { class: 'vk-import__error' }))
        }
      }
      const actions = el('div', { class: 'vk-import__actions', attrs: { role: 'group' } })
      actions.append(
        button(phase === 'failed' ? strings.retry : strings.choose, {
          onPress: () => void run(),
          variant: 'primary',
          size: 'medium',
        }),
      )
      if (options.onCancel !== undefined) {
        actions.append(button(strings.cancel, { onPress: options.onCancel }))
      }
      element.append(actions)
      return
    }

    if (phase === 'importing') {
      const bar = el('progress', { class: 'vk-import__progress' })
      if (progress.total > 0) {
        bar.max = progress.total
        bar.value = progress.done
      }
      element.append(bar)
      element.append(
        label(
          rawText(
            progress.total > 0
              ? `${progress.done} of ${progress.total} — ${progress.what}`
              : progress.what,
          ),
          { attrs: { 'aria-live': 'polite' } } as never,
        ),
      )
      return
    }

    if (summary !== null) {
      element.append(label(strings.finished, { heading: 3 }))
      const list = el('dl', { class: 'vk-import__summary' })
      const row = (name: string, value: string): void => {
        list.append(el('dt', { text: name }))
        list.append(el('dd', { text: value }))
      }
      row('Images', String(summary.textures))
      row('Sounds', String(summary.audio))
      row('Text', String(summary.text))
      row('Stored', format(summary.bytesWritten))
      if (summary.skipped > 0) row('Skipped', String(summary.skipped))
      element.append(list)
      if (options.onCancel !== undefined) {
        element.append(button(strings.cancel, { onPress: options.onCancel }))
      }
    }
  }

  async function run(): Promise<void> {
    phase = 'importing'
    progress = { done: 0, total: 0, what: '' }
    render()
    try {
      summary = await options.onImport((next) => {
        progress = next
        // Re-rendering per asset would be thousands of layouts; the bar is
        // updated in place and the whole screen only when the phase changes.
        updateProgress()
      })
      phase = 'done'
      options.onDone?.(summary)
    } catch (error) {
      // A cancelled picker is not a failure worth shouting about, but it does
      // return the player to where they can try again.
      phase = 'failed'
      failure = error instanceof Error ? error.message : ''
    }
    render()
  }

  function updateProgress(): void {
    const bar = element.querySelector('progress')
    if (bar === null) return
    if (progress.total > 0) {
      bar.max = progress.total
      bar.value = progress.done
    }
    const status = element.querySelector('.vk-text')
    if (status !== null) {
      status.textContent =
        progress.total > 0
          ? `${progress.done} of ${progress.total} — ${progress.what}`
          : progress.what
    }
  }

  render()
  return { element, phase: () => phase }
}
