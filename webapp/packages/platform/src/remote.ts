/**
 * Port of `unity/Assets/Scripts/Content/RemoteContentPackManager.cs` and the
 * download half of `QuestAndContentPackDownload.cs`.
 *
 * Fetches the content-pack manifest from `valkyrie-store`, works out what is
 * already installed and what has an update, and downloads packages.
 *
 * The C# does this from a constructor that fires a callback, which makes the
 * "not loaded yet" state observable and forces every caller to guard. Here it
 * is an ordinary async method.
 */

import { IniData, RemoteContentPack, readFromString } from '@valkyrie/core'

import { ExtractMode, extractStream } from './archive.js'
import type { FileSystem, StoragePaths } from './filesystem.js'
import { HttpError, NetworkError } from './http.js'
import type { HttpClient, RequestOptions } from './http.js'
import { combine } from './path.js'

const MANIFEST_BASE = 'https://raw.githubusercontent.com/NPBruce/valkyrie-store/refs/heads/master'

/** `ValkyrieConstants.ContentPackDownloadContainerExtension`. */
export const CONTENT_PACK_EXTENSION = '.valkyrieContentPack'
/** `ValkyrieConstants.ScenarioDownloadContainerExtension`. */
export const SCENARIO_EXTENSION = '.valkyrie'
/** `ValkyrieConstants.ContentPackManifestPath`, without its leading separator. */
export const LOCAL_MANIFEST_NAME = 'manifest.ini'

export type GameType = 'D2E' | 'MoM'

/** Mirrors `RemoteContentPackListMode`. */
export const ListMode = {
  ONLINE: 'ONLINE',
  LOCAL: 'LOCAL',
  DOWNLOADING: 'DOWNLOADING',
  ERROR_DOWNLOAD: 'ERROR_DOWNLOAD',
} as const

export type ListMode = (typeof ListMode)[keyof typeof ListMode]

export function manifestUrl(gameType: GameType): string {
  return `${MANIFEST_BASE}/${gameType}/contentPacksManifestDownload.ini`
}

export interface RemoteManagerOptions {
  fs: FileSystem
  http: HttpClient
  paths: StoragePaths
  gameType: GameType
}

export class RemoteContentPackManager {
  private readonly fs: FileSystem
  private readonly http: HttpClient
  private readonly paths: StoragePaths
  private readonly gameType: GameType

  readonly packs = new Map<string, RemoteContentPack>()
  mode: ListMode = ListMode.LOCAL
  errorDescription = ''

  constructor(options: RemoteManagerOptions) {
    this.fs = options.fs
    this.http = options.http
    this.paths = options.paths
    this.gameType = options.gameType
  }

  private get localManifestPath(): string {
    return combine(this.paths.customContentPackPath, LOCAL_MANIFEST_NAME)
  }

  /**
   * Fetches the manifest and reconciles it against what is installed.
   *
   * Offline, the installed packs stay listed and playable — the C# leaves
   * `remote_RemoteContentPack_data` empty on a failed download, which blanks
   * the screen even for content already on disk.
   */
  async refresh(options: RequestOptions = {}): Promise<ListMode> {
    this.mode = ListMode.DOWNLOADING
    this.errorDescription = ''

    let text: string
    try {
      text = await this.http.getText(manifestUrl(this.gameType), options)
    } catch (error) {
      this.errorDescription = describe(error)
      await this.loadInstalledOnly()
      this.mode = this.packs.size > 0 ? ListMode.LOCAL : ListMode.ERROR_DOWNLOAD
      return this.mode
    }

    this.packs.clear()
    for (const [identifier, fields] of readFromString(text).data) {
      this.packs.set(identifier, new RemoteContentPack(identifier, fields))
    }

    if (this.packs.size === 0) {
      this.errorDescription = 'ERROR: Quest list is empty'
      this.mode = ListMode.ERROR_DOWNLOAD
      return this.mode
    }

    await this.checkLocalAvailability()
    this.mode = ListMode.ONLINE
    return this.mode
  }

