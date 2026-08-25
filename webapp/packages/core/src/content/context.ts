import { Localization, defaultLocalization } from '../i18n/Localization.js'

/**
 * The host-provided values that content parsing reaches for.
 *
 * In the Unity code these are static calls scattered through the data classes:
 * `ContentData.ResolveTextureFile` (File.Exists), `ContentData.ImportPath()`
 * (Game.AppData + game type), `Game.Get().gameType.TilePixelPerSquare()` and
 * `Application.platform == RuntimePlatform.Android`. Parsing a content pack
 * therefore needed a live Game and a real filesystem.
 *
 * Collecting them here keeps the content model itself host-free and testable.
 */

export interface ContentContext {
  /**
   * Registry used when parsing a `{dict:KEY}` value into a StringKey. Content
   * names resolve against whichever dictionaries are registered *at parse
   * time*, so this is load-order sensitive — as it is in the C#, where it is
   * the `LocalizationRead` global.
   */
  localization: Localization

  /**
   * Resolves an asset name to an existing file, trying the known texture
   * extensions. Returns null when nothing matches.
   *
   * Port of `ContentData.ResolveTextureFile`. The extension list and its order
   * are part of the contract, so implementations should use
   * {@link TEXTURE_EXTENSIONS}.
   */
  resolveTextureFile(name: string): string | null

  /** Where FFG-imported assets live. Port of `ContentData.ImportPath()`. */
  importPath: string

  /** Pixels per one-inch board square. D2E is 105; MoM computes from tile size. */
  tilePixelPerSquare: number

  /** Whether to prefer the `x_android` / `y_android` token offsets. */
  isAndroid: boolean
}

/** Extensions probed by `resolveTextureFile`, in the C#'s order. */
export const TEXTURE_EXTENSIONS = ['.dds', '.pvr', '.png', '.jpg', '.jpeg', '.tex'] as const

/**
 * What a web resolver should actually try.
 *
 * The port's importer writes WebP — a browser decodes it natively, where `.dds`
 * would have to be decoded in JavaScript on every load. Nothing in the C# list
 * mentions it, so a resolver using {@link TEXTURE_EXTENSIONS} alone finds none
 * of the imported art: measured against the real Mansions packs, 869 of 999
 * texture lookups resolve only as `.webp`.
 *
 * `TEXTURE_EXTENSIONS` stays exactly as the C# has it — it is the contract the
 * content differential checks — and this list extends it rather than replacing
 * it, so content shipped as `.png` in the repository still resolves.
 */
export const WEB_TEXTURE_EXTENSIONS = ['.webp', ...TEXTURE_EXTENSIONS] as const

/**
 * `GameType.TilePixelPerSquare()`, which a tile side falls back to when it
 * declares no `pps` of its own.
 *
 * Descent tiles were imported at 105 pixels per inch; a Mansions tile is 1024
 * pixels across 3.5 inches. Getting this wrong does not fail loudly — the tile
 * lands in the wrong place, or with a zero here, nowhere at all.
 */
export const TILE_PIXELS_PER_SQUARE = {
  D2E: 105,
  /** Halved on Android in the C#, where texture memory is the constraint. */
  MoM: 1024 / 3.5,
  MoMAndroid: 512 / 3.5,
} as const

/**
 * The C# builds content paths two different ways, and the difference is
 * observable, so both are modelled rather than collapsed into one helper.
 *
 * DEVIATION common to both: the C# uses `Path.DirectorySeparatorChar`, so
 * stored paths are '\' separated on Windows and '/' elsewhere — the same
 * content pack yields different strings depending on the build host. A single
 * web artifact serving every platform cannot do that, so the port always
 * uses '/'.
 */

/**
 * `Path.Combine(a, b)`: an empty `b` yields `a` unchanged, a rooted `b`
 * replaces `a`, and otherwise a single separator is inserted.
 *
 * Used by `GenericData`'s image resolution.
 */
export function combinePath(a: string, b: string): string {
  if (b.length === 0) return a
  if (b.startsWith('/')) return b
  if (a.length === 0) return b
  return a.endsWith('/') ? a + b : `${a}/${b}`
}

/**
 * `a + Path.DirectorySeparatorChar + b`: a separator is *always* inserted,
 * even when `b` is empty — so a pack with no `image` key stores a path ending
 * in a slash. Used by the content pack fields, `imageplace` and `file`.
 */
export function concatPath(a: string, b: string): string {
  return `${a}/${b}`
}

/** A context with no filesystem, for parsing content without resolving images. */
export function headlessContext(overrides: Partial<ContentContext> = {}): ContentContext {
  return {
    localization: defaultLocalization,
    resolveTextureFile: () => null,
    importPath: '',
    tilePixelPerSquare: 0,
    isAndroid: false,
    ...overrides,
  }
}
