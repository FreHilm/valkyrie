/**
 * Caches the two real manifests outside the repo, so the differential run can
 * use real data while CI still works offline.
 *
 *   node fetch-real.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const CACHE = join(homedir(), '.cache', 'valkyrie-web-port', 'manifests')

const BASE = 'https://raw.githubusercontent.com/NPBruce/valkyrie-store/refs/heads/master'
const MANIFESTS = ['D2E', 'MoM']

if (import.meta.url === `file://${process.argv[1]}`) {
  mkdirSync(CACHE, { recursive: true })
  for (const game of MANIFESTS) {
    const url = `${BASE}/${game}/contentPacksManifestDownload.ini`
    const response = await fetch(url)
    if (!response.ok) throw new Error(`${url}: ${response.status}`)
    const text = await response.text()
    writeFileSync(join(CACHE, `${game}.ini`), text)
    console.log(`${game}: ${text.length} bytes`)
  }
}
