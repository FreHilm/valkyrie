/**
 * Port of `QuestData.Quest` and the section dispatch in `QuestData.cs`.
 *
 * `Quest` is the scenario's metadata — format version, required packs, hero
 * counts, per-language names. `loadQuestSections` turns already-read ini data
 * into the component map.
 *
 * File reading and localization-file loading stay with the platform layer
 * (T-011); this module works from parsed `IniData`.
 */

import { parseFloatInvariant, parseIntInvariant } from '../config/parse.js'
import {
  CURRENT_QUEST_FORMAT,
  QuestFormatVersions,
  SCENARIOS_THAT_REQUIRE_CONVERSION_KIT,
} from '../content/FormatVersions.js'
import type { ContentFields } from '../content/types.js'
import { StringKey } from '../i18n/StringKey.js'
import type { IniData } from '../ini/IniData.js'
import { log } from '../ini/logger.js'
import {
  Activation,
  CustomMonster,
  Door,
  MPlace,
  Puzzle,
  QItem,
  QuestComponent,
  QuestEvent,
  QuestUI,
  Spawn,
  Tile,
  Token,
} from './QuestComponent.js'
import type { QuestContext } from './QuestComponent.js'

export const MINIMUM_QUEST_FORMAT = 4

/** Host values `Quest` needs that used to come from a live `Game`. */
export interface QuestLoaderContext {
  gameType: string
  maxHeroes: number
  defaultHeroes: number
  currentLang: string
  isMoM: boolean
}

export const DEFAULT_LOADER_CONTEXT: QuestLoaderContext = {
  gameType: 'D2E',
  maxHeroes: 4,
  defaultHeroes: 4,
  currentLang: 'English',
  isMoM: false,
}

const intOrZero = (value: string | undefined) =>
  value === undefined ? 0 : (parseIntInvariant(value) ?? 0)
const boolOrFalse = (value: string | undefined) =>
  value !== undefined && value.trim().toLowerCase() === 'true'

/** Expansions that a shorthand pack id stands for. */
const PACK_EXPANSIONS = new Map<string, string[]>([
  ['MoM1E', ['MoM1ET', 'MoM1EI', 'MoM1EM']],
  ['FA', ['FAT', 'FAI', 'FAM']],
  ['CotW', ['CotWT', 'CotWI', 'CotWM']],
])

export class Quest {
  format = 0
  hidden = false
  valid = false
  path = ''
  identifier = ''
  type = ''
  packs: string[] = []
  defaultLanguage = 'English'
  defaultMusicOn = false
  image = ''
  minHero = 2
  maxHero = 5
  difficulty = 0
  lengthMin = 0
  lengthMax = 0
  version = ''
  languagesName = new Map<string, string>()
  languagesSynopsys = new Map<string, string>()
  languagesAuthorsShort = new Map<string, string>()

  constructor(
    identifier: string,
    iniData: ContentFields,
    private readonly context: QuestLoaderContext = DEFAULT_LOADER_CONTEXT,
  ) {
    this.identifier = identifier.toLowerCase()
    // maxHero is only taken from the context inside populate, so an invalid
    // quest keeps the declared default of 5 rather than the game's.
    this.valid = this.populate(iniData)
  }

  get name(): StringKey {
    return new StringKey('qst', 'quest.name')
  }

  get description(): StringKey {
    return new StringKey('qst', 'quest.description')
  }

  get synopsys(): StringKey {
    return new StringKey('qst', 'quest.synopsys')
  }

  get authors(): StringKey {
    return new StringKey('qst', 'quest.authors')
  }

  get authorsShort(): StringKey {
    return new StringKey('qst', 'quest.authors_short')
  }

