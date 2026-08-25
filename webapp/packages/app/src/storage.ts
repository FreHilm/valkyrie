/**
 * Storage reporting and reclamation.
 *
 * The risk this addresses is specific: a user with a several-hundred-megabyte
 * import losing it to browser eviction has lost an hour of setup, and will not
 * distinguish that from the app being broken. Persistent storage plus an
 * honest account of what is stored is the mitigation.
 */

import type { FileSystem, StorageEstimate, StoragePaths } from '@valkyrie/platform'

export interface StorageEntry {
  /** What this is, in the user's terms: a content pack, an import, saves. */
  id: string
  path: string
  bytes: number
  /** False for anything whose loss would cost the user real work. */
  removable: boolean
}

export interface StorageReport {
  estimate: StorageEstimate
  entries: StorageEntry[]
  /** Total of the entries, which can be less than usage — caches count too. */
  accountedBytes: number
}

/**
 * Bytes under a path, ignoring anything under `exclude`.
 *
 * The exclusion matters: content packs live *inside* the download directory,
 * so counting both without it reports those bytes twice and tells the user
 * they are using more space than they are.
 */
async function sizeOf(
  fs: FileSystem,
  path: string,
  exclude: readonly string[] = [],
): Promise<number> {
  if (!(await fs.exists(path))) return 0
  const listed = await fs.list(path, { recursive: true })

  return listed.reduce((sum, entry) => {
    if (entry.kind !== 'file') return sum
    if (exclude.some((prefix) => entry.path.startsWith(`${prefix}/`))) return sum
    return sum + entry.size
  }, 0)
}

/**
 * What is stored, and what can safely be removed.
 *
 * Imported FFG assets are marked removable even though re-importing is slow —
 * the user owns the source and can redo it. Saves are not: losing those is
 * losing progress with no way back.
 */
export async function storageReport(fs: FileSystem, paths: StoragePaths): Promise<StorageReport> {
  const candidates: {
    id: string
    path: string
    removable: boolean
    exclude?: readonly string[]
  }[] = [
    { id: 'import', path: paths.importPath, removable: true },
    { id: 'contentPacks', path: paths.customContentPackPath, removable: true },
    // Content packs sit under the download directory, so they are counted
    // once, under their own heading.
    {
      id: 'downloads',
      path: paths.downloadPath,
      removable: true,
      exclude: [paths.customContentPackPath],
    },
    { id: 'saves', path: `${paths.gameTypePath}/Save`, removable: false },
  ]

  const entries: StorageEntry[] = []
  for (const candidate of candidates) {
    const bytes = await sizeOf(fs, candidate.path, candidate.exclude ?? [])
    if (bytes > 0) {
      entries.push({
        id: candidate.id,
        path: candidate.path,
        removable: candidate.removable,
        bytes,
      })
    }
  }

  return {
    estimate: await fs.estimate(),
    entries,
    accountedBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
  }
}

/** Removes one reclaimable entry. Refuses anything marked unremovable. */
export async function reclaim(fs: FileSystem, report: StorageReport, id: string): Promise<number> {
  const entry = report.entries.find((candidate) => candidate.id === id)
  if (entry === undefined) return 0
  if (!entry.removable) {
    throw new Error(`Refusing to remove ${id}: losing it would lose the user's progress`)
  }

  await fs.remove(entry.path)
  return entry.bytes
}

/** Human-readable size. Deliberately coarse: exact bytes help nobody here. */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`
  if (bytes < 1000 * 1000) return `${(bytes / 1000).toFixed(0)} kB`
  if (bytes < 1000 * 1000 * 1000) return `${(bytes / 1e6).toFixed(1)} MB`
  return `${(bytes / 1e9).toFixed(2)} GB`
}

/**
 * Whether storage is under enough pressure to warn.
 *
 * Returns null when the browser reports no quota, which several do — silence
 * is better than inventing a number.
 */
export function pressure(estimate: StorageEstimate): number | null {
  if (estimate.quota === null || estimate.quota === 0 || estimate.usage === null) return null
  return estimate.usage / estimate.quota
}
