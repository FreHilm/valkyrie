/**
 * Port of `unity/Assets/Scripts/Content/ContentTypes.cs`.
 *
 * Every content entry parsed from a `[Type...]` section of a content pack ini.
 *
 * `PerilData` is **not** here: it extends `QuestData.Event`, so it arrives with
 * T-008. `ContentLoader` takes its loader list as a parameter for that reason.
 */

import { parseFloatStrict, parseIntInvariant } from '../config/parse.js'
import { StringKey } from '../i18n/StringKey.js'
import type { ContentContext } from './context.js'
import { combinePath, concatPath } from './context.js'

/** Common shape of everything the content registry stores. */
export interface IContent {
  readonly priority: number
  readonly translationKey: StringKey
  readonly sectionName: string
  /** Content pack ids this entry belongs to. Mutated when packs are merged. */
  readonly sets: string[]
}

export type ContentFields = ReadonlyMap<string, string>

/** C# `int.TryParse(s, out v)` leaves v at 0 on failure. */
function intOrZero(value: string | undefined): number {
  if (value === undefined) return 0
  return parseIntInvariant(value) ?? 0
}

/**
 * C# `float.TryParse(s, NumberStyles.Float, InvariantCulture, out v)` leaves v
 * at 0 on failure. Note the explicit style: no group separators, so "0,5" is
 * rejected rather than read as 5.
 */
function floatOrZero(value: string | undefined): number {
  if (value === undefined) return 0
  return parseFloatStrict(value) ?? 0
}

/** C# `bool.TryParse(s, out v)` leaves v at false. */
function boolOrFalse(value: string | undefined): boolean {
  if (value === undefined) return false
  const trimmed = value.trim().toLowerCase()
  return trimmed === 'true'
}

/** C# `s.Split(' ')` — keeps empty segments. */
function splitKeepEmpty(value: string): string[] {
  return value.split(' ')
}

/** C# `s.Split(' ', RemoveEmptyEntries)`. */
function splitDropEmpty(value: string): string[] {
  return value.split(' ').filter((part) => part.length > 0)
}

/**
 * Resolves an `{import}`-prefixed value the way `GenericData`'s image loop
 * does: drop the marker *and* the separator after it, then Path.Combine.
 */
function importedImage(value: string, path: string, importPath: string): string {
  if (value.startsWith('{import}')) return combinePath(importPath, value.slice(9))
  return combinePath(path, value)
}

/**
 * Resolves an `{import}`-prefixed value the way `imageplace`, `file` and the
 * content pack image do: drop only the marker, then concatenate. The remainder
 * still carries its leading separator, so the result matches
 * {@link importedImage} — the two spellings differ but agree.
 */
function importedAsset(value: string, path: string, importPath: string): string {
  // Plain concatenation: the remainder still carries its leading separator.
  if (value.startsWith('{import}')) return importPath + value.slice(8)
  return concatPath(path, value)
}

/** Base class for all content-pack entries. Port of `GenericData`. */
export class GenericData implements IContent {
  name: StringKey = StringKey.NULL
  readonly sets: string[]
  readonly sectionName: string
  traits: string[] = []
  image = ''
  protected priorityValue = 0

  static readonly type: string = ''

  get priority(): number {
    return this.priorityValue
  }

  get translationKey(): StringKey {
    return this.name
  }

  constructor(
    sectionName: string,
    content: ContentFields,
    path: string,
    type: string,
    sets: string[] | null,
    context: ContentContext,
  ) {
    this.sectionName = sectionName
    this.sets = sets ?? []

    const declaredName = content.get('name')
    if (declaredName !== undefined) {
      this.name = StringKey.parse(declaredName, context.localization)
    } else {
      // Callers sometimes pass a section name without the type prefix (a dummy
      // TileSide built from a file path, for instance), so the strip is guarded.
      let displayName = sectionName
      if (type.length > 0 && displayName.length > type.length && displayName.startsWith(type)) {
        displayName = displayName.slice(type.length)
      }
      this.name = new StringKey(null, displayName)
    }

    this.priorityValue = intOrZero(content.get('priority'))

    const traits = content.get('traits')
    this.traits = traits === undefined ? [] : splitKeepEmpty(traits)

    // Images may be listed as image, image2, image3... and the first one that
    // actually resolves to a file wins. With no filesystem nothing resolves, so
    // the loop settles on the last declared variant.
    let count = 0
    for (;;) {
      const key = count > 0 ? `image${count + 1}` : 'image'
      const declared = content.get(key)
      if (declared === undefined) {
        this.image = ''
        break
      }
      this.image = importedImage(declared, path, context.importPath)
      if (context.resolveTextureFile(this.image) !== null) break
      count++
    }
  }

  containsTrait(trait: string): boolean {
    return this.traits.includes(trait)
  }
}

export class PackTypeData extends GenericData {
  static override readonly type: string = 'PackType'

  constructor(
    name: string,
    content: ContentFields,
    path: string,
    sets: string[] | null,
    context: ContentContext,
  ) {
    super(name, content, path, PackTypeData.type, sets, context)
  }
}

