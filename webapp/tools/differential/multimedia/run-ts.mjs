/** Runs the TypeScript port over the same corpus, in the same output shape. */
// Source, not dist: a stale build would validate the wrong code.
import { MemoryFileSystem } from '../../../packages/platform/src/filesystem.ts'
import { combine } from '../../../packages/platform/src/path.ts'
import { findLocalisedMultimediaFile } from '../../../packages/platform/src/multimedia.ts'

const SOURCE = '/scenario'

export async function runTs(cases) {
  const results = []
  for (const c of cases) {
    const fs = new MemoryFileSystem()
    for (const file of c.files) await fs.writeText(combine(SOURCE, file), '')

    let value = null
    let error = null
    try {
      const full = await findLocalisedMultimediaFile(fs, c.name, SOURCE, {
        currentLang: c.currentLang,
        fallbackLang: c.fallbackLang,
        editMode: c.editMode,
      })
      value = full.startsWith(SOURCE) ? full.slice(SOURCE.length).replace(/^\/+/, '') : full
    } catch (e) {
      error = e?.constructor?.name ?? 'Error'
    }
    results.push({ label: c.label, value, error })
  }
  return results
}
