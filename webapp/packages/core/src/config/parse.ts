/**
 * Culture-invariant value parsing for config and content values.
 *
 * These replace the bare `float.TryParse(s, out v)` / `int.Parse(s)` calls in
 * the Unity code, which use the *current* culture and are the cause of a real
 * shipped bug — see `docs/ini-port-deviations.md`.
 *
 * Semantics were pinned by running .NET's parsers over a shared corpus and
 * diffing, not by reading the docs. Two results worth keeping in mind:
 *
 *  - Number parsing treats only U+0009-U+000D and U+0020 as whitespace.
 *    U+00A0 (NBSP) is rejected — but JS `String.prototype.trim()` strips it,
 *    so trimming with `.trim()` before parsing would wrongly accept "5\u00A0".
 *  - `bool.TryParse` uses the *broader* Unicode whitespace set, so it does
 *    accept NBSP. The two are deliberately not sharing a trim helper.
 *
 * Every function returns `null` on failure, mirroring `TryParse` returning
 * false and leaving the out-parameter at its default.
 */

/** .NET's number-parsing whitespace set. Deliberately excludes U+00A0. */
const NUMBER_WHITESPACE = new Set(['\u0009', '\u000A', '\u000B', '\u000C', '\u000D', '\u0020'])

function trimNumberWhitespace(value: string): string {
  let start = 0
  let end = value.length
  while (start < end && NUMBER_WHITESPACE.has(value[start]!)) start++
  while (end > start && NUMBER_WHITESPACE.has(value[end - 1]!)) end--
  return value.slice(start, end)
}

const INT32_MIN = -2147483648
const INT32_MAX = 2147483647

/** Equivalent of `bool.TryParse` — "true"/"false", case- and whitespace-insensitive. */
export function parseBoolInvariant(value: string): boolean | null {
  // bool.TryParse trims Char.IsWhiteSpace plus NUL, which is close enough to
  // JS trim() for our inputs; NUL is stripped explicitly.
  // eslint-disable-next-line no-control-regex -- bool.TryParse strips NUL too
  const trimmed = value.replace(/^\u0000+|\u0000+$/g, '').trim()
  if (trimmed.toLowerCase() === 'true') return true
  if (trimmed.toLowerCase() === 'false') return false
  return null
}

/** Equivalent of `int.TryParse(s, NumberStyles.Integer, InvariantCulture, out v)`. */
export function parseIntInvariant(value: string): number | null {
  const trimmed = trimNumberWhitespace(value)
  if (!/^[+-]?[0-9]+$/.test(trimmed)) return null
  const parsed = Number(trimmed)
  if (parsed < INT32_MIN || parsed > INT32_MAX) return null
  return parsed
}

/**
 * Equivalent of
 * `float.TryParse(s, NumberStyles.Float | NumberStyles.AllowThousands, InvariantCulture, out v)`.
 *
 * Result is rounded to 32-bit precision, because the Unity code stores these
 * in `float` and the config round-trips through that precision.
 */
export function parseFloatInvariant(value: string): number | null {
  // NaN/Infinity go through a different code path in .NET that trims the
  // broader Unicode whitespace set, so "NaN\u00A0" parses while "5\u00A0"
  // does not. A sign is allowed, but not separated from the symbol.
  const symbol = /^([+-]?)(nan|infinity)$/i.exec(value.trim())
  if (symbol) {
    if (symbol[2]!.toLowerCase() === 'nan') return Number.NaN
    return symbol[1] === '-' ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY
  }

  const trimmed = trimNumberWhitespace(value)

  // AllowThousands is far looser than the name suggests: separators may repeat
  // and may trail ("5,," is 5, "1,2,3" is 123), but only in the integer part,
  // which must itself start with a digit — ",5" is rejected. Separators in the
  // fraction or exponent reject the whole value.
  const NUMBER = /^[+-]?(?:[0-9][0-9,]*(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/
  if (!NUMBER.test(trimmed)) return null

  return Math.fround(Number(trimmed.replace(/,/g, '')))
}

/**
 * Equivalent of `float.TryParse(s, NumberStyles.Float, InvariantCulture, out v)`
 * — the explicit overload used throughout `ContentTypes.cs`.
 *
 * Identical to {@link parseFloatInvariant} except that group separators are
 * rejected: `NumberStyles.Float` is
 * `AllowLeadingWhite | AllowTrailingWhite | AllowLeadingSign |
 *  AllowDecimalPoint | AllowExponent` and does **not** include
 * `AllowThousands`. So content declaring `health=0,5` parses as 0 here, where
 * the bare `TryParse` overload would read it as 5.
 */
export function parseFloatStrict(value: string): number | null {
  const symbol = /^([+-]?)(nan|infinity)$/i.exec(value.trim())
  if (symbol) {
    if (symbol[2]!.toLowerCase() === 'nan') return Number.NaN
    return symbol[1] === '-' ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY
  }

  const trimmed = trimNumberWhitespace(value)
  const NUMBER = /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/
  if (!NUMBER.test(trimmed)) return null

  return Math.fround(Number(trimmed))
}

/** Reads a value and converts it, falling back when absent or malformed. */
export function boolOr(value: string, fallback: boolean): boolean {
  return parseBoolInvariant(value) ?? fallback
}

export function intOr(value: string, fallback: number): number {
  return parseIntInvariant(value) ?? fallback
}

export function floatOr(value: string, fallback: number): number {
  return parseFloatInvariant(value) ?? fallback
}

/**
 * Formats a number the way the config file should store it: invariant, and
 * round-trippable by {@link parseFloatInvariant} regardless of the reader's
 * locale. Replaces the culture-dependent `value.ToString()` in OptionsScreen.
 */
export function formatFloatInvariant(value: number): string {
  if (Number.isNaN(value)) return 'NaN'
  if (value === Number.POSITIVE_INFINITY) return 'Infinity'
  if (value === Number.NEGATIVE_INFINITY) return '-Infinity'

  const rounded = Math.fround(value)
  // Negative zero prints with its sign in .NET, unlike JS String().
  if (rounded === 0) return Object.is(rounded, -0) ? '-0' : '0'

  // .NET Core renders a float as the shortest decimal that round-trips at
  // *float* precision, so 1.1666666666 stored as a float prints "1.1666666"
  // rather than the full double expansion.
  for (let digits = 1; digits <= 9; digits++) {
    const candidate = rounded.toPrecision(digits)
    if (Math.fround(Number(candidate)) === rounded) return String(Number(candidate))
  }
  return String(rounded)
}
