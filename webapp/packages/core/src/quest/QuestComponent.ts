/**
 * Port of the component classes in `unity/Assets/Scripts/Content/QuestData.cs`.
 *
 * These define the schema every published scenario is written against, so
 * fidelity matters more here than anywhere else in the port: there is no way
 * to migrate content that lives in other people's GitHub repositories.
 *
 * Editor-only constructors (`new Tile("name")` and friends) are not ported —
 * they reach into a live `Game` for defaults and belong with T-019.
 */

import { parseFloatStrict, parseIntInvariant } from '../config/parse.js'
import type { ContentFields } from '../content/types.js'
import type { Localization } from '../i18n/Localization.js'
import { StringKey } from '../i18n/StringKey.js'
import { log } from '../ini/logger.js'
import { buttonFromData, QuestButtonData } from './QuestButtonData.js'
import { VarOperation, VarTests, VarTestsLogicalOperator } from './VarTests.js'

/** Values a component reaches for that the host supplies. */
export interface QuestContext {
  localization?: Localization
  /** `gameType.MaxHeroes() + 1` — the number of placement slots a Spawn has. */
  maxHeroes: number
}

export const DEFAULT_QUEST_CONTEXT: QuestContext = { maxHeroes: 5 }

export interface Vector2 {
  x: number
  y: number
}

const splitDropEmpty = (value: string): string[] => value.split(' ').filter((s) => s.length > 0)

/** C# `int.TryParse` with a warning, defaulting to 0. */
export function parseIntLogged(value: string): number {
  const parsed = parseIntInvariant(value)
  if (parsed !== null) return parsed
  if (value.length > 0) log(`Warning: Failed to parse int: ${value}`)
  return 0
}

/** C# `float.TryParse(s, Float, Invariant)` with a warning, defaulting to 0. */
export function parseFloatLogged(value: string): number {
  const parsed = parseFloatStrict(value)
  if (parsed !== null) return parsed
  if (value.length > 0) log(`Warning: Failed to parse float: ${value}`)
  return 0
}

/** C# `bool.TryParse` with a warning, defaulting to false. */
export function parseBoolLogged(value: string): boolean {
  const trimmed = value.trim().toLowerCase()
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (value.length > 0) log(`Warning: Failed to parse bool: ${value}`)
  return false
}

const intOrZero = (value: string | undefined) =>
  value === undefined ? 0 : (parseIntInvariant(value) ?? 0)
const floatOrZero = (value: string | undefined) =>
  value === undefined ? 0 : (parseFloatStrict(value) ?? 0)
const boolOrFalse = (value: string | undefined) =>
  value !== undefined && value.trim().toLowerCase() === 'true'

/** Windows separators in content paths are normalised to '/'. */
const normalisePath = (value: string): string => value.replace(/\\/g, '/')

export class QuestComponent {
  static readonly type: string = ''

  /** Ini file this component came from. */
  source = ''
  location: Vector2 = { x: 0, y: 0 }
  locationSpecified = false
  typeDynamic: string
  readonly sectionName: string
  comment = ''
  tests: VarTests | null = null
  operations: VarOperation[] | null = null

  constructor(
    sectionName: string,
    data: ContentFields,
    source: string,
    format = -1,
    type: string = QuestComponent.type,
  ) {
    this.typeDynamic = type
    this.sectionName = sectionName
    this.source = source

    const xPosition = data.get('xposition')
    if (xPosition !== undefined) {
      this.locationSpecified = true
      this.location.x = floatOrZero(xPosition)
    }
    const yPosition = data.get('yposition')
    if (yPosition !== undefined) {
      this.locationSpecified = true
      this.location.y = floatOrZero(yPosition)
    }

    this.comment = data.get('comment') ?? ''

    this.operations = []
    const operations = data.get('operations')
    if (operations !== undefined) {
      for (const part of splitDropEmpty(operations)) {
        this.operations.push(new VarOperation(part))
      }
    }

    // Before format 9, an "EventEnd..." section implicitly ended the quest.
    if (format <= 8 && sectionName.startsWith('EventEnd')) {
      this.operations.push(new VarOperation('$end,=,1'))
    }

    this.tests = new VarTests()
    const varTests = data.get('vartests')
    const conditions = data.get('conditions')
    if (varTests !== undefined) {
      for (const part of splitDropEmpty(varTests)) this.tests.addFromString(part)
    } else if (conditions !== undefined) {
      // Pre-vartests format: a bare AND-joined list of comparisons.
      let i = 0
      for (const part of splitDropEmpty(conditions)) {
        if (i > 0) this.tests.add(new VarTestsLogicalOperator('AND'))
        this.tests.add(new VarOperation(part))
        i++
      }
    }
  }

