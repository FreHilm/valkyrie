#!/usr/bin/env node
/**
 * Runs Vite with the Node that is actually executing this script.
 *
 * `npx` and `npm run` resolve `node` through PATH, which on a machine with
 * more than one install can pick a different architecture than the one the
 * dependencies were built for — rollup then fails looking for a native binary
 * it cannot have. Spawning with `process.execPath` sidesteps that entirely.
 *
 *   node run.mjs dev
 *   node run.mjs build
 */
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const vite = join(here, '../../node_modules/vite/bin/vite.js')

const child = spawn(process.execPath, [vite, ...process.argv.slice(2)], {
  cwd: here,
  stdio: 'inherit',
  env: { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ''}` },
})

child.on('exit', (code) => process.exit(code ?? 0))
