/**
 * Port of `unity/Assets/Scripts/Content/LocalizationRead.cs`.
 *
 * Owns the named dictionaries (`ffg`, `val`, `qst`, ...) and resolves
 * `{dict:KEY}` lookups, including nested ones and `find:replace` parameters.
 *
 * The C# is a static class. Here it is an instance, with a module-level
 * `defaultLocalization` standing in for that global so existing call shapes
 * still work — but tests and content packs can use an isolated instance
 * instead of resetting global state between cases.
 */

import { log } from '../ini/logger.js'
import type { DictionaryI18n } from './DictionaryI18n.js'
import type { StringKey } from './StringKey.js'

/** One lookup may not expand more than this many nested references. */
const RECURSIVE_LIMIT = 20

/** Every dictionary prefix is this long, which the C# index arithmetic assumes. */
const DICT_PREFIX_LENGTH = 3

export class Localization {
  readonly dicts = new Map<string, DictionaryI18n>()

  changeCurrentLangTo(newLang: string): void {
    for (const dict of this.dicts.values()) dict.currentLanguage = newLang
  }

  addRequiredLanguage(newLang: string): void {
    for (const dict of this.dicts.values()) dict.addRequiredLanguage(newLang)
  }

  /** Adds a dictionary, merging into an existing one of the same name. */
  addDictionary(name: string, dict: DictionaryI18n): void {
    const existing = this.dicts.get(name)
    if (existing !== undefined) existing.merge(dict)
    else this.dicts.set(name, dict)
  }

  removeDictionary(name: string): void {
    this.dicts.delete(name)
  }

  selectDictionary(name: string | null): DictionaryI18n | null {
    if (name === null) return null
    return this.dicts.get(name) ?? null
  }

  /**
   * A regex matching any registered dictionary prefix, e.g. `{(ffg|val|qst):`.
   * Returns a never-matching pattern when nothing is registered.
   */
  lookupRegexKey(): string {
    if (this.dicts.size === 0) return '(?!)'
    return `{(${[...this.dicts.keys()].join('|')}):`
  }

  /** Resolves a key to text, expanding nested lookups. */
  dictLookup(input: StringKey): string {
    let output = input.fullKey
    let recursiveCount = 0

    const lookupRegex = new RegExp(this.lookupRegexKey())
    let match = lookupRegex.exec(output)

    while (match !== null && recursiveCount < RECURSIVE_LIMIT) {
      const pos = match.index
      const lookupStart = pos + '{ffg:'.length
      const lookupEnd = findLookupEnd(output, lookupStart)

      const lookup = output.slice(lookupStart, lookupEnd)
      const dict = output.slice(pos + 1, pos + 1 + DICT_PREFIX_LENGTH)

      let result = this.dictQuery(dict, lookup)

      // FFG markup uses square brackets; Unity rich text uses angle brackets.
      // Underline is unsupported, so it is rendered as bold.
      result = result
        .replaceAll('[u]', '<b>')
        .replaceAll('[/u]', '</b>')
        .replaceAll('[i]', '<i>')
        .replaceAll('[/i]', '</i>')
        .replaceAll('[b]', '<b>')
        .replaceAll('[/b]', '</b>')

      // Some FFG text leaves tags unclosed.
      while (countOccurrences(result, '<b>') > countOccurrences(result, '</b>')) result += '</b>'
      while (countOccurrences(result, '<i>') > countOccurrences(result, '</i>')) result += '</i>'

      output = replaceAllLiteral(output, `{${dict}:${lookup}}`, result)
      recursiveCount++

      match = lookupRegex.exec(output)
    }

    if (recursiveCount === RECURSIVE_LIMIT) {
      log(
        `ERROR Recursive loop limit reached translating ${input.fullKey}. Dictionary entry must be fixed.`,
      )
    }

    return output
  }

  /** Whether the key behind a `{dict:KEY}` reference exists. */
  checkLookup(input: StringKey): boolean {
    const output = input.fullKey
    const match = new RegExp(this.lookupRegexKey()).exec(output)
    if (match === null) return false

    const pos = match.index
    const lookupStart = pos + '{ffg:'.length
    const lookupEnd = findLookupEnd(output, lookupStart)

    const lookup = output.slice(lookupStart, lookupEnd)
    const dict = output.slice(pos + 1, pos + 1 + DICT_PREFIX_LENGTH)

    const currentDict = this.selectDictionary(dict)
    if (currentDict === null) return false
    return currentDict.keyExists(splitTopLevel(lookup)[0]!)
  }

  /** Adds or replaces a scenario text entry. */
  updateScenarioText(key: string, text: string): void {
    this.dicts.get('qst')?.addEntry(key, text)
  }

  registerKeyInGroup(translationKey: StringKey, groupId: string): void {
    this.selectDictionary(translationKey.dict)?.setKeyToGroup(translationKey.key, groupId)
  }

  setGroupTranslationLanguage(groupId: string, language: string): void {
    for (const dict of this.dicts.values()) dict.setGroupTranslationLanguage(groupId, language)
  }

  /**
   * Looks up a key with optional `find:replace` parameter pairs, e.g.
   * `A_GOES_B:{A}:Peter:{B}:Dining Room`.
   */
  private dictQuery(dict: string, input: string): string {
    // Fast path: nothing to substitute.
    if (!input.includes('{')) return this.dictKeyLookup(dict, input)

    const elements = splitTopLevel(input)
    let fetched = this.dictKeyLookup(dict, elements[0]!)

    for (let i = 2; i < elements.length; i += 2) {
      fetched = replaceAllLiteral(fetched, elements[i - 1]!, elements[i]!)
    }
    return fetched
  }

  private dictKeyLookup(dict: string, key: string): string {
    const currentDict = this.selectDictionary(dict)
    if (currentDict === null) {
      log('Error: current dictionary not loaded')
      return key
    }
    return currentDict.getValue(key)
  }
}

/** The registry `StringKey` uses when none is supplied. Mirrors the C# static. */
export const defaultLocalization = new Localization()

/**
 * Finds the index of the `}` closing a lookup that starts at `lookupStart`,
 * counting nested braces.
 *
 * The C# reads `output[lookupEnd]` with no bounds check, so an unterminated
 * lookup throws IndexOutOfRangeException. Here it stops at the end of the
 * string — see docs/i18n-port-deviations.md.
 */
function findLookupEnd(output: string, lookupStart: number): number {
  let bracketLevel = 1
  let lookupEnd = lookupStart
  while (bracketLevel > 0) {
    lookupEnd++
    if (lookupEnd >= output.length) return output.length
    if (output[lookupEnd] === '{') bracketLevel++
    if (output[lookupEnd] === '}') bracketLevel--
  }
  return lookupEnd
}

/** Splits on `:` at brace depth zero. */
function splitTopLevel(input: string): string[] {
  const elements: string[] = []
  let bracketLevel = 0
  let lastSection = 0

  for (let index = 0; index < input.length; index++) {
    const char = input[index]
    if (char === '{') bracketLevel++
    if (char === '}') bracketLevel--
    if (char === ':' && bracketLevel === 0) {
      elements.push(input.slice(lastSection, index))
      lastSection = index + 1
    }
  }
  elements.push(input.slice(lastSection))
  return elements
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    count++
    index = haystack.indexOf(needle, index + needle.length)
  }
  return count
}

/** C# `string.Replace` — literal, all occurrences, no-op on an empty needle. */
function replaceAllLiteral(haystack: string, needle: string, replacement: string): string {
  if (needle.length === 0) return haystack
  return haystack.split(needle).join(replacement)
}
