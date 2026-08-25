/**
 * A breadcrumb that survives the tab dying.
 *
 * A renderer crash — Chrome's broken-page icon — takes the console with it, so
 * an error that only happens in a real browser leaves nothing behind to read.
 * Each step is written to `sessionStorage`, which survives the crash and the
 * reload that follows, so the next page load can say how far it got.
 *
 * This exists because the alternative is guessing, and guessing has cost
 * several rounds already.
 */

const KEY = 'valkyrie.lastStage'

export interface Stage {
  what: string
  at: number
  detail?: string
}

/** Records a step. Cheap enough to call often. */
export function stage(what: string, detail?: string): void {
  try {
    const entry: Stage = { what, at: Date.now(), ...(detail === undefined ? {} : { detail }) }
    sessionStorage.setItem(KEY, JSON.stringify(entry))
  } catch {
    // Private windows and disabled storage: a breadcrumb is not worth failing
    // over.
  }
}

/** Marks a run as finished, so a clean exit is not reported as a crash. */
export function clearStage(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* as above */
  }
}

/** The step a previous run died on, if it did not finish. */
export function lastStage(): Stage | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (raw === null) return null
    return JSON.parse(raw) as Stage
  } catch {
    return null
  }
}
