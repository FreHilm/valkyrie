/**
 * Tests for loading a quest and its content from the filesystem (T-018).
 *
 * The C# spreads this across ContentData, QuestLoader and Quest, each reaching
 * for Game.Get() and the real disk. Here it is one pair of functions over the
 * FileSystem interface, so the same code runs against OPFS in a browser, the
 * disk in Node, and this in-memory tree.
 */

import { describe, expect, it } from 'vitest'

import { MemoryFileSystem } from '../src/filesystem.js'
import { loadContent, loadQuest, textureResolver } from '../src/questLoading.js'

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
tokens.ini
`

describe('loadContent', () => {
  it('reads the inis a pack declares', async () => {
    const fs = await tree({
      '/content/base/content_pack.ini': PACK,
      '/content/base/monsters.ini': '[MonsterZombie]\ntraits=undead\n',
      '/content/base/tokens.ini': '',
    })

    const loaded = await loadContent(fs, {
      root: '/content',
      importPath: '/import',
      gameType: 'MoM',
    })

    expect(loaded.packs).toEqual(['/content/base'])
    expect(loaded.content.count(await monsterType())).toBe(1)
  })

  it('finds packs nested inside other pack directories', async () => {
    // The Mansions conversion kit is a directory of packs, each with its own
    // content_pack.ini. A one-level search silently finds none of them, and a
    // scenario needing them finds no monsters.
    const fs = await tree({
      '/content/ck/mom1e-monsters/content_pack.ini': PACK,
      '/content/ck/mom1e-monsters/monsters.ini': '[MonsterManiac]\ntraits=human\n',
      '/content/ck/mom1e-monsters/tokens.ini': '',
    })

    const loaded = await loadContent(fs, {
      root: '/content',
      importPath: '/import',
      gameType: 'MoM',
    })

    expect(loaded.packs).toEqual(['/content/ck/mom1e-monsters'])
  })

  it('tolerates a declared file that is not there', async () => {
    const fs = await tree({
      '/content/base/content_pack.ini': PACK,
      '/content/base/monsters.ini': '[MonsterZombie]\ntraits=undead\n',
    })

    const loaded = await loadContent(fs, {
      root: '/content',
      importPath: '/import',
      gameType: 'MoM',
    })

    expect(loaded.packs).toHaveLength(1)
  })

  it('resolves images while parsing, so a token with art survives', async () => {
    // GenericData resolves an image as it reads the section, and drops a token
    // whose image does not resolve. Building the resolver afterwards costs
    // every token in the game.
    const fs = await tree({
      '/content/base/content_pack.ini': PACK,
      '/content/base/monsters.ini': '',
      '/content/base/tokens.ini': '[TokenDoor]\nimage="img/door"\nx=0\ny=0\nwidth=64\nheight=64\n',
      '/content/base/img/door.webp': 'bytes',
    })

    const loaded = await loadContent(fs, {
      root: '/content',
      importPath: '/import',
      gameType: 'MoM',
    })

    expect(loaded.content.count(await tokenType())).toBe(1)
  })

  it('drops a token whose art is absent, as the C# does', async () => {
    const fs = await tree({
      '/content/base/content_pack.ini': PACK,
      '/content/base/monsters.ini': '',
      '/content/base/tokens.ini': '[TokenDoor]\nimage="img/missing"\n',
    })

    const loaded = await loadContent(fs, {
      root: '/content',
      importPath: '/import',
      gameType: 'MoM',
    })

    expect(loaded.content.count(await tokenType())).toBe(0)
  })

  it('gives Mansions and Descent their own tile scales', async () => {
    const fs = await tree({ '/content/base/content_pack.ini': PACK })

    const mom = await loadContent(fs, { root: '/content', importPath: '/i', gameType: 'MoM' })
    const d2e = await loadContent(fs, { root: '/content', importPath: '/i', gameType: 'D2E' })

    expect(mom.context.tilePixelPerSquare).toBeCloseTo(1024 / 3.5)
    expect(d2e.context.tilePixelPerSquare).toBe(105)
  })

  it('halves the Mansions scale on Android, as the C# does', async () => {
    const fs = await tree({ '/content/base/content_pack.ini': PACK })
    const loaded = await loadContent(fs, {
      root: '/content',
      importPath: '/i',
      gameType: 'MoM',
      android: true,
    })

    expect(loaded.context.tilePixelPerSquare).toBeCloseTo(512 / 3.5)
  })
})

describe('loadQuest', () => {
  const QUEST = `[Quest]