export class TileSideData extends GenericData {
  static override readonly type: string = 'TileSide'

  top = 0
  left = 0
  pxPerSquare: number
  aspect = 0
  reverse = ''

  constructor(
    name: string,
    content: ContentFields,
    path: string,
    sets: string[] | null,
    context: ContentContext,
  ) {
    super(name, content, path, TileSideData.type, sets, context)

    this.top = floatOrZero(content.get('top'))
    this.left = floatOrZero(content.get('left'))

    const pps = content.get('pps')
    if (pps === undefined) {
      this.pxPerSquare = context.tilePixelPerSquare
    } else if (pps.startsWith('*')) {
      // A leading '*' makes the value a multiplier of the game type's scale.
      this.pxPerSquare = floatOrZero(pps.slice(1)) * context.tilePixelPerSquare
    } else {
      this.pxPerSquare = floatOrZero(pps)
    }

    this.aspect = floatOrZero(content.get('aspect'))
    this.reverse = content.get('reverse') ?? ''
  }
}

export class HeroData extends GenericData {
  static override readonly type: string = 'Hero'

  archetype = 'warrior'
  item = ''

  constructor(
    name: string,
    content: ContentFields,
    path: string,
    sets: string[] | null,
    context: ContentContext,
  ) {
    super(name, content, path, HeroData.type, sets, context)
    this.archetype = content.get('archetype') ?? this.archetype
    this.item = content.get('item') ?? this.item
  }
}

export class ClassData extends GenericData {
  static override readonly type: string = 'Class'

  archetype = 'warrior'
  hybridArchetype = ''
  items: string[] = []

  constructor(
    name: string,
    content: ContentFields,
    path: string,
    sets: string[] | null,
    context: ContentContext,
  ) {
    super(name, content, path, ClassData.type, sets, context)
    this.archetype = content.get('archetype') ?? this.archetype
    this.hybridArchetype = content.get('hybridarchetype') ?? this.hybridArchetype

    const items = content.get('items')
    this.items = items === undefined ? [] : splitDropEmpty(items)
  }
}

export class SkillData extends GenericData {
  static override readonly type: string = 'Skill'

  xp = 0

  constructor(
    name: string,
    content: ContentFields,
    path: string,
    sets: string[] | null,
    context: ContentContext,
  ) {
    super(name, content, path, SkillData.type, sets, context)
    this.xp = intOrZero(content.get('xp'))
  }
}

const FAME_LEVELS = new Map([
  ['insignificant', 1],
  ['noteworthy', 2],
  ['impressive', 3],
  ['celebrated', 4],
  ['heroic', 5],
  ['legendary', 6],
])

export class ItemData extends GenericData {
  static override readonly type: string = 'Item'

  unique = false
  price = 0
  minFame = -1
  maxFame = -1

  constructor(
    name: string,
    content: ContentFields,
    path: string,
    sets: string[] | null,
    context: ContentContext,
  ) {
    super(name, content, path, ItemData.type, sets, context)

    this.unique = name.startsWith('ItemUnique')
    this.price = intOrZero(content.get('price'))

    const minFame = content.get('minfame')
    if (minFame !== undefined) this.minFame = ItemData.fame(minFame)
    const maxFame = content.get('maxfame')
    if (maxFame !== undefined) this.maxFame = ItemData.fame(maxFame)
  }

  static fame(name: string): number {
    return FAME_LEVELS.get(name) ?? 0
  }
}

export class MonsterData extends GenericData {
  static override readonly type: string = 'Monster'

  info: StringKey = new StringKey(null, '-', false)
  imagePlace = ''
  activations: string[] = []
  healthBase = 0
  healthPerHero = 0
  horror = 0
  awareness = 0

  constructor(
    name: string,
    content: ContentFields,
    path: string,
    sets: string[] | null,
    context: ContentContext,
  ) {
    super(name, content, path, MonsterData.type, sets, context)

    const info = content.get('info')
    if (info !== undefined) this.info = StringKey.parse(info, context.localization)

    const imagePlace = content.get('imageplace')
    this.imagePlace =
      imagePlace === undefined ? this.image : importedAsset(imagePlace, path, context.importPath)

    const activation = content.get('activation')
    this.activations = activation === undefined ? [] : splitKeepEmpty(activation)

    this.healthBase = floatOrZero(content.get('health'))
    this.healthPerHero = floatOrZero(content.get('healthperhero'))
    this.horror = intOrZero(content.get('horror'))
    this.awareness = intOrZero(content.get('awareness'))
  }
}

export class ActivationData extends GenericData {
  static override readonly type: string = 'MonsterActivation'

  ability: StringKey = new StringKey(null, '-', false)
  minionActions: StringKey = StringKey.NULL
  masterActions: StringKey = StringKey.NULL
  moveButton: StringKey = StringKey.NULL
  move: StringKey = StringKey.NULL
  masterFirst = false
  minionFirst = false