  /** `<section>.<element>`, the scenario-text key for a field. */
  genKey(element: string): string {
    return `${this.sectionName}.${element}`
  }

  /** `{qst:<section>.<element>}`, the lookup for a field. */
  genQuery(element: string): StringKey {
    return new StringKey('qst', `${this.sectionName}.${element}`)
  }

  /** Removes every occurrence of `element`. Used when a component is deleted. */
  static removeFromArray(array: readonly string[], element: string): string[] {
    return array.filter((value) => value !== element)
  }

  /** Rewrites references after a component is renamed. "" means delete. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- overridden below
  changeReference(oldName: string, newName: string): void {
    // Base components hold no references.
  }

  removeReference(refName: string): void {
    this.changeReference(refName, '')
  }

  toString(): string {
    let result = `[${this.sectionName}]\n`
    if (this.locationSpecified) {
      result += `xposition=${this.location.x}\n`
      result += `yposition=${this.location.y}\n`
    }
    if (this.comment.length > 0) result += `comment=${this.comment}\n`

    if (this.operations !== null && this.operations.length > 0) {
      result += `operations=${this.operations.map((o) => o.toString()).join(' ')}\n`
    }
    if (this.tests !== null && this.tests.varTestsComponents.length > 0) {
      result += `vartests=${this.tests.toString()}\n`
    }
    return result
  }
}

export class QuestEvent extends QuestComponent {
  static override readonly type: string = 'Event'

  display = true
  trigger = ''
  buttons: QuestButtonData[] = []
  heroListName = ''
  minHeroes = 0
  maxHeroes = 0
  addComponents: string[] = []
  removeComponents: string[] = []
  cancelable = false
  highlight = false
  randomEvents = false
  minCam = false
  maxCam = false
  quota = 0
  quotaVar = ''
  audio = ''
  music: string[] = []

  constructor(
    sectionName: string,
    data: ContentFields,
    source: string,
    format: number,
    context: QuestContext = DEFAULT_QUEST_CONTEXT,
    type: string = QuestEvent.type,
  ) {
    super(sectionName, data, source, format, type)

    this.display = data.has('display') ? boolOrFalse(data.get('display')) : true
    this.highlight = boolOrFalse(data.get('highlight'))

    let buttonCount = intOrZero(data.get('buttons'))
    // A displayed event always has at least one way out of it.
    if (this.display && buttonCount === 0) buttonCount = 1

    this.buttons = []
    for (let n = 1; n <= buttonCount; n++) {
      this.buttons.push(buttonFromData(data, n, sectionName, context.localization))
    }

    this.heroListName = data.get('hero') ?? ''

    const quota = data.get('quota')
    if (quota !== undefined) {
      this.quota = intOrZero(quota)
      // A non-numeric quota names a variable instead.
      if (quota.length > 0 && !/[0-9]/.test(quota[0]!)) this.quotaVar = quota
    }

    this.minHeroes = intOrZero(data.get('minhero'))
    this.maxHeroes = intOrZero(data.get('maxhero'))

    const add = data.get('add')
    this.addComponents = add === undefined ? [] : splitDropEmpty(add)
    const remove = data.get('remove')
    this.removeComponents = remove === undefined ? [] : splitDropEmpty(remove)

    this.trigger = data.get('trigger') ?? ''
    this.randomEvents = boolOrFalse(data.get('randomevents'))

    // A camera-relative event has no board location.
    if (data.has('mincam')) {
      this.locationSpecified = false
      this.minCam = boolOrFalse(data.get('mincam'))
    }
    if (data.has('maxcam')) {
      this.locationSpecified = false
      this.maxCam = boolOrFalse(data.get('maxcam'))
    }

    const audio = data.get('audio')
    if (audio !== undefined) this.audio = normalisePath(audio)

    const music = data.get('music')
    this.music = music === undefined ? [] : splitDropEmpty(music).map(normalisePath)
  }

  get textKey(): string {
    return this.genKey('text')
  }

  get text(): StringKey {
    return this.genQuery('text')
  }

  override changeReference(oldName: string, newName: string): void {
    if (this.sectionName === oldName && newName !== '') {
      for (let i = 1; i <= this.buttons.length; i++) {
        this.buttons[i - 1]!.label = new StringKey('qst', `${newName}.button${i}`)
      }
    }

    if (this.heroListName === oldName) this.heroListName = newName

    const isRemoval = newName === ''
    for (const button of this.buttons) {
      if (isRemoval) {
        const index = button.eventNames.indexOf(oldName)
        // C# List.Remove drops only the first match.
        if (index !== -1) button.eventNames.splice(index, 1)
        continue
      }
      for (let j = 0; j < button.eventNames.length; j++) {
        if (button.eventNames[j] === oldName) button.eventNames[j] = newName
      }
    }

    if (this.trigger.startsWith(`Defeated${oldName}`)) this.trigger = `Defeated${newName}`
    if (this.trigger.startsWith(`DefeatedUnique${oldName}`)) {
      this.trigger = `DefeatedUnique${newName}`
    }

    this.addComponents = QuestComponent.removeFromArray(
      this.addComponents.map((c) => (c === oldName ? newName : c)),
      '',
    )
    this.removeComponents = QuestComponent.removeFromArray(
      this.removeComponents.map((c) => (c === oldName ? newName : c)),
      '',
    )
  }
}

export class Tile extends QuestComponent {
  static override readonly type: string = 'Tile'

  rotation = 0
  tileSideName = ''
  customImage = ''
  top = 0
  left = 0

  constructor(sectionName: string, data: ContentFields, source: string) {
    super(sectionName, data, source, -1, Tile.type)

    // A tile is always placed.
    this.locationSpecified = true

    this.rotation = intOrZero(data.get('rotation'))
    this.tileSideName = data.get('side') ?? ''
    this.customImage = data.get('customImage') ?? ''
    this.top = floatOrZero(data.get('top'))
    this.left = floatOrZero(data.get('left'))

    if (this.tileSideName.length === 0 && this.customImage.length === 0) {
      // DEVIATION: the C# calls Application.Quit() here.
      throw new RangeError(`No TileSide specified in quest component: ${sectionName}`)
    }
  }

  override toString(): string {
    let result = super.toString()
    if (this.tileSideName.length > 0) result += `side=${this.tileSideName}\n`
    if (this.rotation !== 0) result += `rotation=${this.rotation}\n`
    if (this.customImage.length > 0) {
      result += `customImage=${this.customImage}\n`
      if (this.top !== 0) result += `top=${this.top}\n`
      if (this.left !== 0) result += `left=${this.left}\n`
    }
    return result
  }
}

export class Door extends QuestEvent {
  static override readonly type: string = 'Door'

  rotation = 0
  colourName = 'white'

  constructor(
    sectionName: string,
    data: ContentFields,
    source: string,
    format: number,
    context?: QuestContext,
  ) {
    super(sectionName, data, source, format, context, Door.type)

    this.locationSpecified = true
    // A door can be selected and then cancelled.
    this.cancelable = true

    this.rotation = intOrZero(data.get('rotation'))
    // Only "#RRGGBB" is supported.
    this.colourName = data.get('color') ?? 'white'
  }

  override toString(): string {
    let result = super.toString()
    if (this.colourName !== 'white') result += `color=${this.colourName}\n`
    if (this.rotation !== 0) result += `rotation=${this.rotation}\n`
    return result
  }
}

export class Token extends QuestEvent {
  static override readonly type: string = 'Token'

  rotation = 0
  tokenName = ''
  customImage = ''
  tokenSize = ''
  enableClick = true

  constructor(
    sectionName: string,
    data: ContentFields,
    source: string,
    format: number,
    context?: QuestContext,
  ) {
    super(sectionName, data, source, format, context, Token.type)

    this.locationSpecified = true
    this.cancelable = true
    // Tokens carry no conditions.
    this.tests = null

    this.tokenName = data.get('type') ?? ''
    const rotation = data.get('rotation')
    if (rotation !== undefined) this.rotation = parseIntLogged(rotation)
    this.tokenSize = data.get('tokensize') ?? ''
    const clickEffect = data.get('clickeffect')
    if (clickEffect !== undefined) this.enableClick = parseBoolLogged(clickEffect)
    this.customImage = data.get('customImage') ?? ''
  }

  override toString(): string {
    let result = `${super.toString()}type=${this.tokenName}\n`
    if (this.rotation !== 0) result += `rotation=${this.rotation}\n`
    if (this.tokenSize.length > 0) result += `tokensize=${this.tokenSize}\n`
    if (!this.enableClick) result += 'clickeffect=false\n'
    if (this.customImage.length > 0) result += `customImage=${this.customImage}\n`
    return result
  }
}

/**
 * Port of `TextAlignment` in `unity/Assets/Scripts/Content/TextAlignment.cs`.
 *
 * Vertical, not horizontal — `left` and `right` are not valid values and fall
 * back to CENTER. Horizontal alignment is the separate `halign` field.
 *
 * Held as the underlying integer rather than a name, because `Enum.Parse`
 * accepts numbers and does not range-check them: `textAlignment=-1` parses,
 * and writes back out as `-1`. Storing the name would quietly rewrite a
 * scenario author's file.
 */
export const TextAlignment = {
  TOP: 0,
  CENTER: 1,
  BOTTOM: 2,
} as const

export type TextAlignment = number

const ALIGNMENT_NAMES = ['TOP', 'CENTER', 'BOTTOM']

/**
 * `Enum.Parse(typeof(TextAlignment), s, ignoreCase: true)` with CENTER when it
 * throws.
 *
 * Three behaviours of `Enum.Parse` that a name-only parser misses: it takes
 * numbers (`0` is TOP), it takes a comma-separated list and ORs the values,
 * and it trims around each element.
 */
export function parseTextAlignment(value: string): TextAlignment {
  const parts = value.split(',').map((part) => part.trim())
  if (parts.length === 0 || parts.some((part) => part.length === 0)) {
    return alignmentFailure(value)
  }

  let combined = 0
  for (const part of parts) {
    const named = ALIGNMENT_NAMES.indexOf(part.toUpperCase())
    if (named !== -1) {
      combined |= named
      continue
    }
    // A single integer is taken as-is, in range or not; a list of them is not.
    if (parts.length === 1 && /^[+-]?\d+$/.test(part)) {
      const parsed = Number(part)
      if (Number.isSafeInteger(parsed)) return parsed
    }
    return alignmentFailure(value)
  }
  return combined
}

function alignmentFailure(value: string): TextAlignment {
  log(`Failed to parse text alignment - ${value}`)
  return TextAlignment.CENTER
}

/** The name of a defined value, or the number for anything else. */
export function textAlignmentName(value: TextAlignment): string {
  return ALIGNMENT_NAMES[value] ?? String(value)
}

export class QuestUI extends QuestEvent {
  static override readonly type: string = 'UI'

