/**
 * Port of `unity/Assets/Scripts/Content/DictionaryI18n.cs`.
 *
 * A dictionary of KEY -> text across every available language, with a lazy
 * loading scheme: raw lines are kept per language and only parsed into a
 * lookup map when a key is actually asked for. Adding a required language
 * throws the parsed data away so it is rebuilt with the new language included.
 *
 * File reading (`AddDataFromFile`) is not ported — that belongs to the platform
 * layer. Feed `addData` the already-split lines.
 */

import { log } from '../ini/logger.js'

export const DEFAULT_LANGUAGE = 'English'

const TRIPLE_ENCLOSING = '|||'
const DOUBLE_QUOTE = '"'

/** Number of `"` separated sections, i.e. `split('"').length` in C#. */
function quoteSections(line: string): number {
  return line.split(DOUBLE_QUOTE).length
}

/** C# `string.Trim('\r', '\n')` — only those two characters, not all whitespace. */
function trimNewlines(value: string): string {
  let start = 0
  let end = value.length
  while (start < end && (value[start] === '\r' || value[start] === '\n')) start++
  while (end > start && (value[end - 1] === '\r' || value[end - 1] === '\n')) end--
  return value.slice(start, end)
}

/** C# `Split(",", 2)` — at most two parts, the second keeping every later comma. */
function splitOnFirstComma(line: string): string[] {
  const at = line.indexOf(',')
  return at === -1 ? [line] : [line.slice(0, at), line.slice(at + 1)]
}

/**
 * A line is "old format" unless its value begins with a quote. Old-format lines
 * terminate an entry immediately rather than opening a multi-line block.
 */
function isOldFormat(rawLine: string): boolean {
  const components = splitOnFirstComma(rawLine)
  const isNotOldFormat =
    components.length > 1 && components[1]!.length > 0 && components[1]![0] === DOUBLE_QUOTE
  return !isNotOldFormat
}

export class DictionaryI18n {
  /** Raw lines per language. Element 0 of each list is the `.,Language` header. */
  private rawData = new Map<string, string[]>()

  /** Parsed lookup per language. Rebuilt lazily; cleared when a language is added. */
  private data = new Map<string, Map<string, string>>()

  private requiredLanguages = new Set<string>([DEFAULT_LANGUAGE])
  private keyToGroup = new Map<string, string>()
  private groupToLanguage = new Map<string, string>()

  private loadedForEdit = false

  private _defaultLanguage = DEFAULT_LANGUAGE
  private _currentLanguage = DEFAULT_LANGUAGE
  private _fallbackLanguage = ''

  constructor(languageData?: readonly string[]) {
    if (languageData !== undefined) this.addData(languageData)
  }

  get defaultLanguage(): string {
    return this._defaultLanguage
  }

  set defaultLanguage(value: string) {
    this.addRequiredLanguage(value)
    this._defaultLanguage = value
  }

  get currentLanguage(): string {
    return this._currentLanguage
  }

  set currentLanguage(value: string) {
    this.addRequiredLanguage(value)
    this._currentLanguage = value
  }

  get fallbackLanguage(): string {
    return this._fallbackLanguage
  }

  set fallbackLanguage(value: string) {
    if (value !== '') this.addRequiredLanguage(value)
    this._fallbackLanguage = value
  }

  /**
   * Adds raw language data. The language name comes from the header line, which
   * is expected to look like `.,English`.
   */
  addData(languageData: readonly string[]): void {
    const rawDataToAdd: string[] = []

    let currentEntry: string[] = []
    let endOfLine = false
    let tripleQuoteMode = false

    for (const rawLine of languageData) {
      const line = trimNewlines(rawLine)
      const sections = quoteSections(line)
      const isFirstLine = currentEntry.length === 0
      currentEntry.push(line)

      const startsTripleQuotes = isFirstLine && line.includes(`,${TRIPLE_ENCLOSING}`)

      if (startsTripleQuotes || tripleQuoteMode) {
        tripleQuoteMode = !line.trimEnd().endsWith(TRIPLE_ENCLOSING)
        endOfLine = !tripleQuoteMode
      } else if (sections % 2 === 1) {
        // An even number of quote characters: the line is self-contained if it
        // is also the first line of the entry, otherwise it closes a block.
        endOfLine = isFirstLine && !tripleQuoteMode
      } else if (!isFirstLine || isOldFormat(line)) {
        endOfLine = !tripleQuoteMode
      }

      if (endOfLine) {
        rawDataToAdd.push(currentEntry.join('\n'))
        currentEntry = []
        endOfLine = false
        tripleQuoteMode = false
      }
    }

    if (currentEntry.length > 0) {
      // Preserved from the C#: the unterminated remainder is joined with a
      // literal backslash-n rather than a newline, unlike every complete entry.
      const combined = currentEntry.join('\\n')
      log(`Failed to parse language data properly, remaining values: ${combined}`)
      rawDataToAdd.push(combined)
    }

    const header = languageData[0]
    if (header === undefined) throw new RangeError('Language data has no header line')
    const headerParts = header.split(',')
    if (headerParts.length < 2) {
      throw new RangeError(`Language header has no language name: ${header}`)
    }
    const newLanguage = trimChar(headerParts[1]!, DOUBLE_QUOTE)

    const existing = this.rawData.get(newLanguage)
    if (existing === undefined) this.rawData.set(newLanguage, rawDataToAdd)
    else existing.push(...rawDataToAdd)
  }

