/**
 * The game's own font, loaded from the player's import.
 *
 * Quest prose writes its icons as markers — `{action}`, `{shield}` — and
 * `outputSymbolReplace` rewrites each into a codepoint in the private-use range
 * `U+F200`–`F20F`. Nothing on a normal system draws those, so without the
 * game's face "spend 1 {action}" arrives with a blank box where the icon
 * belongs: not a styling difference, but a missing word.
 *
 * The face is `MADGaramondPro`, which `MoMGameType.GetFont` hands to every
 * piece of text in the Unity build. It is a commercial font and does not ship
 * with the port. It does not need to: the player's own install embeds it, the
 * importer now writes it out beside the art and the audio, and this loads it
 * from there. Their copy, on their device — the same bargain the rest of the
 * imported content is on.
 *
 * When there is no import, or the import predates fonts being extracted, this
 * reports failure and the caller falls back to setting each symbol as its own
 * name. That path stays legible; it is just not what the game looks like.
 */

import type { FileSystem, StoragePaths } from '@valkyrie/platform'
import { combine } from '@valkyrie/platform'

/** The CSS family the stylesheet points `--vk-symbol-font` at. */
export const SYMBOL_FAMILY = 'Valkyrie Symbols'

/**
 * The range the icons live in.
 *
 * Declared so the browser only consults this face for the icons: the same file
 * carries a full set of letterforms, and without this it would quietly become
 * the page's text font wherever the family is named.
 */
export const SYMBOL_RANGE = 'U+F200-F20F'

/**
 * The faces worth trying, best first.
 *
 * Only `MADGaramondPro` carries the range — the other five fonts in a Mansions
 * install do not — but the name it is imported under depends on the install, so
 * a couple of spellings are tried before giving up.
 */
const CANDIDATES = ['MADGaramondPro.ttf', 'MADGaramondPro.otf', 'MAD Garamond Pro.ttf']

export interface SymbolFontOptions {
  fs: FileSystem
  paths: StoragePaths
  /** Injected for tests; defaults to the document's font set. */
  fonts?: FontFaceSet
  /** Injected for tests; defaults to the platform `FontFace`. */
  construct?: (family: string, source: BufferSource, descriptors: FontFaceDescriptors) => FontFace
}

/**
 * Loads the symbol font, and says whether the icons can now be drawn.
 *
 * Never throws: a missing import is the ordinary case on a first run, and a
 * font that will not parse is a broken import rather than a broken app. Either
 * way the answer is the same — false, and the caller shows names instead.
 */
export async function loadSymbolFont(options: SymbolFontOptions): Promise<boolean> {
  const fontsPath = combine(options.paths.importPath, 'fonts')

  for (const candidate of CANDIDATES) {
    let bytes: Uint8Array
    try {
      bytes = await options.fs.readBytes(combine(fontsPath, candidate))
    } catch {
      continue
    }

    try {
      const construct =
        options.construct ??
        ((family, source, descriptors) => new FontFace(family, source, descriptors))
      const face = construct(SYMBOL_FAMILY, bytes as unknown as BufferSource, {
        unicodeRange: SYMBOL_RANGE,
        // These are icons standing in for words: better a moment of nothing
        // than a flash of a blank box that is then replaced.
        display: 'block',
      })
      await face.load()
      ;(options.fonts ?? document.fonts).add(face)
      return true
    } catch {
      // A file that is there but will not parse is worth trying the next name
      // for rather than failing outright.
      continue
    }
  }

  return false
}