  imageName = ''
  verticalUnits = false
  hAlign = 0
  vAlign = 0
  size = 1
  richText = false
  textSize = 1
  textColor = 'white'
  textBackgroundColor = 'transparent'
  textAlignment: TextAlignment = TextAlignment.CENTER
  aspect = 1
  border = false
  fadeSpeed = 'fast'
  enableClick = true

  constructor(
    sectionName: string,
    data: ContentFields,
    source: string,
    format: number,
    context?: QuestContext,
  ) {
    super(sectionName, data, source, format, context, QuestUI.type)

    this.locationSpecified = true
    this.cancelable = true

    const image = data.get('image')
    if (image !== undefined) this.imageName = normalisePath(image)

    this.fadeSpeed = data.get('fadespeed') ?? 'fast'
    this.verticalUnits = boolOrFalse(data.get('vunits'))

    // These default to 1, so an unparseable value resets rather than keeping it.
    if (data.has('size')) this.size = floatOrZero(data.get('size'))
    if (data.has('textsize')) this.textSize = floatOrZero(data.get('textsize'))
    if (data.has('textaspect')) this.aspect = floatOrZero(data.get('textaspect'))

    this.textColor = data.get('textcolor') ?? 'white'
    this.textBackgroundColor = data.get('textbackgroundcolor') ?? 'transparent'

    const hAlign = data.get('halign')
    if (hAlign === 'left') this.hAlign = -1
    if (hAlign === 'right') this.hAlign = 1

    const vAlign = data.get('valign')
    if (vAlign === 'top') this.vAlign = -1
    if (vAlign === 'bottom') this.vAlign = 1

    const alignment = data.get('textAlignment')
    if (alignment !== undefined) this.textAlignment = parseTextAlignment(alignment)

    const richText = data.get('richText')
    if (richText !== undefined) {
      const trimmed = richText.trim().toLowerCase()
      // Only a parseable bool overwrites the default.
      if (trimmed === 'true' || trimmed === 'false') this.richText = trimmed === 'true'
    }

    this.border = boolOrFalse(data.get('border'))
    if (data.has('clickeffect')) this.enableClick = boolOrFalse(data.get('clickeffect'))
  }