format=18
type=MoM
name=Test Quest

[QuestData]
events.ini
`

  it('reads the quest header and its components', async () => {
    const fs = await tree({
      '/quests/test/quest.ini': QUEST,
      '/quests/test/events.ini': '[EventIntro]\ntrigger=EventStart\n',
    })

    const loaded = await loadQuest(fs, '/quests/test')

    expect(loaded.quest.type).toBe('MoM')
    expect(loaded.quest.format).toBe(18)
    expect([...loaded.components.keys()]).toEqual(['EventIntro'])
  })

  it('reads every ini beside quest.ini, declared or not', async () => {
    // A scenario that forgets to declare a file still works in the game, so it
    // has to work here.
    const fs = await tree({
      '/quests/test/quest.ini': QUEST,
      '/quests/test/events.ini': '[EventIntro]\n',
      '/quests/test/undeclared.ini': '[TokenDoor]\n',
    })

    const loaded = await loadQuest(fs, '/quests/test')

    expect([...loaded.components.keys()].sort()).toEqual(['EventIntro', 'TokenDoor'])
  })

  it('does not read quest.ini as component data', async () => {
    const fs = await tree({ '/quests/test/quest.ini': QUEST })
    const loaded = await loadQuest(fs, '/quests/test')

    expect(loaded.components.size).toBe(0)
  })
})

describe('textureResolver', () => {
  it('prefers WebP, which is what the importer writes', async () => {
    const fs = await tree({ '/art/tile.webp': 'a', '/art/tile.png': 'b' })
    const resolve = await textureResolver(fs, ['/art'])

    expect(resolve('/art/tile')).toBe('/art/tile.webp')
  })

  it('falls back to the formats shipped in content packs', async () => {
    const fs = await tree({ '/art/tile.png': 'b' })
    const resolve = await textureResolver(fs, ['/art'])

    expect(resolve('/art/tile')).toBe('/art/tile.png')
  })

  it('falls back to a case-insensitive match, which shipped content needs', async () => {
    // Content declares `CommonItem_TomeOfHorrors` against a file named
    // `CommonItem_TomeofHorrors`. Windows and macOS ignore the difference and
    // the game works; OPFS and Linux do not, so an exact-only match silently
    // loses art that works today.
    const fs = await tree({ '/art/CommonItem_TomeofHorrors.webp': 'a' })
    const resolve = await textureResolver(fs, ['/art'])

    expect(resolve('/art/CommonItem_TomeOfHorrors')).toBe('/art/CommonItem_TomeofHorrors.webp')
  })

  it('prefers an exact match over a differently-cased sibling', async () => {
    const fs = await tree({ '/art/tile.webp': 'a', '/art/Tile.webp': 'b' })
    const resolve = await textureResolver(fs, ['/art'])

    expect(resolve('/art/tile')).toBe('/art/tile.webp')
    expect(resolve('/art/Tile')).toBe('/art/Tile.webp')
  })

  it('is null for art that is not there', async () => {
    const fs = await tree({ '/art/other.webp': 'a' })
    const resolve = await textureResolver(fs, ['/art'])

    expect(resolve('/art/tile')).toBeNull()
  })

  it('searches every root it is given', async () => {
    const fs = await tree({ '/import/img/tile.webp': 'a' })
    const resolve = await textureResolver(fs, ['/content', '/import'])

    expect(resolve('/import/img/tile')).toBe('/import/img/tile.webp')
  })
})

async function monsterType() {
  const { MonsterData } = await import('@valkyrie/core')
  return MonsterData
}
async function tokenType() {
  const { TokenData } = await import('@valkyrie/core')
  return TokenData
}
