/**
 * Cases for the remote content-pack manifest entries.
 *
 * The interesting surface is small but sharp: the default-language guard that
 * silently empties both name maps, the backslash rewrite on `image`, and
 * `DateTime.TryParse` on `latest_update`.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { CACHE } from './fetch-real.mjs'

export function curated() {
  const cases = []
  const add = (label, fields) => cases.push({ label, identifier: 'pack', fields })

  add('empty', {})
  add('full', {
    type: 'D2ECustom',
    defaultlanguage: 'English',
    image: 'icon.png',
    version: '1.1',
    'name.English': 'Doom',
    'description.English': 'A conversion kit.',
    url: 'https://example.invalid/packs/',
    latest_update: '2026-03-07T05:32:25Z',
  })

  // The guard: without name.English the whole map stays empty.
  add('names without the default language', { 'name.German': 'Titel', 'name.Spanish': 'Titulo' })
  add('names with the default language', {
    'name.English': 'Title',
    'name.German': 'Titel',
    'name.Spanish': 'Titulo',
  })
  add('description without the default language', { 'description.German': 'Beschreibung' })
  add('name present but description not', { 'name.English': 'Title', 'description.German': 'B' })
  add('empty default name', { 'name.English': '' })
  add('key that is exactly the prefix', { 'name.English': 'T', 'name.': 'bare' })

  // image
  add('image with backslashes', { image: 'img\\icons\\pack.png' })
  add('image with mixed separators', { image: 'img\\icons/pack.png' })
  add('image quoted', { image: '"icon.png"' })
  add('image empty', { image: '' })

  // latest_update — the shapes a manifest could plausibly carry.
  for (const value of [
    '2026-03-07T05:32:25Z',
    '2026-03-07T05:32:25',
    '2026-03-07 05:32:25',
    '2026-03-07',
    '2026-03-07T05:32:25+02:00',
    '2026-03-07T05:32:25.123Z',
    '2026-12-31T23:59:59Z',
    '1970-01-01T00:00:00Z',
    '0001-01-01T00:00:00Z',
    '07/03/2026',
    '2026-13-45T99:99:99Z',
    'not a date',
    '',
    '   2026-03-07T05:32:25Z   ',
  ]) {
    add(`latest_update ${JSON.stringify(value)}`, { latest_update: value })
  }

  // Other fields
  add('version numeric', { version: '1.10' })
  add('url without trailing slash', { url: 'https://example.invalid/packs' })
  add('type empty string', { type: '' })

  return cases
}

/** Entries from the real manifests, parsed the way the app parses them. */
export function realManifests() {
  const cases = []
  for (const game of ['D2E', 'MoM']) {
    const path = join(CACHE, `${game}.ini`)
    if (!existsSync(path)) continue

    for (const [identifier, fields] of parseIni(readFileSync(path, 'utf8'))) {
      cases.push({ label: `real ${game}/${identifier}`, identifier, fields })
    }
  }
  return cases
}

/** Just enough ini for a manifest: sections of key=value, `#` comments. */
function parseIni(text) {
  const sections = []
  let current = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.length === 0 || line.startsWith('#') || line.startsWith(';')) continue
    if (line.startsWith('[')) {
      current = [line.slice(1, line.lastIndexOf(']')), {}]
      sections.push(current)
      continue
    }
    const at = line.indexOf('=')
    if (at === -1 || current === null) continue
    current[1][line.slice(0, at).trim()] = trimQuotes(line.slice(at + 1).trim())
  }
  return sections
}

/** IniRead strips a matched pair of double quotes from a value. */
function trimQuotes(value) {
  return value.length > 1 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value
}

export function fuzz(count, seed = 1) {
  let state = seed >>> 0
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
  const pick = (list) => list[Math.floor(next() * list.length)]

  const LANGS = ['English', 'German', 'Spanish', 'French', '', 'english']
  const DATES = [
    '2026-03-07T05:32:25Z',
    '2026-03-07',
    '2026-03-07T05:32:25',
    '2026-03-07T05:32:25+05:30',
    'garbage',
    '',
    '9999-12-31T23:59:59Z',
  ]
  const IMAGES = ['a.png', 'x\\y.png', 'x/y\\z.png', '', '\\', 'a\\\\b.png']

  const cases = []
  for (let i = 0; i < count; i++) {
    const fields = {}
    if (next() < 0.8) fields[`name.${pick(LANGS)}`] = `n${i}`
    if (next() < 0.5) fields[`name.${pick(LANGS)}`] = `n2-${i}`
    if (next() < 0.6) fields[`description.${pick(LANGS)}`] = `d${i}`
    if (next() < 0.4) fields[`description.${pick(LANGS)}`] = `d2-${i}`
    if (next() < 0.7) fields.image = pick(IMAGES)
    if (next() < 0.7) fields.latest_update = pick(DATES)
    if (next() < 0.6) fields.type = pick(['D2ECustom', 'MoMCustom', ''])
    if (next() < 0.6) fields.version = pick(['1.0', '1.10', '', 'x'])
    if (next() < 0.6) fields.url = pick(['https://e.invalid/', ''])

    cases.push({ label: `fuzz ${i}`, identifier: `pack${i}`, fields })
  }
  return cases
}