  get uiTextKey(): string {
    return this.genKey('uitext')
  }

  get uiText(): StringKey {
    return this.genQuery('uitext')
  }
}

export class Spawn extends QuestEvent {
  static override readonly type: string = 'Spawn'

  /** One list of placement component names per hero count. */
  placement: string[][] = []
  activated = false
  unique = false
  uniqueHealthBase = 0
  uniqueHealthHero = 0
  mTypes: string[] = []
  mTraitsRequired: string[] = []
  mTraitsPool: string[] = []

  constructor(
    sectionName: string,
    data: ContentFields,
    source: string,
    format: number,
    context: QuestContext = DEFAULT_QUEST_CONTEXT,
  ) {
    super(sectionName, data, source, format, context, Spawn.type)

    const monster = data.get('monster')
    this.mTypes = monster === undefined ? [] : splitDropEmpty(monster)

    const traits = data.get('traits')
    this.mTraitsRequired = traits === undefined ? [] : splitDropEmpty(traits)

    const traitPool = data.get('traitpool')
    this.mTraitsPool = traitPool === undefined ? [] : splitDropEmpty(traitPool)

    this.placement = []
    for (let i = 0; i < context.maxHeroes; i++) {
      const slot = data.get(`placement${i}`)
      this.placement.push(slot === undefined ? [] : splitDropEmpty(slot))
    }

    this.unique = boolOrFalse(data.get('unique'))
    this.activated = boolOrFalse(data.get('activated'))
    this.uniqueHealthBase = floatOrZero(data.get('uniquehealth'))
    this.uniqueHealthHero = floatOrZero(data.get('uniquehealthhero'))
  }

