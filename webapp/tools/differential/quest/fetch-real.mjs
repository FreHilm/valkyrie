/**
 * Downloads a sample of published scenarios for the quest differential.
 *
 * No quest content ships with the repository — the app fetches it at runtime
 * from the same two public repositories used here. Run this once locally; the
 * result is written outside the repo and the harness works without it.
 *
 *   node fetch-real.mjs <output-directory>
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const out = process.argv[2]
if (out === undefined) {
  console.error('usage: node fetch-real.mjs <output-directory>')
  process.exit(1)
}

const STORE = 'https://raw.githubusercontent.com/NPBruce/valkyrie-store/master'
const DATA = 'https://api.github.com/repos/NPBruce/valkyrie-questdata/contents/scenarios'

mkdirSync(out, { recursive: true })

async function getJson(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${response.status} ${url}`)
  return response.json()
}

// 1. The manifests: one section per published quest, in [Quest] metadata form.
for (const game of ['D2E', 'MoM']) {
  const response = await fetch(`${STORE}/${game}/manifestDownload.ini`)
  if (!response.ok) {
    console.error(`manifest ${game}: ${response.status}`)
    continue
  }
  const text = await response.text()
  writeFileSync(join(out, `${game.toLowerCase()}-manifest.ini`), text)
  console.log(
    `${game} manifest: ${text.split('\n').filter((l) => l.startsWith('[')).length} quests`,
  )
}

// 2. A sample of .valkyrie packages, for the component content inside them.
const extracted = join(out, 'extracted')
mkdirSync(extracted, { recursive: true })

let packages = 0
for (const game of ['D2E', 'MoM']) {
  let dirs
  try {
    dirs = await getJson(`${DATA}/${game}`)
  } catch (e) {
    console.error(`${game} listing: ${e.message}`)
    continue
  }

  for (const dir of dirs.filter((d) => d.type === 'dir')) {
    let files
    try {
      files = await getJson(dir.url)
    } catch {
      continue
    }

    for (const file of files.filter((f) => f.name.endsWith('.valkyrie'))) {
      const target = join(extracted, `${game}__${dir.name}`)
      mkdirSync(target, { recursive: true })
      const archive = join(target, '.package.zip')
      try {
        const response = await fetch(file.download_url)
        if (!response.ok) continue
        writeFileSync(archive, Buffer.from(await response.arrayBuffer()))
        // Only the ini files matter; images and audio are not parsed here.
        execFileSync('unzip', ['-o', '-j', archive, '*.ini', '-d', target], { stdio: 'ignore' })
        packages++
      } catch {
        // A scenario that will not download is simply skipped.
      }
    }
  }
}

console.log(`packages extracted: ${packages}`)
