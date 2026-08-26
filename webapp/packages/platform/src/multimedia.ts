/**
 * Port of `Quest.FindLocalisedMultimediaFile` (`unity/Assets/Scripts/Quest/Quest.cs:150`).
 *
 * Resolves an image or audio file named in a quest's ini to its localised
 * variant, if the scenario ships one. Two layouts are supported, and both are
 * in use in published scenarios: a language folder at the scenario root
 * (`<source>/German/map.png`) and one inside the asset's own subfolder
 * (`<source>/image/German/map.png`).
 *
 * Resolution needs a filesystem, which is why it lives here rather than in
 * `@valkyrie/core` alongside the rest of the quest model.
 */

import { combine, basename, dirname } from './path.js'
import type { FileSystem } from './filesystem.js'

export interface LocalisationContext {
  currentLang: string
  /** Empty, or equal to `currentLang`, disables the fallback pass. */
  fallbackLang: string | null
  /** The editor addresses the unlocalised originals. */
  editMode: boolean
}

/**
 * Returns the best existing localised path for `name` under `source`, or the
 * unlocalised path when nothing localised exists.
 *
 * The result is a path whether or not anything is there — the C# composes and
 * returns `source/name` unconditionally as its last step, and callers rely on
 * that to report the missing file themselves.
 */
export async function findLocalisedMultimediaFile(
  fs: FileSystem,
  name: string,
  source: string,
  context: LocalisationContext,
): Promise<string> {
  for (const candidate of localisedCandidates(name, source, context)) {
    if (await fs.exists(candidate)) return candidate
  }
  return combine(source, name)
}

/**
 * Every path the C# probes for `name`, in the order it probes them.
 *
 * Shared by both resolvers so the order cannot drift between them. The
 * unlocalised path is not included: it is what the C# returns having found
 * nothing, whether or not anything is there, so each caller appends it itself.
 */
function localisedCandidates(
  name: string,
  source: string,
  context: LocalisationContext,
): string[] {
  if (context.editMode) return []

  const directory = dirname(name)
  const file = basename(name)

  const forLanguage = (lang: string): string[] =>
    directory.length === 0
      ? [combine(source, lang, name)]
      : [combine(source, lang, name), combine(source, directory, lang, file)]

  const candidates = forLanguage(context.currentLang)

  const fallback = context.fallbackLang
  if (fallback !== null && fallback.length > 0 && fallback !== context.currentLang) {
    candidates.push(...forLanguage(fallback))
  }

  return candidates
}

/**
 * A synchronous {@link findLocalisedMultimediaFile} over a directory listing.
 *
 * A scenario's screen-space art is resolved while the scene is being built,
 * on every frame that changes it, which cannot await a filesystem. Listing the
 * scenario once up front is what makes an answer possible there at all — the
 * same trade `textureResolver` makes for content.
 *
 * Unlike the C#, this returns `null` rather than a composed path when nothing
 * exists: a caller that cannot open the file has nothing to do with a name.
 */
export async function questFileResolver(
  fs: FileSystem,
  source: string,
  context: LocalisationContext,
): Promise<(name: string) => string | null> {
  const files = new Set<string>()
  if (await fs.exists(source)) {
    for (const entry of await fs.list(source, { recursive: true })) {
      if (entry.kind === 'file') files.add(entry.path)
    }
  }

  return (name: string) => {
    if (name.length === 0) return null
    for (const candidate of localisedCandidates(name, source, context)) {
      if (files.has(candidate)) return candidate
    }
    const root = combine(source, name)
    return files.has(root) ? root : null
  }
}