  get uniqueTitleKey(): string {
    return this.genKey('uniquetitle')
  }

  get uniqueTextKey(): string {
    return this.genKey('uniquetext')
  }

  get uniqueTitle(): StringKey {
    return this.genQuery('uniquetitle')
  }

  get uniqueText(): StringKey {
    return this.genQuery('uniquetext')
  }

  override changeReference(oldName: string, newName: string): void {
    super.changeReference(oldName, newName)

    for (let j = 0; j < this.placement.length; j++) {
      this.placement[j] = QuestComponent.removeFromArray(
        this.placement[j]!.map((p) => (p === oldName ? newName : p)),
        '',
      )
    }

    // A built-in monster type is never renamed, only a quest-defined one.
    for (let i = 0; i < this.mTypes.length; i++) {
      if (this.mTypes[i] === oldName && !oldName.startsWith('Monster')) {
        this.mTypes[i] = newName
      }
    }
    this.mTypes = QuestComponent.removeFromArray(this.mTypes, '')
  }
}

export class MPlace extends QuestComponent {
  static override readonly type: string = 'MPlace'

  master = false
  rotate = false
  tokenSize = ''

  constructor(sectionName: string, data: ContentFields, source: string) {
    super(sectionName, data, source, -1, MPlace.type)

    this.locationSpecified = true
    const master = data.get('master')
    if (master !== undefined) this.master = parseBoolLogged(master)
    const rotate = data.get('rotate')
    if (rotate !== undefined) this.rotate = parseBoolLogged(rotate)
    this.tokenSize = data.get('tokensize') ?? ''
  }

