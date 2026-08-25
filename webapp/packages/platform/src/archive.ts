/**
 * Port of `unity/Assets/Scripts/ZipManager.cs`.
 *
 * Extracts `.valkyrie` packages and content packs, which arrive as ordinary
 * zip archives downloaded from other people's GitHub repositories. That is
 * untrusted input, so the path-traversal guard is the point of this module
 * rather than an afterthought.
 *
 * Two defects in the C# are fixed rather than reproduced — see
 * `docs/archive-port-deviations.md`.
 */

import { AsyncUnzipInflate, Unzip, unzip, unzipSync } from 'fflate'
import type { UnzipFile } from 'fflate'

import type { FileSystem } from './filesystem.js'
import { basename, combine, isInside, normalise, resolve } from './path.js'
import { log } from '@valkyrie/core'

/** Which entries an extraction takes. Mirrors `ZipManager.Extract_mode`. */
export const ExtractMode = {
  /** Everything. Used before starting a quest. */
  FULL: 'FULL',
  /** `quest.ini` and localization, enough to list a quest. */
  INI_TXT: 'INI_TXT',
  /** The above plus the quest's cover image. */
  INI_TXT_PIC: 'INI_TXT_PIC',
  /** A save: `save.ini`, `image.png`, and the quest it refers to. */
  SAVE_INI_PIC: 'SAVE_INI_PIC',
} as const

export type ExtractMode = (typeof ExtractMode)[keyof typeof ExtractMode]

export interface ArchiveEntry {
  /** Path within the archive, as stored. */
  name: string
  data: Uint8Array
}

export interface ExtractResult {
  written: string[]
  /** Entries refused because they resolved outside the target directory. */
  blocked: string[]
  /** Entries the mode's selectors did not ask for. */
  skipped: number
}

export interface ExtractOptions {
  /** Reports progress as a fraction between 0 and 1. */
  onProgress?: (fraction: number, entryName: string) => void
  /**
   * Archive size in bytes. `extractStream` needs it to report a fraction —
   * reading forwards, it cannot know how much is left otherwise. Take it from
   * a `Content-Length` header or `File.size`.
   */
  totalBytes?: number
  /** Reads `quest.ini` to find the cover image, for INI_TXT_PIC. */
  readQuestImage?: (extracted: FileSystem, targetPath: string) => Promise<string | null>
}

/**
 * Translates a DotNetZip `name = pattern` selector.
 *
 * The C# uses four shapes: an exact name (`quest.ini`), a leading wildcard
 * (`*quest.ini`, which the comment notes is required on Android), an
 * embedded wildcard (`Localization.*.txt`), and a quoted literal for the
 * image. `*` matches any run of characters including separators, as
 * DotNetZip's does.
 */
function selectorToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`)
}

/**
 * Whether an entry matches a selector.
 *
 * DotNetZip's `name` selector matches the *file name* when the pattern has no
 * separator, and the whole stored path when it does — which is why
 * `name = quest.ini` finds a root-level file and `name = *quest.ini` finds a
 * nested one.
 */
function matches(entryName: string, pattern: string): boolean {
  const regex = selectorToRegExp(pattern)
  if (regex.test(entryName)) return true
  if (!pattern.includes('/') && !pattern.includes('*')) {
    const base = entryName.slice(entryName.lastIndexOf('/') + 1)
    return regex.test(base)
  }
  return false
}

const SELECTORS: Record<ExtractMode, string[]> = {
  FULL: ['*'],
  INI_TXT: ['quest.ini', 'Localization.*.txt'],
  INI_TXT_PIC: ['quest.ini', 'Localization.*.txt'],
  SAVE_INI_PIC: ['save.ini', 'image.png', '*quest.ini', '*Localization.*.txt'],
}

/**
 * Whether writing `entryName` under `targetPath` stays inside it.
 *
 * DEVIATION: the C# applies this only to `ZIPMANAGER_EXTRACT_FULL`. The
 * selective modes call `ExtractSelectedEntries` with no destination check at
 * all, so an entry named `../../quest.ini` matches `name = *quest.ini` and is
 * written outside the target. The port guards every mode.
 */
export function destinationInside(targetPath: string, entryName: string): boolean {
  const base = resolve(normalise(targetPath))
  const destination = resolve(combine(base, normalise(entryName)))
  return isInside(base, destination)
}

/** Reads every entry of a zip. Synchronous; use `readArchive` off the main thread. */
export function readArchiveSync(archive: Uint8Array): ArchiveEntry[] {
  const files = unzipSync(archive)
  return Object.entries(files).map(([name, data]) => ({ name, data }))
}

/** Reads every entry of a zip without blocking the caller. */
export function readArchive(archive: Uint8Array): Promise<ArchiveEntry[]> {
  return new Promise((resolveArchive, reject) => {
    unzip(archive, (error, files) => {
      if (error) {
        reject(error)
        return
      }
      resolveArchive(Object.entries(files).map(([name, data]) => ({ name, data })))
    })
  })
}

/**
 * Extracts an archive into `targetPath`.
 *
 * Entries whose destination would fall outside the target are refused and
 * reported, never written.
 */
export async function extract(
  fs: FileSystem,
  archive: Uint8Array,
  targetPath: string,
  mode: ExtractMode = ExtractMode.FULL,
  options: ExtractOptions = {},
): Promise<ExtractResult> {
  const entries = await readArchive(archive)
  return extractEntries(fs, entries, targetPath, mode, options)
}

/** The extraction itself, separated so tests can supply entries directly. */
export async function extractEntries(
  fs: FileSystem,
  entries: readonly ArchiveEntry[],
  targetPath: string,
  mode: ExtractMode = ExtractMode.FULL,
  options: ExtractOptions = {},
): Promise<ExtractResult> {
  await fs.createDirectory(targetPath)

  const selectors = SELECTORS[mode]
  const written: string[] = []
  const blocked: string[] = []
  let skipped = 0

  let index = 0
  for (const entry of entries) {
    index++
    options.onProgress?.(index / entries.length, entry.name)

    // A directory entry carries no data and needs no write.
    if (entry.name.endsWith('/')) continue

    if (!selectors.some((selector) => matches(entry.name, selector))) {
      skipped++
      continue
    }

    if (!destinationInside(targetPath, entry.name)) {
      log(`Warning: Path traversal attempt blocked for entry: ${entry.name}`)
      blocked.push(entry.name)
      continue
    }

    const destination = combine(targetPath, normalise(entry.name))
    await fs.writeBytes(destination, entry.data)
    written.push(destination)
  }

  // INI_TXT_PIC additionally takes the one image quest.ini names, which is
  // only knowable after quest.ini has been written — the same two-pass shape
  // the C# uses between its two ExtractSelectedEntries calls.
  if (mode === ExtractMode.INI_TXT_PIC) {
    const read = options.readQuestImage ?? questImageFromIni
    const image = await read(fs, targetPath)

    if (image !== null && image.length > 0) {
      for (const entry of entries) {
        if (entry.name.endsWith('/') || !matches(entry.name, image)) continue

        if (!destinationInside(targetPath, entry.name)) {
          log(`Warning: Path traversal attempt blocked for entry: ${entry.name}`)
          blocked.push(entry.name)
          continue
        }
        const destination = combine(targetPath, normalise(entry.name))
        await fs.writeBytes(destination, entry.data)
        written.push(destination)
        skipped--
      }
    }
  }

  return { written, blocked, skipped }
}

/**
 * Reads the `image` value out of an already-extracted `quest.ini`.
 *
 * The default for `ExtractOptions.readQuestImage`, matching what the C# does
 * between its two `ExtractSelectedEntries` calls.
 */
export async function questImageFromIni(
  fs: FileSystem,
  targetPath: string,
): Promise<string | null> {
  const path = combine(targetPath, 'quest.ini')
  if (!(await fs.exists(path))) return null

  let inQuestSection = false
  for (const raw of await fs.readLines(path)) {
    const line = raw.trim()
    if (line.startsWith('[')) {
      inQuestSection = line.replace(/^\[|\]$/g, '') === 'Quest'
      continue
    }
    if (!inQuestSection) continue
    const at = line.indexOf('=')
    if (at === -1) continue
    if (line.slice(0, at).trim() === 'image') return line.slice(at + 1).trim()
  }
  return null
}

/** Extensions `INI_TXT_PIC` may need to hold back — see `extractStream`. */
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg']

const isImageName = (name: string): boolean =>
  IMAGE_EXTENSIONS.some((extension) => name.toLowerCase().endsWith(extension))

/**
 * Extracts an archive as its bytes arrive, without ever holding all of it.
 *
 * `extract` needs the whole archive resident, which is fine for a quest but
 * not for a content pack of several hundred megabytes on a phone. This
 * consumes a stream of chunks — a `fetch` body or a `File.stream()` — and
 * writes each entry as it completes, so peak memory is one entry rather than
 * the whole archive. Entries the mode does not want are never decompressed.
 *
 * One caveat, inherent to reading a zip forwards: `INI_TXT_PIC` cannot know
 * which image it wants until it has seen `quest.ini`. Images encountered
 * before it are held in memory until then and dropped once the name is known,
 * so the bound is "images preceding quest.ini", not the archive.
 */
export async function extractStream(
  fs: FileSystem,
  chunks: AsyncIterable<Uint8Array>,
  targetPath: string,
  mode: ExtractMode = ExtractMode.FULL,
  options: ExtractOptions = {},
): Promise<ExtractResult> {
  await fs.createDirectory(targetPath)

  const selectors = SELECTORS[mode]
  const written: string[] = []
  const blocked: string[] = []
  let skipped = 0

  // Resolved once quest.ini has been written, for INI_TXT_PIC.
  let wantedImage: string | null = null
  const heldImages = new Map<string, Uint8Array>()
  const pending: Promise<void>[] = []

  const write = async (name: string, data: Uint8Array): Promise<void> => {
    if (!destinationInside(targetPath, name)) {
      log(`Warning: Path traversal attempt blocked for entry: ${name}`)
      blocked.push(name)
      return
    }
    const destination = combine(targetPath, normalise(name))
    await fs.writeBytes(destination, data)
    written.push(destination)
  }

  const collect = (file: UnzipFile): Promise<Uint8Array> =>
    new Promise((resolveFile, reject) => {
      const parts: Uint8Array[] = []
      let total = 0

      file.ondata = (error, data, final) => {
        if (error) {
          reject(error)
          return
        }
        parts.push(data)
        total += data.length
        if (!final) return

        const joined = new Uint8Array(total)
        let at = 0
        for (const part of parts) {
          joined.set(part, at)
          at += part.length
        }
        resolveFile(joined)
      }
      file.start()
    })

  const unzipper = new Unzip()
  unzipper.register(AsyncUnzipInflate)

  unzipper.onfile = (file) => {
    const name = file.name
    if (name.endsWith('/')) return

    const selected = selectors.some((selector) => matches(name, selector))
    const holdForImage = mode === ExtractMode.INI_TXT_PIC && !selected && isImageName(name)

    if (!selected && !holdForImage) {
      skipped++
      return
    }

    pending.push(
      collect(file).then(async (data) => {
        if (holdForImage) {
          if (wantedImage !== null && matches(name, wantedImage)) await write(name, data)
          else heldImages.set(name, data)
          return
        }

        await write(name, data)

        // Learning the image name may release something already held.
        if (mode === ExtractMode.INI_TXT_PIC && basename(name) === 'quest.ini') {
          wantedImage = await (options.readQuestImage ?? questImageFromIni)(fs, targetPath)
          if (wantedImage !== null && wantedImage.length > 0) {
            for (const [held, bytes] of heldImages) {
              if (matches(held, wantedImage)) await write(held, bytes)
            }
          }
          heldImages.clear()
        }
      }),
    )
  }

  // Progress tracks bytes consumed, not entries: reading forwards, the entry
  // count is not known until the end.
  const total = options.totalBytes ?? 0
  let consumed = 0

  // fflate's streaming reader ignores bytes it does not recognise, so a
  // truncated or corrupt download would otherwise extract nothing and report
  // success. The leading signature is checked instead.
  const header = new Uint8Array(4)
  let headerLength = 0

  for await (const chunk of chunks) {
    if (headerLength < 4) {
      const take = Math.min(4 - headerLength, chunk.length)
      header.set(chunk.subarray(0, take), headerLength)
      headerLength += take
      if (headerLength === 4) assertZipSignature(header)
    }
    unzipper.push(chunk, false)
    consumed += chunk.length
    if (total > 0) options.onProgress?.(Math.min(consumed / total, 1), '')
  }
  if (headerLength < 4) throw new Error('Not a zip archive: truncated')
  unzipper.push(new Uint8Array(0), true)

  await Promise.all(pending)
  skipped += heldImages.size
  options.onProgress?.(1, '')

  return { written, blocked, skipped }
}

/**
 * Rejects anything that does not open with a PKZIP record.
 *
 * `PK\x03\x04` is a local file header, `PK\x05\x06` an end-of-central-
 * directory (a legitimately empty archive) and `PK\x07\x08` a spanned
 * archive marker.
 */
function assertZipSignature(header: Uint8Array): void {
  const third = header[2]
  const fourth = header[3]
  const known =
    header[0] === 0x50 &&
    header[1] === 0x4b &&
    ((third === 3 && fourth === 4) ||
      (third === 5 && fourth === 6) ||
      (third === 7 && fourth === 8))

  if (!known) throw new Error('Not a zip archive')
}
