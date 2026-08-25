/**
 * Prints the version the web build should carry, from the same `version.txt`
 * the Unity build uses — so one file stays the source of truth and the in-app
 * version display keeps matching between the two.
 *
 *   node tools/version/print.mjs [--base|--bundle|--channel]
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseVersionFile } from '../../packages/core/src/version/version.ts'

const here = dirname(fileURLToPath(import.meta.url))
const versionFile = join(here, '../../../unity/Assets/Resources/version.txt')

const parsed = parseVersionFile(readFileSync(versionFile, 'utf8'))
if (parsed === null) {
  console.error(`${versionFile} is invalid: no version on the first line`)
  process.exit(1)
}

const what = process.argv[2] ?? '--bundle'
const value =
  what === '--base' ? parsed.base : what === '--channel' ? (parsed.channel ?? '') : parsed.bundle

process.stdout.write(`${value}\n`)
