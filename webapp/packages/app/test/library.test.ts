/**
 * Tests for the browser's quest library (T-018).
 *
 * The Unity app answers "what do I have" by scanning the real filesystem at
 * startup and holding the result in `Game`; when the import never ran, the
 * quest list is silently empty. Here it is a value a screen can show, so the
 * missing piece can be named.
 */

import { describe, expect, it } from 'vitest'

import { MemoryFileSystem, StoragePaths } from '@valkyrie/platform'
import { libraryPaths, loadedPackIds, startQuest, surveyLibrary } from '../src/library.js'
import type { LibraryPaths } from '../src/library.js'

const PATHS: LibraryPaths = {
  content: '/content',
  quests: '/download',
  imported: '/import',
}

async function tree(files: Record<string, string>): Promise<MemoryFileSystem> {
  const fs = new MemoryFileSystem()
  for (const [path, content] of Object.entries(files)) await fs.writeText(path, content)
  return fs
}

const PACK = `[ContentPack]
name=Base
id=Base
type=MoM

[ContentPackData]
monsters.ini
`

const QUEST = `[Quest]
format=18
type=MoM

[QuestData]
events.ini
`

describe('libraryPaths', () => {
  it('reads the roots from the storage layout', () => {
    const paths = libraryPaths(
      new StoragePaths({ appData: '/app', content: '/content', temp: '/tmp' }, 'MoM'),
    )

    expect(paths.content).toContain('content')
    expect(paths.imported).toContain('import')
  })
})

describe('surveyLibrary', () => {
  it('reports nothing when the import has never run', async () => {
    const state = await surveyLibrary(new MemoryFileSystem(), PATHS)

    expect(state.hasContent).toBe(false)
    expect(state.quests).toEqual([])
  })

  it('finds content packs, including nested ones', async () => {
    const fs = await tree({
      '/content/base/content_pack.ini': PACK,
      '/content/base/monsters.ini': '',
      '/content/ck/mom1e/content_pack.ini': PACK,
      '/content/ck/mom1e/monsters.ini': '',
    })
    const state = await surveyLibrary(fs, PATHS)

    expect(state.hasContent).toBe(true)
    expect(state.packs.sort()).toEqual(['/content/base', '/content/ck/mom1e'])
  })

  it('lists a quest from its own quest.ini, not a manifest', async () => {
    // A package dropped in by hand should appear beside downloaded ones.
    const fs = await tree({
      '/download/Lynch/quest.ini': QUEST,
      '/download/Lynch/events.ini': '[EventIntro]\n',
    })
    const state = await surveyLibrary(fs, PATHS)

    expect(state.quests).toMatchObject([
      { id: 'Lynch', path: '/download/Lynch', name: 'Lynch', type: 'MoM', format: 18 },
    ])
  })

  it('shows the scenario its own title, not the directory it landed in', async () => {
    // A download names the directory `MoM__ExoticMaterial`; the author called
    // it "Exotic Material", and that is what a player is looking for. The
    // title is not in the ini at all — it is a key in the scenario's own text.
    const fs = await tree({
      '/download/MoM__ExoticMaterial/quest.ini': `${QUEST}
[QuestText]
Localization.English.txt
`,
      '/download/MoM__ExoticMaterial/Localization.English.txt':
        '.,English\nquest.name,Exotic Material\nquest.description,A meteorite fell.\n',
    })

    expect((await surveyLibrary(fs, PATHS)).quests[0]).toMatchObject({
      name: 'Exotic Material',
      description: 'A meteorite fell.',
    })
  })

  it('falls back to the directory name when there is no title to read', async () => {
    const fs = await tree({ '/download/Lynch/quest.ini': QUEST })

    expect((await surveyLibrary(fs, PATHS)).quests[0]?.name).toBe('Lynch')
  })

  it('does not report the key back as a name', async () => {
    // `getValue` answers a missing key with the key, so a scenario whose text
    // has no title would otherwise be listed as "quest.name".
    const fs = await tree({
      '/download/Lynch/quest.ini': `${QUEST}
[QuestText]
Localization.English.txt
`,
      '/download/Lynch/Localization.English.txt': '.,English\nEventStart.text,Hello.\n',
    })

    expect((await surveyLibrary(fs, PATHS)).quests[0]?.name).toBe('Lynch')
  })

  it('leaves out a blurb the scenario does not have', async () => {
    // The title and the blurb are separate keys, and plenty of scenarios carry
    // one without the other. `getValue` answers a missing key with the key, so
    // without a guard the card reads "quest.description" as its blurb.
    const fs = await tree({
      '/download/Lynch/quest.ini': `${QUEST}
[QuestText]
Localization.English.txt
`,
      '/download/Lynch/Localization.English.txt': '.,English\nquest.name,The Fall\n',
    })

    expect((await surveyLibrary(fs, PATHS)).quests[0]).toMatchObject({
      name: 'The Fall',
      description: '',
    })
  })

  it('carries the cover, the packs and the table it wants', async () => {
    const fs = await tree({
      '/download/Lynch/quest.ini': `[Quest]
format=18
type=MoM
packs=MoM1EI MoM1EM
image=hol.jpg
difficulty=0.3
lengthmin=90
lengthmax=120
`,
    })

    const quest = (await surveyLibrary(fs, PATHS)).quests[0]

    expect(quest).toMatchObject({
      image: '/download/Lynch/hol.jpg',
      packs: ['MoM1EI', 'MoM1EM'],
      lengthMin: 90,
      lengthMax: 120,
    })
    // Single precision, because `Quest` reads it as the C# `float` does.
    expect(quest?.difficulty).toBeCloseTo(0.3, 6)
  })

  it('reports no cover rather than a path to nothing', async () => {
    // An empty `image` joined to the directory would be the directory, and an
    // <img> pointed at a directory is a broken-image icon on every card.
    const fs = await tree({ '/download/Lynch/quest.ini': QUEST })

    expect((await surveyLibrary(fs, PATHS)).quests[0]?.image).toBe('')
  })

  it('ignores a directory that is not a quest', async () => {
    const fs = await tree({ '/download/notes/readme.txt': 'hello' })

    expect((await surveyLibrary(fs, PATHS)).quests).toEqual([])
  })

  it('does not let one broken package hide the rest', async () => {
    const fs = await tree({
      '/download/Good/quest.ini': QUEST,
      '/download/Good/events.ini': '',
      '/download/Broken/quest.ini': '[Quest]\nformat=notanumber\n',
    })
    const state = await surveyLibrary(fs, PATHS)

    expect(state.quests.map((q) => q.id)).toContain('Good')
  })
})

