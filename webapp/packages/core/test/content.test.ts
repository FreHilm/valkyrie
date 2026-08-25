/**
 * Migrated from `ContentTypesTests.cs` (114 cases) and `ContentDataTests.cs`.
 *
 * Unlike the ini/config/i18n suites, this C# suite is a good one: 90 of its
 * 114 cases construct the real types rather than simulating them, so the
 * migration is close to one-for-one.
 *
 * Equivalence with the C# is established by the differential harness over
 * 3,198 cases including every shipped content pack; these tests document
 * intent and guard regressions.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { ContentData, makeTextureResolver } from '../src/content/ContentData.js'
import { ContentLoader } from '../src/content/ContentLoader.js'
import { parseContentPack } from '../src/content/ContentPack.js'
import { combinePath, concatPath, headlessContext } from '../src/content/context.js'
import {
  CURRENT_QUEST_FORMAT,
  QuestFormatVersions,
  requiresConversionKit,
} from '../src/content/FormatVersions.js'
import {
  ActivationData,
  AttackData,
  AudioData,
  ClassData,
  EvadeData,
  GenericData,
  HeroData,
  HorrorData,
  ImageData,
  ItemData,
  MonsterData,
  PuzzleData,
  SkillData,
  TileSideData,
  TokenData,
} from '../src/content/types.js'
import type { ContentContext } from '../src/content/context.js'
import { DictionaryI18n } from '../src/i18n/DictionaryI18n.js'
import { Localization } from '../src/i18n/Localization.js'
import { readFromString } from '../src/ini/IniRead.js'

let context: ContentContext

beforeEach(() => {
  context = headlessContext({ localization: new Localization(), tilePixelPerSquare: 105 })
})

const fields = (o: Record<string, string>) => new Map(Object.entries(o))

describe('GenericData', () => {
  const build = (name: string, o: Record<string, string> = {}, sets: string[] | null = null) =>
    new GenericData(name, fields(o), '/pack', 'Hero', sets, context)

  it('GenericData_MinimalDictionary_SetsDefaults', () => {
    const d = build('HeroFoo')

    expect(d.priority).toBe(0)
    expect(d.traits).toEqual([])
    expect(d.image).toBe('')
    expect(d.sets).toEqual([])
    expect(d.sectionName).toBe('HeroFoo')
  })

  it('GenericData_WithName_ParsesNameCorrectly', () => {
    expect(build('HeroFoo', { name: 'Widow Tarha' }).name.fullKey).toBe('Widow Tarha')
  })

  it('GenericData_WithoutName_UsesDefaultFromSectionName', () => {
    // The type prefix is stripped to make the display name.
    expect(build('HeroFoo').name.fullKey).toBe('Foo')
  })

  it('leaves the section name alone when it is exactly the type', () => {
    expect(build('Hero').name.fullKey).toBe('Hero')
  })

  it('GenericData_WithPriority_ParsesPriorityCorrectly', () => {
    expect(build('HeroFoo', { priority: '7' }).priority).toBe(7)
  })

  it('GenericData_WithInvalidPriority_DefaultsToZero', () => {
    expect(build('HeroFoo', { priority: 'abc' }).priority).toBe(0)
  })

  it('GenericData_WithTraits_ParsesTraitsCorrectly', () => {
    expect(build('HeroFoo', { traits: 'human warrior noble' }).traits).toEqual([
      'human',
      'warrior',
      'noble',
    ])
  })

  it('keeps empty segments when traits are double-spaced', () => {
    // C# Split(' ') without RemoveEmptyEntries.
    expect(build('HeroFoo', { traits: 'a  b' }).traits).toEqual(['a', '', 'b'])
  })

  it('GenericData_WithSets_StoresSetsCorrectly', () => {
    expect(build('HeroFoo', {}, ['base', 'exp']).sets).toEqual(['base', 'exp'])
  })

  it('GenericData_WithNullSets_CreatesEmptyList', () => {
    expect(build('HeroFoo', {}, null).sets).toEqual([])
  })

  it('GenericData_ContainsTrait_ReturnsTrueForExistingTrait', () => {
    expect(build('HeroFoo', { traits: 'human warrior' }).containsTrait('warrior')).toBe(true)
  })

  it('GenericData_ContainsTrait_ReturnsFalseForNonExistingTrait', () => {
    expect(build('HeroFoo', { traits: 'human' }).containsTrait('elf')).toBe(false)
  })
})

describe('GenericData image resolution', () => {
  it('joins a relative image against the pack path', () => {
    // The loop only keeps a path that actually resolves, so a resolver is
    // needed to observe the join at all.
    const resolving = headlessContext({ resolveTextureFile: (p) => p })
    const d = new GenericData(
      'HeroFoo',
      fields({ image: 'pic.png' }),
      '/pack',
      'Hero',
      null,
      resolving,
    )

    expect(d.image).toBe('/pack/pic.png')
  })

  it('resolves an {import} image against the import path', () => {
    const withImport = headlessContext({
      importPath: '/appdata/D2E/import',
      resolveTextureFile: (p) => p,
    })
    const d = new GenericData(
      'HeroFoo',
      fields({ image: '{import}/img/a.png' }),
      '/pack',
      'Hero',
      null,
      withImport,
    )

    expect(d.image).toBe('/appdata/D2E/import/img/a.png')
  })

  it('falls through image, image2, image3 until one resolves', () => {
    const resolving = headlessContext({
      resolveTextureFile: makeTextureResolver((p) => p === '/pack/c.png'),
    })
    const d = new GenericData(
      'HeroFoo',
      fields({ image: 'a.png', image2: 'b.png', image3: 'c.png' }),
      '/pack',
      'Hero',
      null,
      resolving,
    )

    expect(d.image).toBe('/pack/c.png')
  })

  it('ends with an empty image when nothing resolves', () => {
    const d = new GenericData(
      'HeroFoo',
      fields({ image: 'a.png', image2: 'b.png' }),
      '/pack',
      'Hero',
      null,
      context,
    )

    expect(d.image).toBe('')
  })

  it('probes each texture extension in order', () => {
    const tried: string[] = []
    const resolve = makeTextureResolver((p) => {
      tried.push(p)
      return p.endsWith('.png')
    })

    expect(resolve('/pack/a')).toBe('/pack/a.png')
    expect(tried).toEqual(['/pack/a', '/pack/a.dds', '/pack/a.pvr', '/pack/a.png'])
  })
})

describe('typed content', () => {
  const of = <T>(
    Ctor: new (
      n: string,
      c: Map<string, string>,
      p: string,
      s: string[] | null,
      x: ContentContext,
    ) => T,
    name: string,
    o: Record<string, string> = {},
  ): T => new Ctor(name, fields(o), '/pack', null, context)

  it('HeroData_MinimalDictionary_SetsDefaultArchetype', () => {
    const d = of(HeroData, 'HeroFoo')

    expect(d.archetype).toBe('warrior')
    expect(d.item).toBe('')
  })

  it('HeroData_WithAllFields_ParsesAllFields', () => {
    const d = of(HeroData, 'HeroFoo', { archetype: 'healer', item: 'ItemStaff' })

    expect(d.archetype).toBe('healer')
    expect(d.item).toBe('ItemStaff')
  })

  it('ClassData_WithAllFields_ParsesAllFields', () => {
    const d = of(ClassData, 'ClassMage', {
      archetype: 'mage',
      hybridarchetype: 'healer',
      items: 'a b  c',
    })

    expect(d.archetype).toBe('mage')
    expect(d.hybridArchetype).toBe('healer')
    // RemoveEmptyEntries here, unlike traits.
    expect(d.items).toEqual(['a', 'b', 'c'])
  })

  it('SkillData_WithNegativeXp_ParsesNegativeValue', () => {
    expect(of(SkillData, 'SkillFoo', { xp: '-3' }).xp).toBe(-3)
  })

  it('SkillData_WithInvalidXp_DefaultsToZero', () => {
    expect(of(SkillData, 'SkillFoo', { xp: 'x' }).xp).toBe(0)
  })

  it('ItemData_WithUniquePrefix_SetsUniqueTrue', () => {
    expect(of(ItemData, 'ItemUniqueBlade').unique).toBe(true)
    expect(of(ItemData, 'ItemBlade').unique).toBe(false)
  })

  it('ItemData_WithAllFields_ParsesAllFields', () => {
    const d = of(ItemData, 'ItemSword', {
      price: '25',
      minfame: 'noteworthy',
      maxfame: 'legendary',
    })

    expect(d.price).toBe(25)
    expect(d.minFame).toBe(2)
    expect(d.maxFame).toBe(6)
  })

  it('ItemData_Fame_AllLevels', () => {
    expect(
      ['insignificant', 'noteworthy', 'impressive', 'celebrated', 'heroic', 'legendary'].map((n) =>
        ItemData.fame(n),
      ),
    ).toEqual([1, 2, 3, 4, 5, 6])
    expect(ItemData.fame('unknown')).toBe(0)
  })

  it('leaves fame at -1 when the key is absent', () => {
    const d = of(ItemData, 'ItemSword')

    expect(d.minFame).toBe(-1)
    expect(d.maxFame).toBe(-1)
  })

  it('MonsterData_WithAllFields_ParsesAllFields', () => {
    const d = of(MonsterData, 'MonsterZombie', {
      info: 'Slow but many',
      activation: 'ActA ActB',
      health: '4.5',
      healthperhero: '1.5',
      horror: '2',
      awareness: '3',
    })

    expect(d.info.fullKey).toBe('Slow but many')
    expect(d.activations).toEqual(['ActA', 'ActB'])
    expect(d.healthBase).toBe(4.5)
    expect(d.healthPerHero).toBe(1.5)
    expect(d.horror).toBe(2)
    expect(d.awareness).toBe(3)
  })

  it('MonsterData falls back to image when imageplace is absent', () => {
    const d = of(MonsterData, 'MonsterZombie', {})

    expect(d.imagePlace).toBe(d.image)
  })

  it('ActivationData_WithAllFields_ParsesAllFields', () => {
    const d = of(ActivationData, 'MonsterActivationA', {
      ability: 'Attacks',
      minion: 'Minions act',
      master: 'Master acts',
      movebutton: 'Move',
      move: 'It moves',
      masterfirst: 'true',
      minionfirst: 'True',
    })

    expect(d.ability.fullKey).toBe('Attacks')
    expect(d.minionActions.fullKey).toBe('Minions act')
    expect(d.masterActions.fullKey).toBe('Master acts')
    expect(d.moveButton.fullKey).toBe('Move')
    expect(d.move.fullKey).toBe('It moves')
    // bool.TryParse is case-insensitive.
    expect(d.masterFirst).toBe(true)
    expect(d.minionFirst).toBe(true)
  })

  it('ActivationData rejects non-boolean flags', () => {
    expect(of(ActivationData, 'MonsterActivationA', { masterfirst: 'yes' }).masterFirst).toBe(false)
  })

  it('AttackData / EvadeData / HorrorData parse their fields', () => {
    expect(
      of(AttackData, 'AttackBash', { text: 't', target: 'human', attacktype: 'heavy' }),
    ).toEqual(expect.objectContaining({ target: 'human', attackType: 'heavy' }))
    expect(of(EvadeData, 'EvadeRun', { monster: 'MonsterZombie' }).monster).toBe('MonsterZombie')
    expect(of(HorrorData, 'HorrorFear', { monster: 'MonsterZombie' }).monster).toBe('MonsterZombie')
  })

  it('AudioData resolves a relative file', () => {
    expect(of(AudioData, 'AudioTheme', { file: 'song.ogg' }).file).toBe('/pack/song.ogg')
  })

  it('PuzzleData is a plain GenericData', () => {
    expect(of(PuzzleData, 'PuzzleSlide').sectionName).toBe('PuzzleSlide')
  })
})

describe('TileSideData', () => {
  const tile = (o: Record<string, string>, ctx = context) =>
    new TileSideData('TileSideRoom', fields(o), '/pack', null, ctx)

  it('defaults pxPerSquare to the game type scale', () => {
    expect(tile({}).pxPerSquare).toBe(105)
  })

  it('reads an absolute pps', () => {
    expect(tile({ pps: '200' }).pxPerSquare).toBe(200)
  })

  it('treats a leading * as a multiplier of the game type scale', () => {
    expect(tile({ pps: '*2' }).pxPerSquare).toBe(210)
    expect(tile({ pps: '*0.5' }).pxPerSquare).toBe(52.5)
  })

  it('parses top, left and aspect', () => {
    const d = tile({ top: '1.5', left: '-2.25', aspect: '1.33' })

    expect(d.top).toBe(1.5)
    expect(d.left).toBe(-2.25)
    expect(d.aspect).toBeCloseTo(1.33, 5)
  })

  it('rejects a comma decimal separator (NumberStyles.Float has no AllowThousands)', () => {
    // ContentTypes.cs uses the explicit NumberStyles.Float overload, so "0,5"
    // fails and the field stays 0 — unlike the bare TryParse used elsewhere,
    // which would read it as 5. See docs/content-port-deviations.md.
    expect(tile({ top: '0,5' }).top).toBe(0)
  })

  it('carries the reverse side name', () => {
    expect(tile({ reverse: 'TileSideOther' }).reverse).toBe('TileSideOther')
  })
})

describe('TokenData', () => {
  const token = (o: Record<string, string>, ctx = context) =>
    new TokenData('TokenSearch', fields(o), '/pack', null, ctx)

  it('parses position and crop', () => {
    const d = token({ x: '10', y: '20', height: '32', width: '64', pps: '50' })

    expect([d.x, d.y, d.height, d.width, d.pxPerSquare]).toEqual([10, 20, 32, 64, 50])
  })

  it('ignores the android offsets on desktop', () => {
    expect(token({ x: '1', y: '2', x_android: '5', y_android: '6' }).x).toBe(1)
  })

  it('prefers the android offsets on android', () => {
    const android = headlessContext({ isAndroid: true })
    const d = token({ x: '1', y: '2', x_android: '5', y_android: '6' }, android)

    expect([d.x, d.y]).toEqual([5, 6])
  })

  it('falls back to the desktop offset when the android one is absent', () => {
    const android = headlessContext({ isAndroid: true })

    expect(token({ x: '1', y_android: '6' }, android).x).toBe(1)
  })

  it('fullImage is true unless both height and width are set', () => {
    expect(token({}).fullImage()).toBe(true)
    expect(token({ height: '0', width: '5' }).fullImage()).toBe(true)
    expect(token({ height: '5', width: '0' }).fullImage()).toBe(true)
    expect(token({ height: '5', width: '5' }).fullImage()).toBe(false)
  })

  it('throws when height is declared without width (PRESERVED BUG)', () => {
    // The C# guards the width parse with ContainsKey("height") and then indexes
    // content["width"], throwing KeyNotFoundException. No shipped content hits
    // it, but community content could.
    expect(() => token({ height: '32' })).toThrow(RangeError)
  })

  it('never reads width when height is absent (PRESERVED BUG)', () => {
    expect(token({ width: '64' }).width).toBe(0)
  })

  it('ImageData is a TokenData with its own registry bucket', () => {
    const image = new ImageData(
      'ImageBanner',
      fields({ height: '1', width: '2' }),
      '/p',
      null,
      context,
    )

    expect(image).toBeInstanceOf(TokenData)
    expect(image.sectionName).toBe('ImageBanner')
  })
})

describe('ContentData registry', () => {
  let cd: ContentData

  const hero = (name: string, priority = 0, sets: string[] = ['base']) =>
    new HeroData(name, fields({ priority: String(priority) }), '/pack', sets, context)

  beforeEach(() => {
    cd = new ContentData(context)
  })

  it('stores and retrieves by type', () => {
    cd.addOrReplace(HeroData, 'HeroA', hero('HeroA'))

    expect(cd.get(HeroData, 'HeroA').sectionName).toBe('HeroA')
    expect(cd.containsKey(HeroData, 'HeroA')).toBe(true)
    expect(cd.count(HeroData)).toBe(1)
    expect(cd.keys(HeroData)).toEqual(['HeroA'])
    expect(cd.values(HeroData)).toHaveLength(1)
    expect(cd.getAll(HeroData)).toHaveLength(1)
  })

  it('returns undefined for a missing key and throws on get', () => {
    expect(cd.tryGet(HeroData, 'nope')).toBeUndefined()
    expect(() => cd.get(HeroData, 'nope')).toThrow(RangeError)
  })

  it('keeps types in separate buckets', () => {
    cd.addOrReplace(HeroData, 'X', hero('X'))

    expect(cd.containsKey(MonsterData, 'X')).toBe(false)
  })

  it('replaces on higher priority', () => {
    cd.addContent(HeroData, 'H', hero('Low', 1))
    const isNew = cd.addContent(HeroData, 'H', hero('High', 2))

    expect(isNew).toBe(true)
    expect(cd.get(HeroData, 'H').sectionName).toBe('High')
  })

  it('ignores lower priority', () => {
    cd.addContent(HeroData, 'H', hero('High', 2))
    const isNew = cd.addContent(HeroData, 'H', hero('Low', 1))

    expect(isNew).toBe(false)
    expect(cd.get(HeroData, 'H').sectionName).toBe('High')
  })

  it('merges sets at equal priority and keeps the first entry', () => {
    cd.addContent(HeroData, 'H', hero('First', 0, ['packA']))
    const isNew = cd.addContent(HeroData, 'H', hero('Second', 0, ['packB']))

    expect(isNew).toBe(false)
    expect(cd.get(HeroData, 'H').sectionName).toBe('First')
    expect(cd.get(HeroData, 'H').sets).toEqual(['packA', 'packB'])
  })
})

describe('ContentData pack lookups', () => {
  const makePack = (id: string, name: string) => ({
    id,
    name,
    type: '',
    image: '',
    icon: null,
    description: '',
    iniFiles: [],
    localizationFiles: new Map<string, string[]>(),
    clone: [],
  })

  it('GetContentName_CustomContentPack_NoTranslation_ReturnsTranslatedOrPlain', () => {
    const cd = new ContentData(context)
    cd.addPack(makePack('SOTP', 'Sands ofthe Past Content Pack'))

    expect(cd.getContentName('SOTP')).toBe('Sands ofthe Past Content Pack')
  })

  it('GetContentName_OfficialPack_WithTranslation_ReturnsTranslated', () => {
    const localization = new Localization()
    localization.addDictionary('pck', new DictionaryI18n(['.,English', 'BOXED,Boxed Content']))
    const cd = new ContentData(headlessContext({ localization }))
    cd.addPack(makePack('BOX', '{pck:BOXED}'))

    expect(cd.getContentName('BOX')).toBe('Boxed Content')
  })

  it('falls back to the pck dictionary for a plain id', () => {
    const localization = new Localization()
    localization.addDictionary('pck', new DictionaryI18n(['.,English', 'BOXED,Boxed Content']))
    const cd = new ContentData(headlessContext({ localization }))
    cd.addPack(makePack('BOX', 'BOXED'))

    expect(cd.getContentName('BOX')).toBe('Boxed Content')
  })

  it('returns the id for an unknown pack', () => {
    expect(new ContentData(context).getContentName('nope')).toBe('nope')
    expect(new ContentData(context).getContentAcronym('nope')).toBe('')
    expect(new ContentData(context).getContentSymbol('nope')).toBe('')
  })

  it('replaces a pack of the same id and registers its symbol', () => {
    const cd = new ContentData(context)
    cd.addPack(makePack('X', 'First'))
    cd.addPack(makePack('X', 'Second'))

    expect(cd.allPacks).toHaveLength(1)
    expect(cd.getPacks()).toEqual(['Second'])
    expect(cd.packSymbolDict.get('X')!.fullKey).toBe('{val:X_SYMBOL}')
  })

  it('removes a pack', () => {
    const cd = new ContentData(context)
    cd.addPack(makePack('X', 'X'))
    cd.removePack('X')

    expect(cd.allPacks).toHaveLength(0)
    expect(cd.packSymbolDict.has('X')).toBe(false)
    expect(cd.getPackById('X')).toBeNull()
  })
})

describe('parseContentPack', () => {
  const parse = (text: string, options = {}) =>
    parseContentPack(readFromString(text), { path: '/pack', importPath: '/import', ...options })

  it('parses every field', () => {
    const pack = parse(
      [
        '[ContentPack]',
        'name=Base Game',
        'id=base',
        'type=D2E',
        'image=cover.png',
        'icon=icon.png',
        'description=The base game',
        'clone=extra1 extra2',
        '[ContentPackData]',
        'heros.ini',
        '[LanguageData]',
        'val Localization.English.txt',
        'val Localization.French.txt',
      ].join('\n'),
    )!

    expect(pack.name).toBe('Base Game')
    expect(pack.id).toBe('base')
    expect(pack.image).toBe('/pack/cover.png')
    expect(pack.icon).toBe('/pack/icon.png')
    expect(pack.clone).toEqual(['extra1', 'extra2'])
    expect(pack.iniFiles).toEqual(['/pack/content_pack.ini', '/pack/heros.ini'])
    expect(pack.localizationFiles.get('val')).toEqual([
      '/pack/Localization.English.txt',
      '/pack/Localization.French.txt',
    ])
  })

  it('leaves icon null when absent or blank', () => {
    expect(parse('[ContentPack]\nname=X')!.icon).toBeNull()
    expect(parse('[ContentPack]\nname=X\nicon=   ')!.icon).toBeNull()
  })

  it('keeps the trailing separator when no image is declared', () => {
    // Plain concatenation, not Path.Combine.
    expect(parse('[ContentPack]\nname=X')!.image).toBe('/pack/')
  })

  it('resolves an {import} image', () => {
    expect(parse('[ContentPack]\nname=X\nimage={import}/cover.png')!.image).toBe(
      '/import/cover.png',
    )
  })

  it('accepts a pack whose type matches the required game type', () => {
    expect(parse('[ContentPack]\nname=X\ntype=D2EBase', { requireGameType: 'D2E' })).not.toBeNull()
  })

  it('rejects a pack of the wrong game type', () => {
    expect(parse('[ContentPack]\nname=X\ntype=MoM', { requireGameType: 'D2E' })).toBeNull()
    expect(parse('[ContentPack]\nname=X', { requireGameType: 'D2E' })).toBeNull()
  })

  it('throws rather than quitting the app when the name is missing (DEVIATION)', () => {
    // The C# calls Application.Quit() from inside the parser.
    expect(() => parse('[ContentPack]\nid=x')).toThrow(RangeError)
  })
})

describe('ContentLoader', () => {
  let cd: ContentData
  let loader: ContentLoader

  beforeEach(() => {
    cd = new ContentData(context)
    loader = new ContentLoader(cd, context)
  })

  it('routes a section to the loader whose prefix matches', () => {
    loader.loadSection('HeroFoo', fields({ name: 'Foo' }), '/pack', 'base')

    expect(cd.count(HeroData)).toBe(1)
  })

  it('ignores a section no loader claims', () => {
    expect(loader.loadSection('UnknownThing', fields({}), '/pack', 'base')).toBeNull()
  })

  it('skips a token with no resolvable image', () => {
    loader.loadSection('TokenNoImage', fields({ x: '1' }), '/pack', 'base')

    expect(cd.count(TokenData)).toBe(0)
  })

  it('keeps Image and Token in separate buckets, with different image rules', () => {
    loader.loadIni(readFromString('[ImageX]\nimage=x.png\n[TokenY]\nimage=y.png'), '/p', 'base')

    // Only the Token loader drops entries whose image does not resolve. Image
    // sections are kept regardless, even though ImageData extends TokenData —
    // the guard lives in the loader, not the type.
    expect(cd.count(TokenData)).toBe(0)
    expect(cd.count(ImageData)).toBe(1)
  })

  it('loads a whole ini and records the pack id as the set', () => {
    loader.loadIni(readFromString('[HeroA]\nname=A\n[MonsterB]\nhealth=3'), '/p', 'packX')

    expect(cd.get(HeroData, 'HeroA').sets).toEqual(['packX'])
    expect(cd.get(MonsterData, 'MonsterB').healthBase).toBe(3)
  })

  it('tracks which packs are loaded', () => {
    const pack = {
      id: 'p1',
      name: 'p1',
      type: '',
      image: '',
      icon: null,
      description: '',
      iniFiles: [],
      localizationFiles: new Map<string, string[]>(),
      clone: [],
    }

    expect(loader.isLoaded(pack)).toBe(false)
    loader.markPackLoaded(pack)
    expect(loader.isLoaded(pack)).toBe(true)
    expect(cd.getLoadedPackIDs()).toEqual(['p1'])
  })
})

describe('path helpers', () => {
  it('combinePath follows Path.Combine', () => {
    expect(combinePath('/a', 'b')).toBe('/a/b')
    expect(combinePath('/a', '')).toBe('/a')
    expect(combinePath('/a/', 'b')).toBe('/a/b')
    expect(combinePath('/a', '/b')).toBe('/b')
    expect(combinePath('', 'b')).toBe('b')
  })

  it('concatPath always inserts a separator', () => {
    expect(concatPath('/a', 'b')).toBe('/a/b')
    expect(concatPath('/a', '')).toBe('/a/')
  })
})

describe('FormatVersions', () => {
  it('reports the current quest format', () => {
    expect(CURRENT_QUEST_FORMAT).toBe(QuestFormatVersions.RELEASE_3_2_0)
    expect(CURRENT_QUEST_FORMAT).toBe(21)
  })

  it('matches conversion-kit scenarios case-insensitively', () => {
    expect(requiresConversionKit('HolyMansion')).toBe(true)
    expect(requiresConversionKit('holymansion')).toBe(true)
    expect(requiresConversionKit('HOLYMANSION')).toBe(true)
    expect(requiresConversionKit('SomethingElse')).toBe(false)
  })
})