  /** Marks installed packs and flags those whose manifest version has moved. */
  async checkLocalAvailability(): Promise<void> {
    const local = await this.readLocalManifest()
    if (local === null) return

    for (const [identifier, pack] of this.packs) {
      const installed = local.getSection(identifier)
      if (installed === null) continue
      pack.downloaded = true
      pack.updateAvailable = installed.get('version') !== pack.version
    }
  }

  /** The packs on disk, for when the manifest cannot be reached. */
  private async loadInstalledOnly(): Promise<void> {
    const local = await this.readLocalManifest()
    if (local === null) return

    this.packs.clear()
    for (const [identifier, fields] of local.data) {
      const pack = new RemoteContentPack(identifier, fields)
      pack.downloaded = true
      this.packs.set(identifier, pack)
    }
  }

  private async readLocalManifest(): Promise<IniData | null> {
    const path = this.localManifestPath
    if (!(await this.fs.exists(path))) return null
    return readFromString(await this.fs.readText(path))
  }

  /** `package_url` + identifier + extension, as the C# composes it. */
  packageUrl(identifier: string): string {
    const pack = this.packs.get(identifier)
    if (pack === undefined)
      throw new Error(`Could not find key ${identifier} in remote content pack data.`)
    return pack.packageUrl + identifier + CONTENT_PACK_EXTENSION
  }

  /**
   * Downloads a pack and unpacks it, streaming rather than buffering — these
   * run to tens of megabytes and the browser tab has to stay responsive.
   */
  async download(identifier: string, options: RequestOptions = {}): Promise<string> {
    const url = this.packageUrl(identifier)
    const target = combine(this.paths.customContentPackPath, identifier)

    await this.fs.createDirectory(target)
    await extractStream(this.fs, this.http.getStream(url, options), target, ExtractMode.FULL)
    await this.setAvailability(identifier, true)
    return target
  }

  /**
   * Records a pack as installed, or removes it.
   *
   * The C# writes the pack's `ToString()` back through the ini parser to get
   * the section — and that `ToString()` emits `type=` twice and throws when
   * the pack has no image. The port writes the fields directly.
   */
  async setAvailability(identifier: string, available: boolean): Promise<void> {
    const pack = this.packs.get(identifier)
    if (pack === undefined)
      throw new Error(`Could not find key ${identifier} in remote content pack data.`)

    const manifest = (await this.readLocalManifest()) ?? new IniData()
    manifest.removeSection(identifier)

    if (available) {
      const section = new Map<string, string>([
        ['type', pack.type],
        ['defaultlanguage', pack.defaultLanguage],
        ['version', pack.version],
        ['url', pack.packageUrl],
      ])
      if (pack.image !== null) section.set('image', pack.image)
      for (const [language, name] of pack.languagesName) section.set(`name.${language}`, name)
      for (const [language, text] of pack.languagesDescription) {
        section.set(`description.${language}`, text)
      }
      manifest.addSection(identifier, section)
    } else {
      await this.fs.remove(combine(this.paths.customContentPackPath, identifier))
    }

    await this.fs.createDirectory(this.paths.customContentPackPath)
    await this.fs.writeText(this.localManifestPath, manifest.toString())

    pack.downloaded = available
    pack.updateAvailable = false
  }

  /** Installed packs, newest manifest update first. */
  installed(): RemoteContentPack[] {
    return [...this.packs.values()].filter((pack) => pack.downloaded)
  }

  /** Packs with a version different from the one on disk. */
  updatable(): RemoteContentPack[] {
    return [...this.packs.values()].filter((pack) => pack.updateAvailable)
  }
}

function describe(error: unknown): string {
  if (error instanceof HttpError) return `${error.status} ${error.statusText}`
  if (error instanceof NetworkError) return 'ERROR NETWORK'
  return error instanceof Error ? error.message : String(error)
}
