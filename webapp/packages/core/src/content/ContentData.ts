/**
 * Port of the data-model half of `unity/Assets/Scripts/Content/ContentData.cs`.
 *
 * Holds every content entry loaded from every enabled pack, keyed by type.
 *
 * Not ported, because they are filesystem or renderer work:
 *  - pack discovery (`GetBuildInContentPacks`, `GetCustomContentPacks`) — T-013
 *  - archive extraction (`PopulatePackListByPath`) — T-012
 *  - texture decoding (`FileToTexture`, `DdsToTexture`, `PvrToTexture`) — T-001
 *  - the path helpers (`ContentPath`, `TempPath`, ...) — T-011
 */

import { StringKey } from '../i18n/StringKey.js'
import type { ContentPack } from './ContentPack.js'
import type { ContentContext } from './context.js'
import { TEXTURE_EXTENSIONS } from './context.js'
import type { IContent } from './types.js'

/** A content class, used as the registry key. Mirrors C# keying by `Type`. */
export type ContentType<T extends IContent> = abstract new (...args: never[]) => T

export class ContentData {
  /** Ids of packs whose content has been loaded. */
  readonly loadedPacks = new Set<string>()

  /** Every pack found, whether or not its content is loaded. */
  readonly allPacks: ContentPack[] = []

  /** Pack id -> its `{val:<id>_SYMBOL}` key. */
  readonly packSymbolDict = new Map<string, StringKey>()

  private readonly content = new Map<unknown, Map<string, IContent>>()

  constructor(private readonly context: ContentContext) {}

  private ofType<T extends IContent>(type: ContentType<T>): Map<string, IContent> {
    let bucket = this.content.get(type)
    if (bucket === undefined) {
      bucket = new Map<string, IContent>()
      this.content.set(type, bucket)
    }
    return bucket
  }

  addOrReplace<T extends IContent>(type: ContentType<T>, name: string, value: T): void {
    this.ofType(type).set(name, value)
  }

  tryGet<T extends IContent>(type: ContentType<T>, name: string): T | undefined {
    return this.ofType(type).get(name) as T | undefined
  }

  get<T extends IContent>(type: ContentType<T>, name: string): T {
    const value = this.ofType(type).get(name)
    if (value === undefined) throw new RangeError(`No ${String(name)} of the requested type`)
    return value as T
  }

  keys<T extends IContent>(type: ContentType<T>): string[] {
    return [...this.ofType(type).keys()]
  }

  values<T extends IContent>(type: ContentType<T>): T[] {
    return [...this.ofType(type).values()] as T[]
  }

  containsKey<T extends IContent>(type: ContentType<T>, key: string): boolean {
    return this.ofType(type).has(key)
  }

  getAll<T extends IContent>(type: ContentType<T>): [string, T][] {
    return [...this.ofType(type).entries()] as [string, T][]
  }

  count<T extends IContent>(type: ContentType<T>): number {
    return this.ofType(type).size
  }

  /**
   * Adds an entry, resolving duplicates by priority.
   *
   * Higher priority replaces. **Equal** priority means the same content is
   * declared by more than one pack, so the incoming sets are folded into the
   * entry already stored and the new object is discarded. Returns whether the
   * entry is newly stored.
   */
  addContent<T extends IContent>(type: ContentType<T>, name: string, value: T): boolean {
    const existing = this.tryGet(type, name)
    if (existing === undefined || existing.priority < value.priority) {
      this.addOrReplace(type, name, value)
      return true
    }
    if (existing.priority === value.priority) {
      existing.sets.push(...value.sets)
    }
    return false
  }

  /**
   * Every populated bucket, as (content class, entries). Insertion-ordered by
   * first use of each type, matching the C# `Dictionary<Type, ...>`.
   */
  contentBuckets(): [ContentType<IContent>, Map<string, IContent>][] {
    return [...this.content.entries()] as [ContentType<IContent>, Map<string, IContent>][]
  }

  /** Ids of every enabled pack. */
  getLoadedPackIDs(): string[] {
    return [...this.loadedPacks]
  }

  /** Names of every pack found. */
  getPacks(): string[] {
    return this.allPacks.map((pack) => pack.name)
  }

  getPackById(id: string): ContentPack | null {
    return this.allPacks.find((pack) => pack.id === id) ?? null
  }

  /**
   * Adds a pack, replacing any existing entry with the same id so that an
   * updated download supersedes what was there.
   */
  addPack(pack: ContentPack): void {
    const existingIndex = this.allPacks.findIndex((p) => p.id === pack.id)
    if (existingIndex !== -1) this.allPacks.splice(existingIndex, 1)
    this.packSymbolDict.delete(pack.id)

    this.allPacks.push(pack)
    this.packSymbolDict.set(pack.id, new StringKey('val', `${pack.id}_SYMBOL`))
  }

  removePack(id: string): void {
    const index = this.allPacks.findIndex((pack) => pack.id === id)
    if (index !== -1) this.allPacks.splice(index, 1)
    this.packSymbolDict.delete(id)
  }

  /** Display name for a pack, falling back to the `pck` dictionary. */
  getContentName(id: string): string {
    const pack = this.getPackById(id)
    if (pack === null) return id

    const localization = this.context.localization
    const translated = StringKey.parse(pack.name, localization).translate({ localization })

    // An untranslated plain id may still have a name in the "pck" dictionary.
    if (translated === pack.name && !pack.name.includes('{')) {
      const pckKey = new StringKey('pck', pack.name)
      if (pckKey.keyExists(localization)) return pckKey.translate({ localization })
    }
    return translated
  }

  getContentAcronym(id: string): string {
    if (this.getPackById(id) === null) return ''
    const localization = this.context.localization
    return new StringKey('val', id).translate({ localization })
  }

  getContentSymbol(id: string): string {
    if (this.getPackById(id) === null) return ''
    const localization = this.context.localization
    return new StringKey('val', `${id}_SYMBOL`).translate({ localization })
  }
}

/**
 * Builds a `resolveTextureFile` over a caller-supplied existence check.
 *
 * Port of `ContentData.ResolveTextureFile`: the name is tried as-is first, then
 * with each known extension in order.
 */
export function makeTextureResolver(
  fileExists: (path: string) => boolean,
): (name: string) => string | null {
  return (name: string) => {
    if (fileExists(name)) return name
    for (const extension of TEXTURE_EXTENSIONS) {
      const candidate = name + extension
      if (fileExists(candidate)) return candidate
    }
    return null
  }
}
