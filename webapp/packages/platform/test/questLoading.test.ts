/**
 * Tests for loading a quest and its content from the filesystem (T-018).
 *
 * The C# spreads this across ContentData, QuestLoader and Quest, each reaching
 * for Game.Get() and the real disk. Here it is one pair of functions over the
 * FileSystem interface, so the same code runs against OPFS in a browser, the
 * disk in Node, and this in-memory tree.
 */

import { describe, expect, it } from 'vitest'

import { Localization } from '@valkyrie/core'
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

describe('localization', () => {
  const LOCALIZED_PACK = `[ContentPack]
name=Base
id=Base
type=MoM

[ContentPackData]
monsters.ini

[LanguageData]
ffg Localization.ffg.txt
`
  const FFG_TEXT = `.,English
MONSTER_ZOMBIE,Zombie
`

  async function localizedTree(): Promise<MemoryFileSystem> {
    return tree({
      '/content/base/content_pack.ini': LOCALIZED_PACK,
      '/content/base/monsters.ini': '[MonsterZombie]\ntraits=undead\n',
      '/content/base/Localization.ffg.txt': FFG_TEXT,
      '/text/Localization.English.txt': '.,English\nMENU_PLAY,Play\n',
      '/quests/one/quest.ini':
        '[Quest]\nname={qst:quest.name}\ntype=MoM\n\n[QuestText]\nLocalization.txt\n',
      '/quests/one/Localization.txt': '.,English\nquest.name,The Fall\n',
    })
  }

  it('registers a pack dictionary from [LanguageData]', async () => {
    const loaded = await loadContent(await localizedTree(), {
      root: '/content',
      importPath: '/import',
      localization: new Localization(),
      gameType: 'MoM',
    })

    const ffg = loaded.context.localization.selectDictionary('ffg')
    expect(ffg?.getValue('MONSTER_ZOMBIE')).toBe('Zombie')
  })

  it('registers the imported game text as the ffg dictionary', async () => {
    const fs = await localizedTree()
    await fs.writeText('/import/text/Localization_en.txt', '.,English\nMONSTER_MANIAC,Maniac\n')

    const loaded = await loadContent(fs, {
      root: '/content',
      importPath: '/import',
      gameType: 'MoM',
      localization: new Localization(),
    })

    expect(loaded.context.localization.selectDictionary('ffg')?.getValue('MONSTER_MANIAC')).toBe(
      'Maniac',
    )
  })

  it('skips the numbered companions the import writes beside them', async () => {
    // GameSelectionScreen.cs:252 drops any file whose name contains a digit.
    const fs = await localizedTree()
    await fs.writeText('/import/text/Localization_en.txt', '.,English\nA,good\n')
    await fs.writeText('/import/text/Localization_en_2.txt', '.,English\nB,bad\n')

    const loaded = await loadContent(fs, {
      root: '/content',
      importPath: '/import',
      gameType: 'MoM',
      localization: new Localization(),
    })

    const ffg = loaded.context.localization.selectDictionary('ffg')
    expect(ffg?.getValue('A')).toBe('good')
    expect(ffg?.keyExists('B')).toBe(false)
  })

  it("registers Valkyrie's own text as the val dictionary", async () => {
    const loaded = await loadContent(await localizedTree(), {
      root: '/content',
      importPath: '/import',
      localization: new Localization(),
      uiText: '/text',
      gameType: 'MoM',
    })

    expect(loaded.context.localization.selectDictionary('val')?.getValue('MENU_PLAY')).toBe('Play')
  })

  it('searches the language a scenario was written in', async () => {
    // A community scenario is often authored in its author's language and
    // only partly translated. `keyExists` visits the required languages, and
    // the quest's own `defaultlanguage` is what makes its language one of
    // them — without it a key the author never translated is reported missing
    // and drawn as its own name.
    const fs = await tree({
      '/content/base/content_pack.ini': PACK,
      '/content/base/monsters.ini': '',
      '/quests/pt/quest.ini':
        '[Quest]\nformat=18\nname=Roubo\ntype=MoM\ndefaultlanguage=Portuguese\n\n' +
        '[QuestText]\nLocalization.Portuguese.txt\nLocalization.English.txt\n',
      // The button label exists only in the language it was written in.
      '/quests/pt/Localization.Portuguese.txt': '.,Portuguese\nEventStart.button1,Continuar\n',
      '/quests/pt/Localization.English.txt': '.,English\nOTHER,Something\n',
    })
    const loaded = await loadContent(fs, {
      root: '/content',
      importPath: '/import',
      gameType: 'MoM',
      localization: new Localization(),
    })
    await loadQuest(fs, '/quests/pt', loaded.context.localization)

    const qst = loaded.context.localization.selectDictionary('qst')
    expect(qst?.getValue('EventStart.button1')).toBe('Continuar')
  })

  it("registers the scenario's own text as the qst dictionary", async () => {
    const fs = await localizedTree()
    const loaded = await loadContent(fs, {
      root: '/content',
      importPath: '/import',
      localization: new Localization(),
      gameType: 'MoM',
    })
    await loadQuest(fs, '/quests/one', loaded.context.localization)

    expect(loaded.context.localization.selectDictionary('qst')?.getValue('quest.name')).toBe(
      'The Fall',
    )
  })

  it('replaces the qst dictionary rather than merging scenarios', async () => {
    // QuestData.cs:129 removes it first. Merging leaves the previous
    // scenario's keys answering lookups the new one never defined.
    const fs = await localizedTree()
    await fs.writeText(
      '/quests/two/quest.ini',
      '[Quest]\nname=Two\ntype=MoM\n\n[QuestText]\nLocalization.txt\n',
    )
    await fs.writeText('/quests/two/Localization.txt', '.,English\nother.name,Two\n')
    const loaded = await loadContent(fs, {
      root: '/content',
      importPath: '/import',
      localization: new Localization(),
      gameType: 'MoM',
    })

    await loadQuest(fs, '/quests/one', loaded.context.localization)
    await loadQuest(fs, '/quests/two', loaded.context.localization)

    const qst = loaded.context.localization.selectDictionary('qst')
    expect(qst?.getValue('other.name')).toBe('Two')
    expect(qst?.keyExists('quest.name')).toBe(false)
  })
})