describe('loadedPackIds', () => {
  // Not the same as the selection: the base pack is always in, and a pack
  // pulls in whatever it clones. A scenario asking for a pack the player never
  // ticked can still be playable because something they did tick brings it.
  const packIni = (id: string, clone = ''): string =>
    `[ContentPack]
name=${id}
id=${id}
type=MoM
${clone === '' ? '' : `clone=${clone}`}
`

  it('always includes the base pack, selected or not', async () => {
    const fs = await tree({ '/content/base/content_pack.ini': packIni('MoMBase') })

    expect([...(await loadedPackIds(fs, ['/content/base'], [], 'MoMBase'))]).toEqual(['MoMBase'])
  })

  it('includes what the player selected', async () => {
    const fs = await tree({
      '/content/base/content_pack.ini': packIni('MoMBase'),
      '/content/sot/content_pack.ini': packIni('SoT'),
    })

    const loaded = await loadedPackIds(fs, ['/content/base', '/content/sot'], ['SoT'], 'MoMBase')

    expect([...loaded].sort()).toEqual(['MoMBase', 'SoT'])
  })

  it('brings in what a selected pack clones', async () => {
    const fs = await tree({
      '/content/base/content_pack.ini': packIni('MoMBase'),
      '/content/ck/content_pack.ini': packIni('MoM1CK', 'MoM1EI'),
      '/content/inv/content_pack.ini': packIni('MoM1EI'),
    })

    const loaded = await loadedPackIds(
      fs,
      ['/content/base', '/content/ck', '/content/inv'],
      ['MoM1CK'],
      'MoMBase',
    )

    expect(loaded.has('MoM1EI')).toBe(true)
  })

  it('leaves out a pack the player has not selected', async () => {
    const fs = await tree({
      '/content/base/content_pack.ini': packIni('MoMBase'),
      '/content/sot/content_pack.ini': packIni('SoT'),
    })

    const loaded = await loadedPackIds(fs, ['/content/base', '/content/sot'], [], 'MoMBase')

    expect(loaded.has('SoT')).toBe(false)
  })

  it('survives a pack whose ini will not parse', async () => {
    const fs = await tree({
      '/content/base/content_pack.ini': packIni('MoMBase'),
      '/content/broken/content_pack.ini': 'not an ini at all',
    })

    await expect(
      loadedPackIds(fs, ['/content/base', '/content/broken'], [], 'MoMBase'),
    ).resolves.toEqual(new Set(['MoMBase']))
  })
})

describe('startQuest', () => {
  const world = () =>
    tree({
      '/content/base/content_pack.ini': PACK,
      '/content/base/monsters.ini': '[MonsterZombie]\ntraits=undead\nactivation=Common\n',
      '/download/Lynch/quest.ini': QUEST,
      '/download/Lynch/events.ini':
        '[EventIntro]\ntrigger=EventStart\nbuttons=1\nevent1=\n[SpawnA]\nmonster=MonsterZombie\nbuttons=1\nevent1=\n',
    })

  it('starts a session that can run the quest', async () => {
    const fs = await world()
    const { session } = await startQuest(fs, PATHS, '/download/Lynch')
    session.runtime.heroes.push({ heroName: 'HeroAshcanPete', activated: false })
    session.start()

    expect(session.view().kind).toBe('event')
  })

  it('gives spawns the content they resolve against', async () => {
    // Without content loaded a spawn resolves to nothing and the scenario
    // silently fights no one.
    const fs = await world()
    const { session } = await startQuest(fs, PATHS, '/download/Lynch')
    session.runtime.heroes.push({ heroName: 'HeroAshcanPete', activated: false })
    session.start()
    session.press(0)
    session.activate('SpawnA')

    expect(session.runtime.monsters.map((m) => m.monsterName)).toEqual(['MonsterZombie'])
  })

  it('takes the game type from the quest when none is given', async () => {
    const fs = await world()
    const { session } = await startQuest(fs, PATHS, '/download/Lynch')

    // A Mansions quest runs the Mansions round controller.
    expect(session.rounds.phase).toBe('investigator')
  })

  it('resolves art from content, imports and the quest’s own directory', async () => {
    const fs = await tree({
      '/content/base/content_pack.ini': PACK,
      '/content/base/monsters.ini': '',
      '/content/base/img/tile.webp': 'a',
      '/import/img/monster.webp': 'b',
      '/download/Lynch/quest.ini': QUEST,
      '/download/Lynch/events.ini': '',
      '/download/Lynch/custom.webp': 'c',
    })
    const { resolveTexture } = await startQuest(fs, PATHS, '/download/Lynch')

    expect(resolveTexture('/content/base/img/tile')).toBe('/content/base/img/tile.webp')
    expect(resolveTexture('/import/img/monster')).toBe('/import/img/monster.webp')
    expect(resolveTexture('/download/Lynch/custom')).toBe('/download/Lynch/custom.webp')
  })
})