  /** Merges another dictionary's raw data. Used to combine content packs. */
  merge(other: DictionaryI18n | null | undefined): void {
    if (other === null || other === undefined) return
    for (const [language, lines] of other.rawData) {
      const existing = this.rawData.get(language)
      if (existing === undefined) this.rawData.set(language, [...lines])
      else existing.push(...lines)
    }
  }

  /** Parses every language into `data`. Required before any edit. */
  private makeEditable(): void {
    if (this.loadedForEdit) return

    this.forceLoadAllLanguages()
    this.data = new Map()

    for (const [language, lines] of this.rawData) {
      const languageData = new Map<string, string>()
      this.data.set(language, languageData)

      // Element 0 is the header, so start at 1.
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i]!
        if (line.trimStart().startsWith('//')) continue

        const components = splitOnFirstComma(line)
        if (components.length !== 2) continue

        // First occurrence of a key wins.
        if (!languageData.has(components[0]!)) {
          languageData.set(components[0]!, this.parseEntry(components[1]!))
        }
      }
    }
    this.loadedForEdit = true
  }

  /** Adds or replaces an entry in the given language (default: current). */
  addEntry(key: string, value: string, language: string = this.currentLanguage): void {
    this.makeEditable()
    let languageData = this.data.get(language)
    if (languageData === undefined) {
      languageData = new Map<string, string>()
      this.data.set(language, languageData)
    }
    languageData.set(key, value)
  }

  /** Removes a key from every language. */
  remove(key: string): void {
    this.makeEditable()
    for (const languageData of this.data.values()) languageData.delete(key)
  }

  /** Removes every key starting with `prefix`, in every language. */
  removeKeyPrefix(prefix: string): void {
    this.makeEditable()
    for (const languageData of this.data.values()) {
      for (const key of [...languageData.keys()]) {
        if (key.startsWith(prefix)) languageData.delete(key)
      }
    }
  }

  /** Rewrites the prefix of every key starting with `oldPrefix`. */
  renamePrefix(oldPrefix: string, newPrefix: string): void {
    this.makeEditable()
    for (const languageData of this.data.values()) {
      const toRename = new Map<string, string>()
      for (const key of languageData.keys()) {
        if (key.startsWith(oldPrefix)) {
          toRename.set(key, newPrefix + key.slice(oldPrefix.length))
        }
      }
      for (const [oldKey, newKey] of toRename) {
        languageData.set(newKey, languageData.get(oldKey)!)
        languageData.delete(oldKey)
      }
    }
  }

  /**
   * Whether the key exists in any required language. Also has the side effect
   * of loading matching raw lines into `data`, which `getValue` relies on.
   */
  keyExists(key: string): boolean {
    for (const language of this.requiredLanguages) {
      if (this.data.get(language)?.has(key) === true) return true
    }

    // In edit mode the raw data may be stale, so it is not consulted.
    if (this.loadedForEdit) return false

    let found = false
    for (const [language, lines] of this.rawData) {
      if (!this.requiredLanguages.has(language)) continue
      found = this.lookInOneLanguage(language, lines, key) || found
    }

    if (!found) log(`Key not found: ${key}`)
    return found
  }

  /** Scans one language's raw lines for `key`, loading it into `data` if found. */
  private lookInOneLanguage(language: string, lines: readonly string[], key: string): boolean {
    let languageData = this.data.get(language)
    if (languageData === undefined) {
      languageData = new Map<string, string>()
      this.data.set(language, languageData)
    }

    if (languageData.has(key)) {
      log(`Duplicate Key in ${language} Dictionary: ${key}`)
      return true
    }

    const searched = `${key},`
    for (const raw of lines) {
      if (raw.startsWith(searched)) {
        languageData.set(key, this.parseEntry(raw.slice(key.length + 1)))
        return true
      }
    }
    return false
  }

  /**
   * Resolves a key: current language, then fallback, then default, then any.
   * Returns the key itself when it is not present at all.
   */
  getValue(key: string): string {
    if (!this.keyExists(key)) return key

    let secondLanguageValue: string | null = null
    if (this.groupToLanguage.size > 0) {
      const group = this.keyToGroup.get(key)
      const additionalLanguage = group === undefined ? undefined : this.groupToLanguage.get(group)
      if (additionalLanguage !== undefined) {
        const value = this.data.get(additionalLanguage)?.get(key)
        if (value !== undefined && value.length > 0) secondLanguageValue = value
      }
    }

    const current = this.data.get(this.currentLanguage)?.get(key)
    if (current !== undefined && !isNullOrWhiteSpace(current)) {
      return combine(current, secondLanguageValue)
    }

    if (this._fallbackLanguage !== '' && this._fallbackLanguage !== this.currentLanguage) {
      const fallback = this.data.get(this._fallbackLanguage)?.get(key)
      if (fallback !== undefined && !isNullOrWhiteSpace(fallback)) {
        return combine(fallback, secondLanguageValue)
      }
    }

    const fallbackDefault = this.data.get(this.defaultLanguage)?.get(key)
    if (fallbackDefault !== undefined && !isNullOrWhiteSpace(fallbackDefault)) {
      return combine(fallbackDefault, secondLanguageValue)
    }

    for (const languageData of this.data.values()) {
      const any = languageData.get(key)
      if (any !== undefined) return combine(any, secondLanguageValue)
    }

    return ''
  }

  /** Raw lines per language, regenerated from `data` if it has been edited. */
  serializeMultiple(): Map<string, string[]> {
    if (!this.loadedForEdit) return this.rawData

    this.rawData = new Map()
    for (const [language, languageData] of this.data) {
      const lines: string[] = [`.,${language}`]
      this.rawData.set(language, lines)

      for (const [key, value] of languageData) {
        const rawValue = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\\n')

        if (rawValue.includes(DOUBLE_QUOTE) && !rawValue.includes(TRIPLE_ENCLOSING)) {
          lines.push(`${key},${TRIPLE_ENCLOSING}${rawValue}${TRIPLE_ENCLOSING}`)
        } else if (
          rawValue.includes(DOUBLE_QUOTE) ||
          rawValue.includes(TRIPLE_ENCLOSING) ||
          rawValue.includes('\\n')
        ) {
          const quoted = DOUBLE_QUOTE + rawValue.replaceAll(DOUBLE_QUOTE, '""') + DOUBLE_QUOTE
          lines.push(`${key},${quoted}`)
        } else {
          lines.push(`${key},${rawValue}`)
        }
      }
    }
    return this.rawData
  }

  /** Unescapes newlines and strips triple-quote or quote enclosure. */
  parseEntry(entry: string): string {
    let parsed = entry.replaceAll('\\n', '\n')

    if (
      parsed.length >= TRIPLE_ENCLOSING.length * 2 &&
      parsed.startsWith(TRIPLE_ENCLOSING) &&
      parsed.trim().endsWith(TRIPLE_ENCLOSING)
    ) {
      parsed = parsed.slice(TRIPLE_ENCLOSING.length, parsed.length - TRIPLE_ENCLOSING.length)
    }

    if (parsed.length > 1 && parsed.startsWith(DOUBLE_QUOTE) && parsed.endsWith(DOUBLE_QUOTE)) {
      parsed = parsed.slice(1, parsed.length - 1)
      parsed = parsed.replaceAll('""', DOUBLE_QUOTE)
    }
    return parsed
  }

  /** Every language's value for a key. */
  extractAllMatches(key: string): Map<string, string> {
    this.forceLoadAllLanguages()
    this.keyExists(key)

    const result = new Map<string, string>()
    for (const [language, languageData] of this.data) {
      const value = languageData.get(key)
      if (value !== undefined) result.set(language, value)
    }
    return result
  }

  getLanguagesList(): string[] {
    return [...this.rawData.keys()]
  }

  setKeyToGroup(key: string, groupId: string): void {
    this.keyToGroup.set(key, groupId)
  }

  setGroupTranslationLanguage(groupId: string, language: string): void {
    if (isNullOrWhiteSpace(language)) {
      this.groupToLanguage.delete(groupId)
      return
    }
    this.groupToLanguage.set(groupId, language)
    this.addRequiredLanguage(language)
  }

  private forceLoadAllLanguages(): void {
    for (const language of this.getLanguagesList()) this.addRequiredLanguage(language)
  }

  /** Marks a language as needed. Adding a new one discards the parsed cache. */
  addRequiredLanguage(language: string): void {
    if (this.requiredLanguages.has(language)) return
    this.requiredLanguages.add(language)
    this.data = new Map()
  }
}

/** C# `string.Trim(char)` — strips every leading and trailing occurrence. */
function trimChar(value: string, char: string): string {
  let start = 0
  let end = value.length
  while (start < end && value[start] === char) start++
  while (end > start && value[end - 1] === char) end--
  return value.slice(start, end)
}

/** C# `string.IsNullOrWhiteSpace`. */
function isNullOrWhiteSpace(value: string): boolean {
  return value.trim().length === 0
}

/** Renders a group's secondary translation alongside the primary one. */
function combine(mainValue: string, secondValue: string | null): string {
  if (secondValue === null || secondValue === mainValue) return mainValue
  return `${mainValue} [${secondValue}]`
}
