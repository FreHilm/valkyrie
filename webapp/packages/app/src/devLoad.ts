/**
 * Pulling the dev server's asset cache into browser storage.
 *
 * Chrome refuses `showDirectoryPicker` on anything under `~/Library`, and on
 * macOS that is where both the game install and its downloaded content live,
 * so the in-browser import cannot reach them on this platform at all. The
 * command-line importer has no such restriction; this copies what it produced
 * into OPFS so the app can be used while that stands.
 *
 * Development only. It talks to a Vite middleware that does not exist in a
 * build, and reports plainly when it is not there.
 */

import type { FileSystem } from '@valkyrie/platform'

export interface DevManifest {
  available: boolean
  /** Valkyrie's own content packs, without which a quest has nothing to play with. */
  content: { path: string; size: number }[]
  /** Valkyrie's own `Localization*.txt`, which become the `val` dictionary. */
  uiText?: { path: string; size: number }[]
  imported: { path: string; size: number }[]
  quests: { id: string; files: { path: string; size: number }[] }[]
}

export interface DevLoadTargets {
  /** Where content packs belong. */
  contentRoot: string
  /** Where Valkyrie's own UI text belongs. */
  uiTextRoot: string
  /** Where imported assets belong. */
  importPath: string
  /** Where extracted scenarios belong. */
  questRoot: string
}

export interface DevLoadResult {
  files: number
  bytes: number
  quests: string[]
}

/** Whether the dev middleware is answering. */
export async function devManifest(): Promise<DevManifest | null> {
  try {
    const response = await fetch('/local/manifest')
    if (!response.ok) return null
    return (await response.json()) as DevManifest
  } catch {
    return null
  }
}

/**
 * Copies the cache into OPFS.
 *
 * Files are fetched one at a time rather than all at once: 1,700 parallel
 * requests to a dev server is a good way to make it look broken.
 */
export async function loadFromDevServer(
  fs: FileSystem,
  manifest: DevManifest,
  targets: DevLoadTargets,
  onProgress?: (done: number, total: number, what: string) => void,
): Promise<DevLoadResult> {
  const jobs: { from: string; to: string; size: number }[] = []

  for (const entry of manifest.content ?? []) {
    jobs.push({
      from: `content/${entry.path}`,
      to: `${targets.contentRoot}/${entry.path}`,
      size: entry.size,
    })
  }
  for (const entry of manifest.uiText ?? []) {
    jobs.push({
      from: `text/${entry.path}`,
      to: `${targets.uiTextRoot}/${entry.path}`,
      size: entry.size,
    })
  }
  for (const entry of manifest.imported) {
    jobs.push({
      from: `ffg/MoM-import/import/${entry.path}`,
      to: `${targets.importPath}/${entry.path}`,
      size: entry.size,
    })
  }
  for (const quest of manifest.quests) {
    for (const file of quest.files) {
      jobs.push({
        from: `quests/extracted/${quest.id}/${file.path}`,
        to: `${targets.questRoot}/${quest.id}/${file.path}`,
        size: file.size,
      })
    }
  }

  let bytes = 0
  let done = 0
  for (const job of jobs) {
    // Content packs come from the repository rather than the cache, so they
    // are fetched through their own route.
    const url = job.from.startsWith('content/')
      ? `/local/content?path=${encodeURIComponent(job.from.slice('content/'.length))}`
      : job.from.startsWith('text/')
        ? `/local/text?path=${encodeURIComponent(job.from.slice('text/'.length))}`
        : `/local/file?path=${encodeURIComponent(job.from)}`
    const response = await fetch(url)
    if (response.ok) {
      const data = new Uint8Array(await response.arrayBuffer())
      await fs.writeBytes(job.to, data)
      bytes += data.byteLength
    }
    done++
    onProgress?.(done, jobs.length, job.to.slice(job.to.lastIndexOf('/') + 1))
  }

  return { files: done, bytes, quests: manifest.quests.map((q) => q.id) }
}
