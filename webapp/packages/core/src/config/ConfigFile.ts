/**
 * Port of `unity/Assets/Scripts/ConfigFile.cs`.
 *
 * The C# version reads and writes `config.ini` directly in its constructor and
 * in `Save()`. That is deliberately not reproduced: the web storage layer
 * (T-011) is asynchronous, and inventing a synchronous file contract here
 * would prejudge that decision. Instead this class owns the config *data* and
 * reports when it changed; the platform layer decides how and when to persist.
 */

import { IniData } from '../ini/IniData.js'
import { readFromString } from '../ini/IniRead.js'

/** Called after any mutation, so the host can persist. Mirrors C# Save(). */
export type ConfigChangedHandler = (config: ConfigFile) => void

/**
 * Called when a pack's translation language changes. Stands in for
 * `LocalizationRead.SetGroupTranslationLanguage`, which arrives with T-006.
 */
export type PackLanguageHandler = (pack: string, language: string) => void

export interface ConfigFileOptions {
  onChanged?: ConfigChangedHandler
  onPackLanguageChanged?: PackLanguageHandler
}

export class ConfigFile {
  readonly data: IniData
  private readonly onChanged: ConfigChangedHandler | undefined
  private readonly onPackLanguageChanged: PackLanguageHandler | undefined

  constructor(data: IniData = new IniData(), options: ConfigFileOptions = {}) {
    this.data = data
    this.onChanged = options.onChanged
    this.onPackLanguageChanged = options.onPackLanguageChanged
  }

  /** Builds a config from `config.ini` text. Empty or absent input is valid. */
  static parse(content: string | null, options: ConfigFileOptions = {}): ConfigFile {
    return new ConfigFile(content === null ? new IniData() : readFromString(content), options)
  }

  /** The `config.ini` text to persist. */
  serialize(): string {
    return this.data.toString()
  }

  /** Reads a raw config value, or "" when absent. */
  get(section: string, key: string): string {
    return this.data.get(section, key)
  }

  /** Writes a raw config value and notifies. */
  set(section: string, key: string, value: string): void {
    this.data.add(section, key, value)
    this.onChanged?.(this)
  }

  private packSection(gameType: string): string {
    return `${gameType}Packs`
  }

  /** Enabled content pack ids for a game type. */
  getPacks(gameType: string): string[] {
    const section = this.data.getSection(this.packSection(gameType))
    return section === null ? [] : [...section.keys()]
  }

  /** Pack id to translation language. Packs with no language map to "". */
  getPackLanguages(gameType: string): Map<string, string> {
    return new Map(this.data.getSection(this.packSection(gameType)) ?? [])
  }

  addPack(gameType: string, pack: string, language = ''): void {
    this.data.add(this.packSection(gameType), pack, language)
    this.onPackLanguageChanged?.(pack, language)
    this.onChanged?.(this)
  }

  removePack(gameType: string, pack: string): void {
    this.data.remove(this.packSection(gameType), pack)
    this.onPackLanguageChanged?.(pack, '')
    this.onChanged?.(this)
  }
}
