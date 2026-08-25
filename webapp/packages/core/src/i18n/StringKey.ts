/**
 * Port of `unity/Assets/Scripts/Content/StringKey.cs`.
 *
 * A reference to a localizable string, either `{dict:KEY}` or literal text.
 *
 * The C# has six overlapping constructors that TypeScript cannot express as
 * overloads without ambiguity (`(string, string, bool)` vs `(string, string,
 * string)`), so the extra ones become named factories:
 *
 * | C# | here |
 * | --- | --- |
 * | `new StringKey(unknownKey)` | `StringKey.parse(unknownKey, localization)` |
 * | `new StringKey(dict, key, doLookup)` | `new StringKey(dict, key, doLookup)` |
 * | `new StringKey(dict, key, string \| int \| StringKey)` | `StringKey.withParam(dict, key, param)` |
 * | `new StringKey(template, p1, p2)` | `StringKey.fromTemplate(template, p1, p2)` |
 *
 * The common call site, `new StringKey('val', 'KEY')`, is unchanged.
 */

import type { Localization } from './Localization.js'
import { defaultLocalization } from './Localization.js'

export class StringKey {
  /** Empty key that never looks anything up. */
  static readonly NULL = new StringKey(null, '', false)

  readonly dict: string | null
  readonly key: string
  private readonly parameters: string | null
  private readonly preventLookup: boolean

  constructor(dict: string | null, key: string, doLookup = true, parameters: string | null = null) {
    this.dict = dict
    this.key = key
    this.preventLookup = !doLookup
    this.parameters = parameters
  }

  /**
   * Parses `{dict:KEY}` text, falling back to a literal. Needs the localization
   * registry because the set of valid dictionary prefixes comes from it.
   *
   * Note that a key carrying parameters does *not* round-trip through here:
   * the C# requires the first `}` to be the last character, and `{0}` in the
   * parameters breaks that. Preserved deliberately.
   */
  static parse(unknownKey: string, localization: Localization = defaultLocalization): StringKey {
    let matchSuccess: boolean
    try {
      matchSuccess = new RegExp(localization.lookupRegexKey()).test(unknownKey)
    } catch {
      matchSuccess = false
    }

    if (
      matchSuccess &&
      unknownKey.startsWith('{') &&
      unknownKey.endsWith('}') &&
      unknownKey.indexOf('}') === unknownKey.length - 1
    ) {
      const parts = splitRemoveEmpty(unknownKey.slice(1, unknownKey.length - 1), ':', 3)
      if (parts.length < 2) {
        // The C# indexes parts[1] unguarded and throws IndexOutOfRangeException
        // here — see docs/i18n-port-deviations.md.
        return new StringKey(null, unknownKey, false)
      }
      return new StringKey(parts[0]!, parts[1]!, true, parts.length === 3 ? parts[2]! : null)
    }

    return new StringKey(null, unknownKey, matchSuccess)
  }

  /** A key with a single `{0}` substitution. */
  static withParam(
    dict: string | null,
    key: string,
    param: string | number | StringKey,
  ): StringKey {
    const text =
      param instanceof StringKey ? param.fullKey : typeof param === 'number' ? String(param) : param
    return new StringKey(dict, key, true, `{0}:${text}`)
  }

  /** Reuses a template's dict and key with an explicit `find:replace` pair. */
  static fromTemplate(template: StringKey, param1: string, param2: string): StringKey {
    return new StringKey(template.dict, template.key, true, `${param1}:${param2}`)
  }

  /** `{dict:key}` or `{dict:key:params}`, or the literal text when not a key. */
  get fullKey(): string {
    if (this.dict === null) return this.key
    const params = this.parameters === null ? '' : `:${this.parameters}`
    return `{${this.dict}:${this.key}${params}}`
  }

  isKey(): boolean {
    return this.dict !== null
  }

  /** Resolves to text in the current language. */
  translate(options: TranslateOptions = {}): string {
    const { emptyIfNotFound = false, localization = defaultLocalization } = options

    if (this.preventLookup) {
      // Literals may carry escaped newlines; keys get theirs from the dictionary.
      return this.fullKey.replaceAll('\\n', '\n')
    }

    if (emptyIfNotFound && this.isKey() && !this.keyExists(localization)) return ''
    return localization.dictLookup(this)
  }

  keyExists(localization: Localization = defaultLocalization): boolean {
    if (this.isKey() && !this.preventLookup) return localization.checkLookup(this)
    return false
  }

  toString(): string {
    return this.fullKey.replaceAll('\n', '\\n')
  }
}

export interface TranslateOptions {
  /** Return "" instead of the raw key when the key is missing. */
  emptyIfNotFound?: boolean
  localization?: Localization
}

/**
 * C# `Split(char[], count, StringSplitOptions.RemoveEmptyEntries)`.
 *
 * Empty segments are dropped, and `count` caps the number of results with the
 * final element holding the unsplit remainder. The interaction between the two
 * is not obvious, so it is pinned by the differential harness.
 */
export function splitRemoveEmpty(value: string, separator: string, count: number): string[] {
  if (count <= 0) return []

  // Empty segments are dropped *before* the count applies, and the final
  // element is the raw remainder measured from the start of the count-th
  // non-empty segment — so "a::b::c::d" split 3 ways is ["a", "b", "c::d"],
  // not ["a", "b", ":c::d"]. Verified against .NET; see the i18n harness.
  const segments: string[] = []
  const starts: number[] = []

  let index = 0
  for (;;) {
    const next = value.indexOf(separator, index)
    const end = next === -1 ? value.length : next
    if (end > index) {
      starts.push(index)
      segments.push(value.slice(index, end))
    }
    if (next === -1) break
    index = next + separator.length
  }

  const remainderStart = starts[count - 1]
  if (remainderStart === undefined) return segments
  return [...segments.slice(0, count - 1), value.slice(remainderStart)]
}
