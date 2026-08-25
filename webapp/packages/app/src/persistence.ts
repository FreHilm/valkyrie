/**
 * Asking for persistent storage, and explaining why.
 *
 * Browsers grant this on a heuristic — engagement, installation, bookmarks —
 * and a bare `persist()` call at load time is usually refused. Asking at the
 * moment the user is about to spend hundreds of megabytes, and saying what it
 * is for, is both more honest and more likely to succeed.
 */

export interface PersistenceState {
  /** Whether the browser has already agreed to keep this origin's data. */
  persisted: boolean
  /** Whether the API exists at all; several browsers do not have it. */
  supported: boolean
}

export interface StorageManagerLike {
  persist?: () => Promise<boolean>
  persisted?: () => Promise<boolean>
}

export async function persistenceState(
  storage: StorageManagerLike | undefined,
): Promise<PersistenceState> {
  if (storage?.persisted === undefined) return { persisted: false, supported: false }
  return { persisted: await storage.persisted(), supported: storage.persist !== undefined }
}

/**
 * Requests persistence, if it is not already granted.
 *
 * Returns what actually happened rather than a bare boolean, because "already
 * had it", "just granted" and "refused" call for three different things to
 * say to the user.
 */
export async function requestPersistence(
  storage: StorageManagerLike | undefined,
): Promise<'granted' | 'already' | 'refused' | 'unsupported'> {
  const state = await persistenceState(storage)
  if (!state.supported) return 'unsupported'
  if (state.persisted) return 'already'

  const granted = (await storage?.persist?.()) ?? false
  return granted ? 'granted' : 'refused'
}

/**
 * What to tell the user, in their terms rather than the API's.
 *
 * A refusal is not an error and should not read like one — the import still
 * works, it is just at more risk, and most browsers grant persistence later
 * once the app has been used a few times or installed.
 */
export function persistenceMessage(result: Awaited<ReturnType<typeof requestPersistence>>): string {
  switch (result) {
    case 'granted':
      return 'Your imported content will be kept even when storage runs low.'
    case 'already':
      return 'Your imported content is already protected from being cleared.'
    case 'refused':
      return (
        'This browser has not agreed to keep your imported content yet. ' +
        'It usually will once the app has been used a few times, or if you install it. ' +
        'Until then, a low-storage situation could clear the import and you would need to run it again.'
      )
    case 'unsupported':
      return (
        'This browser cannot promise to keep imported content. ' +
        'If storage runs low it may be cleared, and the import would need running again.'
      )
  }
}
