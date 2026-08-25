/**
 * Port of `unity/Assets/Scripts/Content/ContentLoader.cs`.
 *
 * Turns the `[Type...]` sections of a pack's ini files into typed content.
 *
 * The C# holds its loader list in a `static readonly` field. Here the list is
 * a parameter, because `PerilDataLoader` cannot exist until `QuestData.Event`
 * is ported in T-008 — a fixed list would either be wrong now or need editing
 * later. `DEFAULT_CONTENT_LOADERS` is everything available today.
 */

import type { IniData } from '../ini/IniData.js'
import { log } from '../ini/logger.js'
import type { ContentData, ContentType } from './ContentData.js'
import type { ContentPack } from './ContentPack.js'
import type { ContentContext } from './context.js'
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
  PackTypeData,
  PuzzleData,
  SkillData,
  TileSideData,
  TokenData,
} from './types.js'
import type { ContentFields, IContent } from './types.js'

export interface ContentTypeLoader<T extends IContent = IContent> {
  /** Registry key this loader stores under. */
  readonly type: ContentType<T>
  /** Section-name prefix this loader claims. */
  readonly typePrefix: string
  /**
   * Whether entries should register their translation key against each pack
   * id, so the UI can show a second language alongside the first.
   */
  readonly additionalTranslation: boolean
  /** Builds the entry, or null to skip the section. */
  create(
    name: string,
    content: ContentFields,
    path: string,
    sets: string[],
    context: ContentContext,
  ): T | null
}

type Constructible<T> = new (
  name: string,
  content: ContentFields,
  path: string,
  sets: string[] | null,
  context: ContentContext,
) => T

/** Builds the common loader shape: prefix from the class, plain construction. */
function simpleLoader<T extends IContent>(
  type: ContentType<T> & { readonly type: string },
  additionalTranslation = false,
): ContentTypeLoader<T> {
  return {
    type,
    typePrefix: type.type,
    additionalTranslation,
    create: (name, content, path, sets, context) =>
      new (type as unknown as Constructible<T>)(name, content, path, sets, context),
  }
}

/**
 * Loaders in the same order as the C# list. Order matters: the first loader
 * whose prefix matches and whose `create` succeeds claims the section, so
 * `Token` must come after the types whose names it would otherwise shadow.
 */
export const DEFAULT_CONTENT_LOADERS: ContentTypeLoader[] = [
  simpleLoader(PackTypeData),
  simpleLoader(TileSideData, true),
  simpleLoader(HeroData, true),
  simpleLoader(ClassData, true),
  simpleLoader(SkillData, true),
  simpleLoader(ItemData, true),
  simpleLoader(ActivationData),
  simpleLoader(MonsterData, true),
  simpleLoader(AttackData),
  simpleLoader(EvadeData),
  simpleLoader(HorrorData),
  {
    ...simpleLoader(TokenData),
    // A token with no resolvable image is unusable, so it is skipped rather
    // than stored. Every other loader accepts whatever it parses.
    create: (name, content, path, sets, context) => {
      const token = new TokenData(name, content, path, sets, context)
      if (token.image === '') {
        log(`Token ${token.name.fullKey}did not have an image. Skipping`)
        return null
      }
      return token
    },
  },
  // PerilDataLoader belongs here — it arrives with T-008.
  simpleLoader(PuzzleData),
  simpleLoader(ImageData),
  simpleLoader(AudioData),
]

export interface ContentLoaderOptions {
  loaders?: ContentTypeLoader[]
}

export class ContentLoader {
  private readonly loaders: ContentTypeLoader[]

  constructor(
    private readonly cd: ContentData,
    private readonly context: ContentContext,
    options: ContentLoaderOptions = {},
  ) {
    this.loaders = options.loaders ?? DEFAULT_CONTENT_LOADERS
  }

  /**
   * Loads one already-parsed ini section.
   *
   * Returns the loader that claimed it, or null when nothing matched — which
   * is normal, since packs carry sections the content model does not model.
   */
  loadSection(
    name: string,
    content: ContentFields,
    path: string,
    packId: string,
  ): ContentTypeLoader | null {
    for (const loader of this.loaders) {
      if (!name.startsWith(loader.typePrefix)) continue

      const entry = loader.create(name, content, path, [packId], this.context)
      if (entry === null || entry.sectionName.trim().length === 0) {
        log(`Ignored invalid entry ${name}`)
        continue
      }

      const isNew = this.cd.addContent(loader.type, name, entry)
      if (isNew && loader.additionalTranslation) {
        for (const id of entry.sets) {
          this.context.localization.registerKeyInGroup(entry.translationKey, id)
        }
      }
      return loader
    }
    return null
  }

  /**
   * Loads every section of one already-read ini file.
   *
   * `path` is the directory the ini came from; relative asset paths in the
   * content resolve against it.
   */
  loadIni(data: IniData, path: string, packId: string): void {
    for (const [section, fields] of data.data) {
      this.loadSection(section, fields, path, packId)
    }
  }

  /**
   * Marks a pack loaded and follows its `clone` list.
   *
   * The ini files themselves must already have been read and passed through
   * {@link loadIni} — reading them is filesystem work (T-011).
   */
  markPackLoaded(pack: ContentPack): void {
    this.cd.loadedPacks.add(pack.id)
  }

  /** Whether a pack's content has already been loaded. */
  isLoaded(pack: ContentPack): boolean {
    return this.cd.loadedPacks.has(pack.id)
  }
}

/** Re-exported so callers can build a loader list without importing types.js. */
export { GenericData }
