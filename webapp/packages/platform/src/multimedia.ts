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
  const root = combine(source, name)
  if (context.editMode) return root

  const directory = dirname(name)
  const file = basename(name)

  const candidates = (lang: string): string[] =>
    directory.length === 0
      ? [combine(source, lang, name)]
      : [combine(source, lang, name), combine(source, directory, lang, file)]

  for (const candidate of candidates(context.currentLang)) {
    if (await fs.exists(candidate)) return candidate
  }

  const fallback = context.fallbackLang
  if (fallback !== null && fallback.length > 0 && fallback !== context.currentLang) {
    for (const candidate of candidates(fallback)) {
      if (await fs.exists(candidate)) return candidate
    }
  }

  return root
}
