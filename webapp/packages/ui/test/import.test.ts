/**
 * @vitest-environment happy-dom
 *
 * Tests for the import screen (T-018).
 *
 * The Unity app guesses at well-known install paths and imports silently on
 * first run. A browser cannot look at the disk, so the player has to hand over
 * a folder — and the screen's real job is explaining what is being asked for
 * before the picker opens, which is the only moment the explanation is useful.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { importScreen } from '../src/screens/import.js'
import type { ImportSummary } from '../src/screens/import.js'

beforeEach(() => {
  document.body.replaceChildren()
})

const SUMMARY: ImportSummary = {
  textures: 1146,
  audio: 592,
  text: 671,
  bytesWritten: 413_000_000,
  skipped: 2,
}

function make(over: Partial<Parameters<typeof importScreen>[0]> = {}) {
  const screen = importScreen({
    supported: true,
    onImport: async () => SUMMARY,
    ...over,
  })
  document.body.append(screen.element)
  return screen
}

const buttons = (root: HTMLElement): HTMLButtonElement[] => [...root.querySelectorAll('button')]
const press = (root: HTMLElement, name: string): void => {
  const target = buttons(root).find((b) => b.textContent?.includes(name))
  if (target === undefined) throw new Error(`no button matching ${name}`)
  target.click()
}

describe('importScreen', () => {
  it('says where the files go before the picker opens', () => {
    // After the choice is made the explanation is worthless.
    const screen = make()

    expect(screen.element.textContent).toContain('stay in this browser on this device')
    expect(screen.element.textContent).toContain('Nothing is uploaded')
  })

  it('says what it needs and why', () => {
    const screen = make()

    expect(screen.element.textContent).toContain('a copy of the game you own')
  })

  it('names the browsers that can do this when one cannot', () => {
    // "Nothing happens" is the worst possible answer to a button press.
    const screen = make({ supported: false })

    expect(screen.phase()).toBe('unsupported')
    expect(screen.element.textContent).toContain('Chrome, Edge and Opera')
    expect(buttons(screen.element).map((b) => b.textContent)).not.toContain('Import')
  })

  it('runs the import and reports what was stored', async () => {
    const screen = make({ formatBytes: () => '413 MB' })
    press(screen.element, 'Import')
    await vi.waitFor(() => expect(screen.phase()).toBe('done'))

    expect(screen.element.textContent).toContain('1146')
    expect(screen.element.textContent).toContain('413 MB')
    expect(screen.element.textContent).toContain('Import finished')
  })

  it('mentions skipped assets rather than quietly losing them', async () => {
    const screen = make()
    press(screen.element, 'Import')
    await vi.waitFor(() => expect(screen.phase()).toBe('done'))

    expect(screen.element.textContent).toContain('Skipped')
  })

  it('omits the skipped row when nothing was skipped', async () => {
    const screen = make({ onImport: async () => ({ ...SUMMARY, skipped: 0 }) })
    press(screen.element, 'Import')
    await vi.waitFor(() => expect(screen.phase()).toBe('done'))

    expect(screen.element.textContent).not.toContain('Skipped')
  })

  it('shows progress while it runs', async () => {
    let report: ((p: { done: number; total: number; what: string }) => void) | null = null
    const screen = make({
      onImport: (r) => {
        report = r
        return new Promise(() => {
          /* never settles: the screen stays mid-import */
        })
      },
    })
    press(screen.element, 'Import')

    expect(screen.phase()).toBe('importing')
    report?.({ done: 3, total: 10, what: 'Tile_Foyer' })
    expect(screen.element.querySelector('progress')?.value).toBe(3)
    expect(screen.element.textContent).toContain('Tile_Foyer')
  })

  it('offers another go when the import fails', async () => {
    const screen = make({
      onImport: () => Promise.reject(new Error('The folder is not a game data folder')),
    })
    press(screen.element, 'Import')
    await vi.waitFor(() => expect(screen.phase()).toBe('failed'))

    expect(screen.element.textContent).toContain('not a game data folder')
    expect(buttons(screen.element).map((b) => b.textContent)).toContain('Try again')
  })

  it('treats a cancelled picker as something to retry, not an error to dwell on', async () => {
    const screen = make({ onImport: () => Promise.reject(new Error('')) })
    press(screen.element, 'Import')
    await vi.waitFor(() => expect(screen.phase()).toBe('failed'))

    expect(buttons(screen.element).map((b) => b.textContent)).toContain('Try again')
  })

  it('reports the summary to the caller', async () => {
    const onDone = vi.fn()
    const screen = make({ onDone })
    press(screen.element, 'Import')
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledWith(SUMMARY))
  })
})

describe('choosing folders', () => {
  it('needs at least one folder before it will import', () => {
    const screen = importScreen({
      supported: true,
      onPickFolder: async () => 'Data',
      onImport: async () => SUMMARY,
    })
    document.body.append(screen.element)

    expect(buttons(screen.element).find((b) => b.textContent === 'Import')?.disabled).toBe(true)
  })

  it('lists what has been handed over', async () => {
    const screen = importScreen({
      supported: true,
      onPickFolder: async () => 'Data',
      onImport: async () => SUMMARY,
    })
    document.body.append(screen.element)
    press(screen.element, 'Add a folder')
    await vi.waitFor(() => expect(screen.element.textContent).toContain('Folders to read'))

    expect(screen.element.textContent).toContain('Data')
  })

  it('warns while only the install has been chosen', async () => {
    // Said while it can still be acted on. Recent builds download most of the
    // board art on first run, so the install alone loses about a third of the
    // textures — and the import reports success either way.
    const screen = importScreen({
      supported: true,
      onPickFolder: async () => 'Data',
      onImport: async () => SUMMARY,
    })
    document.body.append(screen.element)
    press(screen.element, 'Add a folder')
    await vi.waitFor(() => expect(screen.element.textContent).toContain('a third of the artwork'))
  })

  it('stops warning once a second folder is added', async () => {
    let next = 'Data'
    const screen = importScreen({
      supported: true,
      onPickFolder: async () => next,
      onImport: async () => SUMMARY,
    })
    document.body.append(screen.element)
    press(screen.element, 'Add a folder')
    await vi.waitFor(() => expect(screen.element.textContent).toContain('a third of the artwork'))
    next = 'cache'
    press(screen.element, 'Add a folder')
    await vi.waitFor(() =>
      expect(screen.element.textContent).not.toContain('a third of the artwork'),
    )
  })

  it('treats a cancelled picker as adding nothing', async () => {
    const screen = importScreen({
      supported: true,
      onPickFolder: async () => null,
      onImport: async () => SUMMARY,
    })
    document.body.append(screen.element)
    press(screen.element, 'Add a folder')
    await vi.waitFor(() =>
      expect(buttons(screen.element).find((b) => b.textContent === 'Import')?.disabled).toBe(true),
    )
  })
})