  override toString(): string {
    let result = super.toString()
    if (this.master) result += 'master=true\n'
    if (this.rotate) result += 'rotate=true\n'
    if (this.tokenSize.length > 0) result += `tokensize=${this.tokenSize}\n`
    return result
  }
}

export class Puzzle extends QuestEvent {
  static override readonly type: string = 'Puzzle'

  puzzleClass = 'slide'
  skill = '{observation}'
  puzzleLevel = 4
  puzzleAltLevel = 3
  puzzleSolution = ''
  imageType = ''
  fadeSpeed = 'instant'

  constructor(
    sectionName: string,
    data: ContentFields,
    source: string,
    format: number,
    context?: QuestContext,
  ) {
    super(sectionName, data, source, format, context, Puzzle.type)

    this.puzzleClass = data.get('class') ?? 'slide'
    const image = data.get('image')
    if (image !== undefined) this.imageType = normalisePath(image)
    this.fadeSpeed = data.get('fadespeed') ?? 'instant'
    this.skill = data.get('skill') ?? '{observation}'

    if (data.has('puzzlelevel')) this.puzzleLevel = intOrZero(data.get('puzzlelevel'))
    if (data.has('puzzlealtlevel')) this.puzzleAltLevel = intOrZero(data.get('puzzlealtlevel'))
    this.puzzleSolution = data.get('puzzlesolution') ?? ''
  }
}

export class CustomMonster extends QuestComponent {
  static override readonly type: string = 'CustomMonster'

  baseMonster = ''
  imagePath = ''
  imagePlace = ''
  activations: string[] = []
  traits: string[] = []
  path = ''
  healthBase = 0
  healthPerHero = 0
  healthDefined = false
  evadeEvent = ''
  horrorEvent = ''
  horror = 0
  horrorDefined = false
  awareness = 0
  awarenessDefined = false
  readonly investigatorAttacks = new Map<string, StringKey[]>()