  private populate(iniData: ContentFields): boolean {
    this.format = intOrZero(iniData.get('format'))

    if (this.format > CURRENT_QUEST_FORMAT || this.format < MINIMUM_QUEST_FORMAT) {
      log(
        `Quest ${this.identifier} has an unknown format: ${this.format}, expected between ${MINIMUM_QUEST_FORMAT} and ${CURRENT_QUEST_FORMAT}`,
      )
      return false
    }

    this.type = iniData.get('type') ?? ''

    // Sorted, because the C# collects into a SortedSet.
    const requiredPacks = new Set<string>()

    // Scenarios written before the base/conversion-kit split need the kit.
    if (
      this.context.isMoM &&
      this.format < QuestFormatVersions.SPLIT_BASE_MOM_AND_CONVERSION_KIT &&
      SCENARIOS_THAT_REQUIRE_CONVERSION_KIT.has(this.identifier)
    ) {
      requiredPacks.add('MoM1CK')
    }

    const packs = iniData.get('packs')
    if (packs !== undefined) {
      for (const pack of packs.split(' ').filter((s) => s.length > 0)) {
        const expansion = PACK_EXPANSIONS.get(pack)
        if (expansion === undefined) requiredPacks.add(pack)
        else for (const part of expansion) requiredPacks.add(part)
      }
    }
    this.packs = [...requiredPacks].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

    this.defaultLanguage = iniData.get('defaultlanguage') ?? this.defaultLanguage

    // Absent means on; present means whatever it says.
    this.defaultMusicOn = iniData.has('defaultmusicon')
      ? boolOrFalse(iniData.get('defaultmusicon'))
      : true

    this.hidden = boolOrFalse(iniData.get('hidden'))

    if (iniData.has('minhero')) this.minHero = intOrZero(iniData.get('minhero'))
    if (this.minHero < 1) this.minHero = 1

    this.maxHero = this.context.defaultHeroes
    if (iniData.has('maxhero')) this.maxHero = intOrZero(iniData.get('maxhero'))
    if (this.maxHero > this.context.maxHeroes) this.maxHero = this.context.maxHeroes

    // Note: the C# uses the bare float.TryParse overload here, unlike
    // ContentTypes.cs — so a comma group separator is accepted.
    const difficulty = iniData.get('difficulty')
    if (difficulty !== undefined) this.difficulty = parseFloatInvariant(difficulty) ?? 0

    this.lengthMin = intOrZero(iniData.get('lengthmin'))
    this.lengthMax = intOrZero(iniData.get('lengthmax'))

    const image = iniData.get('image')
    if (image !== undefined) this.image = image.replace(/\\/g, '/')

    this.version = iniData.get('version') ?? ''

    this.languagesName = collectLanguageVariants(iniData, 'name.', this.defaultLanguage)
    this.languagesSynopsys = collectLanguageVariants(iniData, 'synopsys.', this.defaultLanguage)
    this.languagesAuthorsShort = collectLanguageVariants(
      iniData,
      'authors_short.',
      this.defaultLanguage,
    )

    return true
  }
}

/**
 * Collects `name.English`, `name.German`, ... into a language map.
 *
 * Only populated when the default language's variant is present, and the C#
 * matches with `Contains` rather than `StartsWith`, so a key that merely
 * contains the prefix anywhere is picked up too. Preserved.
 */
function collectLanguageVariants(
  iniData: ContentFields,
  prefix: string,
  defaultLanguage: string,
): Map<string, string> {
  const result = new Map<string, string>()
  if (!iniData.has(prefix + defaultLanguage)) return result

  for (const [key, value] of iniData) {
    if (key.includes(prefix)) result.set(key.slice(prefix.length), value)
  }
  return result
}

/** Section-name prefix to the component it builds. Order matches the C#. */
type ComponentFactory = (
  name: string,
  content: ContentFields,
  source: string,
  format: number,
  context: QuestContext,
) => QuestComponent

const COMPONENT_FACTORIES: [prefix: string, build: ComponentFactory][] = [
  [Tile.type, (n, c, s) => new Tile(n, c, s)],
  [Door.type, (n, c, s, f, x) => new Door(n, c, s, f, x)],
  [Token.type, (n, c, s, f, x) => new Token(n, c, s, f, x)],
  [QuestUI.type, (n, c, s, f, x) => new QuestUI(n, c, s, f, x)],
  [QuestEvent.type, (n, c, s, f, x) => new QuestEvent(n, c, s, f, x)],
  [Spawn.type, (n, c, s, f, x) => new Spawn(n, c, s, f, x)],
  [MPlace.type, (n, c, s) => new MPlace(n, c, s)],
  [QItem.type, (n, c, s) => new QItem(n, c, s)],
  [Puzzle.type, (n, c, s, f, x) => new Puzzle(n, c, s, f, x)],
  [CustomMonster.type, (n, c, s) => new CustomMonster(n, c, s)],
  [Activation.type, (n, c, s) => new Activation(n, c, s)],
]

export interface LoadSectionsOptions {
  format: number
  context?: QuestContext
}

/**
 * Builds the component map from one quest ini.
 *
 * `StartingItem...` sections are renamed to `QItem...` on the way in, which is
 * how the old spelling stays loadable.
 *
 * The C# runs an `if` per type rather than `else if`, so a section matching two
 * prefixes would be added twice and throw. No prefix pair overlaps, so this
 * reproduces the reachable behaviour with a single match.
 */
export function loadQuestSections(
  data: IniData,
  source: string,
  options: LoadSectionsOptions,
  into: Map<string, QuestComponent> = new Map(),
): Map<string, QuestComponent> {
  const context: QuestContext = options.context ?? { maxHeroes: 5 }

  for (const [name, content] of data.data) {
    let sectionName = name
    let matched: ComponentFactory | undefined

    for (const [prefix, build] of COMPONENT_FACTORIES) {
      if (name.startsWith(prefix)) {
        matched = build
        break
      }
    }

    if (matched === undefined && name.startsWith('StartingItem')) {
      sectionName = `QItem${name.slice('StartingItem'.length)}`
      matched = (n, c, s) => new QItem(n, c, s)
    }

    if (matched === undefined) continue

    if (into.has(sectionName)) {
      // DEVIATION: the C# calls Application.Quit() on a duplicate section.
      throw new RangeError(`Duplicate component in quest: ${sectionName}`)
    }

    into.set(sectionName, matched(sectionName, content, source, options.format, context))
  }

  return into
}
