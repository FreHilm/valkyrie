/**
 * Serving an already-imported asset cache to the dev server.
 *
 * Chrome refuses `showDirectoryPicker` on anything under `~/Library`, which on
 * macOS is where both the Steam install and the game's downloaded content
 * live — so the in-browser import cannot reach them at all on this platform.
 *
 * `tools/ffg/run-import.mjs` has no such restriction. This plugin hands its
 * output to the running app, so a developer can get real content into OPFS
 * without copying a gigabyte to the Desktop first.
 *
 * Development only: it reads outside the project and is never part of a build.
 */

import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative, sep } from 'node:path'
import type { Plugin } from 'vite'

const CACHE = join(homedir(), '.cache', 'valkyrie-web-port')
/** Valkyrie's own content packs, which live in the repository. */
const CONTENT = join(
  process.cwd(),
  '..',
  '..',
  '..',
  'unity',
  'Assets',
  'StreamingAssets',
  'content',
)

interface Entry {
  path: string
  size: number
}

/** Art a pack ships itself, as opposed to art the import supplies. */
function isArt(path: string): boolean {
  return /\.(png|jpg|jpeg|webp|ogg|dds)$/i.test(path)
}

function walk(root: string, dir = root, into: Entry[] = []): Entry[] {
  if (!existsSync(dir)) return into
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) walk(root, full, into)
    else into.push({ path: relative(root, full).split(sep).join('/'), size: stat.size })
  }
  return into
}

export function devAssets(): Plugin {
  return {
    name: 'valkyrie-dev-assets',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/local/manifest', (_request, response) => {
        const imported = join(CACHE, 'ffg', 'MoM-import', 'import')
        const quests = join(CACHE, 'quests', 'extracted')
        // The content packs matter as much as the art: they are what say what a
        // monster is, which tile side to draw and what a token looks like.
        // Without them a quest loads and then finds nothing to play with.
        const content = join(CONTENT, 'MoM')
        const body = JSON.stringify({
          available: existsSync(imported),
          content: walk(content).filter((e) => e.path.endsWith('.ini') || isArt(e.path)),
          imported: walk(imported),
          quests: readdirSync(quests, { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => ({ id: e.name, files: walk(join(quests, e.name)) })),
        })
        response.setHeader('content-type', 'application/json')
        response.end(body)
      })

      server.middlewares.use('/local/content', (request, response) => {
        const url = new URL(request.url ?? '', 'http://localhost')
        const wanted = url.searchParams.get('path') ?? ''
        const full = join(CONTENT, 'MoM', wanted)
        if (!full.startsWith(CONTENT) || !existsSync(full) || statSync(full).isDirectory()) {
          response.statusCode = 404
          response.end('not found')
          return
        }
        response.setHeader('content-type', 'application/octet-stream')
        createReadStream(full).pipe(response)
      })

      server.middlewares.use('/local/file', (request, response) => {
        const url = new URL(request.url ?? '', 'http://localhost')
        const wanted = url.searchParams.get('path') ?? ''
        // Confined to the cache: a dev convenience is still not a reason to
        // serve arbitrary files off the machine.
        const full = join(CACHE, wanted)
        if (!full.startsWith(CACHE) || !existsSync(full) || statSync(full).isDirectory()) {
          response.statusCode = 404
          response.end('not found')
          return
        }
        response.setHeader('content-type', 'application/octet-stream')
        createReadStream(full).pipe(response)
      })
    },
  }
}
