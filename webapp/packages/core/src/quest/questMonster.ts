/**
 * Resolving a scenario's `CustomMonster` against the content type it derives
 * from, ported from `unity/Assets/Scripts/Quest/QuestMonster.cs`.
 *
 * A quest monster is written as a set of overrides: name it, give it traits,
 * say how much health it has — and leave out whatever should come from the
 * content monster named in `base`. The C# resolves that once, in a constructor
 * that builds a `MonsterData` standing in for the real one, so every dialog
 * afterwards reads a single flat object.
 *
 * Which fields fall back and on what test is the whole content of this file,
 * and getting one wrong is quiet: a monster keeps its health but loses its
 * traits, and every attack button disappears with no error anywhere.
 */

import type { StringKey } from '../i18n/StringKey.js'

/** A content `Monster` section, as the fallback sees it. */
export interface BaseMonsterView {
  name: StringKey
  info: StringKey
  traits: readonly string[]
  image: string
  activations: readonly string[]
  healthBase: number
  healthPerHero: number
  horror: number
  awareness: number
}

/** A scenario's `CustomMonster` section. */
export interface CustomMonsterSection {
  sectionName: string
  baseMonster: string
  monsterName: StringKey
  info: StringKey
  traits: readonly string[]
  /** `GetImagePath()`: the portrait, relative to the quest. */
  imagePath: string
  /** `GetImagePlacePath()`: the board marker, relative to the quest. */
  imagePlace: string
  activations: readonly string[]
  healthBase: number
  healthPerHero: number
  healthDefined: boolean
  horror: number
  horrorDefined: boolean
  awareness: number
  awarenessDefined: boolean
}

/** One monster type, with every override already applied. */
export interface ResolvedMonster {
  sectionName: string
  name: StringKey
  info: StringKey
  traits: readonly string[]
  /** The portrait the monster dialog shows. */
  image: string
  /** The marker the board shows. */
  imagePlace: string
  activations: readonly string[]
  healthBase: number
  healthPerHero: number
  horror: number
  awareness: number
  /** `base`, but only when it names a content monster that exists. */
  derivedType: string
  /** Set when the quest defined no activations and the base supplies them. */
  useMonsterTypeActivations: boolean
}

/** A content `Monster` section used directly, with nothing to resolve. */
export function contentMonster(
  sectionName: string,
  base: BaseMonsterView & { imagePlace: string },
): ResolvedMonster {
  return {
    sectionName,
    name: base.name,
    info: base.info,
    traits: base.traits,
    image: base.image,
    imagePlace: base.imagePlace.length > 0 ? base.imagePlace : base.image,
    activations: base.activations,
    healthBase: base.healthBase,
    healthPerHero: base.healthPerHero,
    horror: base.horror,
    awareness: base.awareness,
    derivedType: '',
    useMonsterTypeActivations: false,
  }
}

/**
 * `QuestMonster`'s constructor.
 *
 * `base` is the content monster `base` names, or undefined when it names
 * nothing the game has — in which case `derivedType` stays empty and every
 * fallback is skipped, exactly as the C# skips them on a null `baseObject`.
 *
 * `questPath` is prefixed to an image the quest supplies, because the paths in
 * a `CustomMonster` are relative to the scenario rather than to content.
 */
export function resolveQuestMonster(
  custom: CustomMonsterSection,
  base: BaseMonsterView | undefined,
  questPath: string,
  keyExists: (key: StringKey) => boolean,
): ResolvedMonster {
  const beside = (file: string): string => (questPath.length === 0 ? file : `${questPath}/${file}`)

  // Only a base the game actually has counts; a `base` naming nothing leaves
  // the monster standing on its own.
  const derivedType = base === undefined ? '' : custom.baseMonster

  const image = custom.imagePath.length > 0 ? beside(custom.imagePath) : (base?.image ?? '')

  // Note the asymmetry: an absent placement image falls back to the base's
  // *portrait*, not to its own placement image. QuestMonster.cs:71 reads
  // `baseObject.image`, and the board is positioned against that.
  const imagePlace =
    custom.imagePlace.length > 0 ? beside(custom.imagePlace) : (base?.image ?? image)

  return {
    sectionName: custom.sectionName,
    name: !keyExists(custom.monsterName) && base !== undefined ? base.name : custom.monsterName,
    info: !keyExists(custom.info) && base !== undefined ? base.info : custom.info,
    traits: custom.traits.length === 0 && base !== undefined ? base.traits : custom.traits,
    image,
    imagePlace,
    activations: custom.activations,
    // Health is a pair: `healthDefined` is set by either field, so a monster
    // that gives only `health` keeps its own zero per-hero rather than the
    // base's. Splitting the test would quietly change how much health a
    // scenario's monsters have.
    healthBase: !custom.healthDefined && base !== undefined ? base.healthBase : custom.healthBase,
    healthPerHero:
      !custom.healthDefined && base !== undefined ? base.healthPerHero : custom.healthPerHero,
    horror: !custom.horrorDefined && base !== undefined ? base.horror : custom.horror,
    awareness: !custom.awarenessDefined && base !== undefined ? base.awareness : custom.awareness,
    derivedType,
    useMonsterTypeActivations: custom.activations.length === 0 && base !== undefined,
  }
}
