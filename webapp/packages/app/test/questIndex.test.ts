/**
 * Tests for the community scenario index (T-018).
 *
 * `QuestsManager` fetches one ini holding every scenario for a game. Each
 * section carries the same fields a quest.ini does, so the entries are read
 * with the same `Quest` class rather than a parallel parser — and what is
 * asserted here is mostly the things the index adds and the ways it can be
 * malformed.
 */

import { describe, expect, it } from 'vitest'

import {
  browsableQuests,
  byRecency,
  fetchQuestIndex,
  packageUrl,
  parseQuestIndex,
  questIndexUrl,
} from '../src/questIndex.js'
import type { HttpClient } from '@valkyrie/platform'

const ENTRY = `[ExoticMaterial]
format=18
type=MoM
difficulty=0.6
lengthmin=60
lengthmax=90
image=emlogo.jpg
url=https://raw.githubusercontent.com/NPBruce/valkyrie-questdata/master/scenarios/MoM/ExoticMaterial/
latest_update=2025-06-11T16:44:26Z
rating=5.664593513993781
play_count=2251
name.English=Exotic Material
`

describe('questIndexUrl', () => {
  it('points at the list QuestsManager reads', () => {
    expect(questIndexUrl('MoM')).toContain('valkyrie-store/master/MoM/manifestDownload.ini')
    expect(questIndexUrl('D2E')).toContain('/D2E/')
  })
})

describe('parseQuestIndex', () => {
  it('reads an entry with the same Quest class as a quest.ini', () => {
    const [entry] = parseQuestIndex(ENTRY)

    expect(entry?.id).toBe('ExoticMaterial')
    expect(entry?.quest.type).toBe('MoM')
    expect(entry?.quest.format).toBe(18)
  })

  it('carries what the index adds on top of a quest.ini', () => {
    const [entry] = parseQuestIndex(ENTRY)

    expect(entry?.rating).toBeCloseTo(5.66, 1)
    expect(entry?.playCount).toBe(2251)
    expect(entry?.updated).toBe('2025-06-11T16:44:26Z')
  })

  it('makes the cover image absolute against the package directory', () => {
    const [entry] = parseQuestIndex(ENTRY)

    expect(entry?.image).toContain('/ExoticMaterial/emlogo.jpg')
  })

  it('skips a scenario its author has withdrawn', () => {
    expect(parseQuestIndex(`${ENTRY}hidden=True\n`)).toHaveLength(0)
  })

  it('skips an entry with nowhere to download it from', () => {
    const withoutUrl = ENTRY.split('\n')
      .filter((line) => !line.startsWith('url='))
      .join('\n')

    expect(parseQuestIndex(withoutUrl)).toHaveLength(0)
  })

  it('does not let one malformed entry cost the player the rest', () => {
    const list = parseQuestIndex(`${ENTRY}
[Broken]
url=https://example.test/
format=notanumber

[Another]
format=18
type=MoM
url=https://example.test/another/
`)

    expect(list.map((e) => e.id)).toContain('ExoticMaterial')
    expect(list.map((e) => e.id)).toContain('Another')
  })

  it('reports an unrated scenario as unrated rather than zero', () => {
    // Zero and "nobody has rated it" mean very different things to a player
    // choosing what to play.
    const unrated = ENTRY.split('\n')
      .filter((line) => !line.startsWith('rating='))
      .join('\n')

    expect(parseQuestIndex(unrated)[0]?.rating).toBeNull()
  })
})

describe('packageUrl', () => {
  it('is the scenario’s own name under its directory', () => {
    const [entry] = parseQuestIndex(ENTRY)
    if (entry === undefined) throw new Error('no entry')

    expect(packageUrl(entry)).toBe(
      'https://raw.githubusercontent.com/NPBruce/valkyrie-questdata/master/scenarios/MoM/ExoticMaterial/ExoticMaterial.valkyrie',
    )
  })
})

describe('byRecency', () => {
  it('puts the most recently updated first', () => {
    const list = parseQuestIndex(`${ENTRY}
[Newer]
format=18
type=MoM
url=https://example.test/newer/
latest_update=2026-08-24T00:00:00Z
`)

    expect(byRecency(list)[0]?.id).toBe('Newer')
  })
})

describe('fetchQuestIndex', () => {
  it('reads the list over http', async () => {
    const http: HttpClient = {
      getText: async () => ENTRY,
      getBytes: async () => new Uint8Array(),
      getStream: async function* () {},
    }

    const list = await fetchQuestIndex({ http, gameType: 'MoM' })

    expect(list.map((e) => e.id)).toEqual(['ExoticMaterial'])
  })
})

describe('browsableQuests', () => {
  const entries = parseQuestIndex(`${ENTRY}
[SpanishOnly]
format=18
type=MoM
defaultlanguage=Spanish
url=https://example.test/spanish/
name.Spanish=El huésped
synopsys.Spanish=Una historia
`)

  it('shows the name in the player’s language', () => {
    const [exotic] = browsableQuests(entries, new Set())

    expect(exotic?.display).toBe('Exotic Material')
  })

  it('falls back to any name the author wrote', () => {
    // Only 90 of the index's 169 scenarios carry an English name while 150
    // carry a Spanish one, so falling straight back to the section id would
    // show a directory name where a real title exists.
    const spanish = browsableQuests(entries, new Set()).find((e) => e.key === 'SpanishOnly')

    expect(spanish?.display).toBe('El huésped')
    expect(spanish?.description).toBe('Una historia')
  })

  it('marks what is already downloaded', () => {
    const [exotic] = browsableQuests(entries, new Set(['ExoticMaterial']))

    expect(exotic?.status).toBe('Downloaded')
  })

  it('bands difficulty and length as words, which is how the game shows them', () => {
    const [exotic] = browsableQuests(entries, new Set())

    expect(exotic?.traits.get('Difficulty')).toEqual(['Hard'])
    expect(exotic?.traits.get('Length')).toEqual(['Medium'])
  })

  it('keeps unrated as its own band, not as zero', () => {
    // Zero and "nobody has rated it" mean different things to someone choosing
    // what to play.
    const spanish = browsableQuests(entries, new Set()).find((e) => e.key === 'SpanishOnly')

    expect(spanish?.traits.get('Rating')).toEqual(['Unrated'])
  })
})
