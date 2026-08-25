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
import { libraryPaths, startQuest, surveyLibrary } from '../src/library.js'
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

    expect(state.quests).toEqual([
      { id: 'Lynch', path: '/download/Lynch', name: 'Lynch', type: 'MoM', format: 18 },
    ])
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