  constructor(sectionName: string, data: ContentFields, source: string) {
    super(sectionName, data, source, -1, CustomMonster.type)

    // The C# stores Path.GetDirectoryName of the source file.
    const lastSlash = source.replace(/\\/g, '/').lastIndexOf('/')
    this.path = lastSlash === -1 ? '' : source.replace(/\\/g, '/').slice(0, lastSlash)

    this.baseMonster = data.get('base') ?? ''

    const traits = data.get('traits')
    this.traits = traits === undefined ? [] : splitDropEmpty(traits)

    const image = data.get('image')
    if (image !== undefined) this.imagePath = normalisePath(image)
    this.imagePlace = data.get('imageplace') ?? this.imagePath

    const activation = data.get('activation')
    this.activations = activation === undefined ? [] : splitDropEmpty(activation)

    if (data.has('health')) {
      this.healthDefined = true
      this.healthBase = floatOrZero(data.get('health'))
    }
    if (data.has('healthperhero')) {
      this.healthDefined = true
      this.healthPerHero = floatOrZero(data.get('healthperhero'))
    }

    this.evadeEvent = data.get('evadeevent') ?? ''
    this.horrorEvent = data.get('horrorevent') ?? ''

    if (data.has('horror')) {
      this.horrorDefined = true
      this.horror = intOrZero(data.get('horror'))
    }
    if (data.has('awareness')) {
      this.awarenessDefined = true
      this.awareness = intOrZero(data.get('awareness'))
    }

    // "attacks=melee:3 ranged" declares three melee texts and one ranged.
    const attacks = data.get('attacks')
    if (attacks !== undefined) {
      for (const entry of splitDropEmpty(attacks)) {
        let attackType = entry
        let count = 1
        const separator = entry.indexOf(':')
        if (separator >= 0) {
          attackType = entry.slice(0, separator)
          count = intOrZero(entry.slice(separator + 1))
        }

        let list = this.investigatorAttacks.get(attackType)
        if (list === undefined) {
          list = []
          this.investigatorAttacks.set(attackType, list)
        }
        for (let i = 1; i <= count; i++) {
          list.push(this.genQuery(`Attack_${attackType}_${i}`))
        }
      }
    }
  }

  get monsterNameKey(): string {
    return this.genKey('monstername')
  }

  get infoKey(): string {
    return this.genKey('info')
  }

  get monsterName(): StringKey {
    return this.genQuery('monstername')
  }

  get info(): StringKey {
    return this.genQuery('info')
  }
}

export class Activation extends QuestComponent {
  static override readonly type: string = 'Activation'

  minionFirst = false
  masterFirst = false

  constructor(sectionName: string, data: ContentFields, source: string) {
    super(sectionName, data, source, -1, Activation.type)
    this.minionFirst = boolOrFalse(data.get('minionfirst'))
    this.masterFirst = boolOrFalse(data.get('masterfirst'))
  }

  get abilityKey(): string {
    return this.genKey('ability')
  }

  get minionKey(): string {
    return this.genKey('minion')
  }

  get masterKey(): string {
    return this.genKey('master')
  }

  get moveButtonKey(): string {
    return this.genKey('movebutton')
  }

  get moveKey(): string {
    return this.genKey('move')
  }

  get ability(): StringKey {
    return this.genQuery('ability')
  }

  get minionActions(): StringKey {
    return this.genQuery('minion')
  }

  get masterActions(): StringKey {
    return this.genQuery('master')
  }

  get moveButton(): StringKey {
    return this.genQuery('movebutton')
  }

  get move(): StringKey {
    return this.genQuery('move')
  }

  override toString(): string {
    let result = super.toString()
    if (this.minionFirst) result += 'minionfirst=True\n'
    if (this.masterFirst) result += 'masterfirst=True\n'
    return result
  }
}

export class QItem extends QuestComponent {
  static override readonly type: string = 'QItem'

  itemName: string[] = []
  traits: string[] = []
  traitpool: string[] = []
  starting = false
  inspect = ''

  constructor(sectionName: string, data: ContentFields, source: string) {
    super(sectionName, data, source, -1, QItem.type)

    const itemName = data.get('itemname')
    this.itemName = itemName === undefined ? [] : splitDropEmpty(itemName)

    // Absent means starting; present means whatever it says.
    this.starting = data.has('starting') ? boolOrFalse(data.get('starting')) : true

    const traits = data.get('traits')
    this.traits = traits === undefined ? [] : splitDropEmpty(traits)

    const traitpool = data.get('traitpool')
    this.traitpool = traitpool === undefined ? [] : splitDropEmpty(traitpool)

    this.inspect = data.get('inspect') ?? ''
  }

  override changeReference(oldName: string, newName: string): void {
    if (this.inspect === oldName) this.inspect = newName
  }
}