  constructor(
    name: string,
    content: ContentFields,
    path: string,
    sets: string[] | null,
    context: ContentContext,
  ) {
    super(name, content, path, ActivationData.type, sets, context)

    const ability = content.get('ability')
    if (ability !== undefined) this.ability = StringKey.parse(ability, context.localization)
    const minion = content.get('minion')
    if (minion !== undefined) this.minionActions = StringKey.parse(minion, context.localization)
    const master = content.get('master')
    if (master !== undefined) this.masterActions = StringKey.parse(master, context.localization)
    const moveButton = content.get('movebutton')
    if (moveButton !== undefined)
      this.moveButton = StringKey.parse(moveButton, context.localization)
    const move = content.get('move')
    if (move !== undefined) this.move = StringKey.parse(move, context.localization)

    this.masterFirst = boolOrFalse(content.get('masterfirst'))
    this.minionFirst = boolOrFalse(content.get('minionfirst'))
  }
}

export class TokenData extends GenericData {
  static override readonly type: string = 'Token'

  x = 0
  y = 0
  height = 0
  width = 0
  /** 0 means the token is one square across. */
  pxPerSquare = 0

  constructor(
    name: string,
    content: ContentFields,
    path: string,
    sets: string[] | null,
    context: ContentContext,
    type: string = TokenData.type,
  ) {
    super(name, content, path, type, sets, context)

    const androidX = context.isAndroid ? content.get('x_android') : undefined
    this.x = intOrZero(androidX ?? content.get('x'))

    const androidY = context.isAndroid ? content.get('y_android') : undefined
    this.y = intOrZero(androidY ?? content.get('y'))

    // These crop a region out of an atlas image.
    if (content.has('height')) {
      this.height = intOrZero(content.get('height'))
      // PRESERVED BUG: the C# guards the width parse with ContainsKey("height")
      // and then indexes content["width"], so a section declaring height but
      // not width throws KeyNotFoundException, and one declaring width but not
      // height never reads it. No shipped content hits either case.
      // See docs/content-port-deviations.md.
      if (!content.has('width')) {
        throw new RangeError(`Content "${name}" declares height but not width`)
      }
      this.width = intOrZero(content.get('width'))
    }

    this.pxPerSquare = floatOrZero(content.get('pps'))
  }

  fullImage(): boolean {
    return this.height === 0 || this.width === 0
  }
}

export class ImageData extends TokenData {
  static override readonly type: string = 'Image'

  constructor(
    name: string,
    content: ContentFields,
    path: string,
    sets: string[] | null,
    context: ContentContext,
  ) {
    super(name, content, path, sets, context, ImageData.type)
  }
}

export class AttackData extends GenericData {
  static override readonly type: string = 'Attack'

  text: StringKey = StringKey.NULL
  /** Target type: human, spirit, ... */
  target = ''
  /** Attack type: heavy, unarmed, ... */
  attackType = ''

  constructor(
    name: string,
    content: ContentFields,
    path: string,
    sets: string[] | null,
    context: ContentContext,
  ) {
    super(name, content, path, AttackData.type, sets, context)

    const text = content.get('text')
    if (text !== undefined) this.text = StringKey.parse(text, context.localization)
    this.target = content.get('target') ?? ''
    this.attackType = content.get('attacktype') ?? ''
  }
}

export class EvadeData extends GenericData {
  static override readonly type: string = 'Evade'

  text: StringKey = StringKey.NULL
  monster = ''

  constructor(
    name: string,
    content: ContentFields,
    path: string,
    sets: string[] | null,
    context: ContentContext,
  ) {
    super(name, content, path, EvadeData.type, sets, context)

    const text = content.get('text')
    if (text !== undefined) this.text = StringKey.parse(text, context.localization)
    this.monster = content.get('monster') ?? ''
  }
}

export class HorrorData extends GenericData {
  static override readonly type: string = 'Horror'

  text: StringKey = StringKey.NULL
  monster = ''

  constructor(
    name: string,
    content: ContentFields,
    path: string,
    sets: string[] | null,
    context: ContentContext,
  ) {
    super(name, content, path, HorrorData.type, sets, context)

    const text = content.get('text')
    if (text !== undefined) this.text = StringKey.parse(text, context.localization)
    this.monster = content.get('monster') ?? ''
  }
}

export class PuzzleData extends GenericData {
  static override readonly type: string = 'Puzzle'

  constructor(
    name: string,
    content: ContentFields,
    path: string,
    sets: string[] | null,
    context: ContentContext,
  ) {
    super(name, content, path, PuzzleData.type, sets, context)
  }
}

export class AudioData extends GenericData {
  static override readonly type: string = 'Audio'

  file = ''

  constructor(
    name: string,
    content: ContentFields,
    path: string,
    sets: string[] | null,
    context: ContentContext,
  ) {
    super(name, content, path, AudioData.type, sets, context)

    const file = content.get('file')
    if (file !== undefined) this.file = importedAsset(file, path, context.importPath)
  }
}
