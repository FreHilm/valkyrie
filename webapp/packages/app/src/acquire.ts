/**
 * Getting a scenario onto the device.
 *
 * The Unity app downloads a `.valkyrie` package, extracts it beside the others
 * and rescans. The same three steps here, over the virtual filesystem, with the
 * differences a browser forces:
 *
 * - a download can be interrupted and resumed, because a phone on a train will
 *   interrupt it;
 * - extraction refuses any entry that would land outside its target, in every
 *   mode rather than only the one the C# checks;
 * - a half-extracted package is removed rather than left to look installed.
 */

import { extract, ExtractMode } from '@valkyrie/platform'
import type { FileSystem, HttpClient } from '@valkyrie/platform'

export interface AcquireOptions {
  fs: FileSystem
  http: HttpClient
  /** Root the scenario directory is created under. */
  questRoot: string
  /** Fraction between 0 and 1, bytes received, and total when known. */
  onProgress?: (fraction: number, received: number, total: number | null) => void
  signal?: AbortSignal
}

export interface AcquiredQuest {
  /** Directory the package was extracted into. */
  path: string
  id: string
  files: number
  bytes: number
}

/** A scenario package's own name, without the extension or any path. */
export function questIdFromUrl(url: string): string {
  const last = url.split('?')[0]?.split('#')[0]?.split('/').pop() ?? ''
  const name = decodeURIComponent(last)
  return name.endsWith('.valkyrie') ? name.slice(0, -'.valkyrie'.length) : name
}

/**
 * Downloads a scenario package and extracts it.
 *
 * The whole package is read into memory before extraction: a scenario is a few
 * hundred kilobytes, and streaming would buy nothing but complexity here — the
 * streaming path exists for content packs, which are hundreds of megabytes.
 */
export async function acquireQuest(url: string, options: AcquireOptions): Promise<AcquiredQuest> {
  const id = questIdFromUrl(url)
  if (id.length === 0) throw new Error(`Not a scenario package: ${url}`)

  const target = `${options.questRoot}/${id}`
  const bytes = await download(url, options)

  // A directory left from a previous attempt would blend old files into the
  // new package, which reads as a corrupt scenario rather than a failed
  // download.
  await options.fs.remove(target)

  try {
    const result = await extract(options.fs, bytes, target, ExtractMode.FULL)
    if (result.written.length === 0) {
      throw new Error('The package is empty')
    }
    if (result.blocked.length > 0) {
      // The guard did its job, but a package trying to escape its directory is
      // not one to install.
      throw new Error(
        `The package tried to write outside its own folder: ${result.blocked.join(', ')}`,
      )
    }
    if (!(await options.fs.exists(`${target}/quest.ini`))) {
      throw new Error('The package holds no quest.ini')
    }
    return { path: target, id, files: result.written.length, bytes: bytes.byteLength }
  } catch (error) {
    // Half a scenario on disk looks installed and fails later, somewhere less
    // obviously connected to the download.
    await options.fs.remove(target)
    throw error
  }
}

async function download(url: string, options: AcquireOptions): Promise<Uint8Array> {
  return options.http.getBytes(url, {
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
  })
}
