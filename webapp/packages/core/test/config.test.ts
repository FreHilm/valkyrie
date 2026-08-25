/**
 * Migrated from `unity/Assets/UnitTests/Editor/ConfigFileTests.cs`.
 *
 * That suite does not exercise the `ConfigFile` class directly — it asserts on
 * the parse-and-read patterns the class is built from ("simulating ConfigFile
 * behavior"). Those cases are kept, then re-expressed against the real class,
 * and the parsing cases are extended with the culture handling that the C#
 * call sites get wrong.
 */

import { describe, expect, it, vi } from 'vitest'
import { ConfigFile } from '../src/config/ConfigFile.js'
import {
  boolOr,
  floatOr,
  formatFloatInvariant,
  intOr,
  parseBoolInvariant,
  parseFloatInvariant,
  parseIntInvariant,
} from '../src/config/parse.js'
import { readFromString } from '../src/ini/IniRead.js'

describe('value parsing (migrated from ConfigFileTests.cs)', () => {
  it('BooleanParsing_TrueString_ParsesAsTrue', () => {
    const data = readFromString('[Settings]\nenabled=True')

    expect(parseBoolInvariant(data.get('Settings', 'enabled'))).toBe(true)
  })

  it('BooleanParsing_FalseString_ParsesAsFalse', () => {
    const data = readFromString('[Settings]\nenabled=False')

    expect(parseBoolInvariant(data.get('Settings', 'enabled'))).toBe(false)
  })

  it('BooleanParsing_LowercaseTrue_ParsesAsTrue', () => {
    const data = readFromString('[Settings]\nenabled=true')

    expect(parseBoolInvariant(data.get('Settings', 'enabled'))).toBe(true)
  })

  it('BooleanParsing_MissingKey_ReturnsEmptyString', () => {
    const data = readFromString('[Settings]\nother=1')

    expect(data.get('Settings', 'enabled')).toBe('')
  })

  it('IntegerParsing_ValidInteger_ParsesCorrectly', () => {
    const data = readFromString('[Settings]\nvolume=75')

    expect(parseIntInvariant(data.get('Settings', 'volume'))).toBe(75)
  })

  it('IntegerParsing_NegativeInteger_ParsesCorrectly', () => {
    const data = readFromString('[Settings]\noffset=-10')

    expect(parseIntInvariant(data.get('Settings', 'offset'))).toBe(-10)
  })

  it('IntegerParsing_Zero_ParsesCorrectly', () => {
    const data = readFromString('[Settings]\ncount=0')

    expect(parseIntInvariant(data.get('Settings', 'count'))).toBe(0)
  })

  it('StringValue_SimpleString_ReturnsAsIs', () => {
    expect(readFromString('[Settings]\nlang=English').get('Settings', 'lang')).toBe('English')
  })

  it('StringValue_StringWithSpaces_ReturnsWithSpaces', () => {
    expect(readFromString('[Settings]\npath=my game path').get('Settings', 'path')).toBe(
      'my game path',
    )
  })

  it('StringValue_QuotedString_QuotesRemoved', () => {
    expect(readFromString('[Settings]\ngreeting="Hello World"').get('Settings', 'greeting')).toBe(
      'Hello World',
    )
  })

  it('DefaultValue_MissingSection_ReturnsEmptyString', () => {
    expect(readFromString('[Other]\na=1').get('Settings', 'anything')).toBe('')
  })

  it('DefaultValue_MissingKey_ReturnsEmptyString', () => {
    expect(readFromString('[Settings]\na=1').get('Settings', 'missing')).toBe('')
  })

  it('DefaultValue_EmptyData_ReturnsEmptyString', () => {
    expect(readFromString('').get('Settings', 'anything')).toBe('')
  })
})

describe('invariant parsing (behaviour verified against .NET)', () => {
  it('parses decimals with a dot regardless of the host locale', () => {
    // The C# call sites use float.TryParse(s, out v) with the *current*
    // culture. Under sv-SE and fr-FR that returns false for "0.5" (volume
    // silently becomes 0); under de-DE it returns 5, because "." is the German
    // group separator. See docs/ini-port-deviations.md.
    expect(parseFloatInvariant('0.5')).toBe(0.5)
  })

  it('rejects a comma as a decimal separator', () => {
    // "0,5" is what a German or Swedish Unity build writes today.
    expect(parseFloatInvariant('0,5')).toBe(5)
  })

  it('accepts group separators the way .NET AllowThousands does', () => {
    expect(parseFloatInvariant('1,000.5')).toBe(1000.5)
    expect(parseFloatInvariant('1,2,3')).toBe(123)
    expect(parseFloatInvariant('5,')).toBe(5)
    expect(parseFloatInvariant(',5')).toBeNull()
  })

  it('rejects trailing NBSP for numbers but accepts it for booleans', () => {
    // JS trim() strips U+00A0; .NET number parsing does not. Sharing one trim
    // helper between these two would be wrong in both directions.
    expect(parseIntInvariant('5 ')).toBeNull()
    expect(parseFloatInvariant('5 ')).toBeNull()
    expect(parseBoolInvariant('true ')).toBe(true)
    expect(parseFloatInvariant('NaN ')).toBeNaN()
  })

  it('accepts ASCII whitespace around numbers', () => {
    expect(parseIntInvariant(' \t75\r\n ')).toBe(75)
    expect(parseFloatInvariant('\t0.5\r\n')).toBe(0.5)
  })

  it('rejects trailing garbage', () => {
    expect(parseIntInvariant('75abc')).toBeNull()
    expect(parseFloatInvariant('1.2.3')).toBeNull()
    expect(parseBoolInvariant('yes')).toBeNull()
  })

  it('enforces the Int32 range', () => {
    expect(parseIntInvariant('2147483647')).toBe(2147483647)
    expect(parseIntInvariant('2147483648')).toBeNull()
    expect(parseIntInvariant('-2147483648')).toBe(-2147483648)
    expect(parseIntInvariant('-2147483649')).toBeNull()
  })

  it('applies 32-bit float rounding and overflow', () => {
    expect(parseFloatInvariant('3.4e39')).toBe(Number.POSITIVE_INFINITY)
    expect(parseFloatInvariant('1e-46')).toBe(0)
    expect(parseFloatInvariant('0.30000000000000004')).toBe(Math.fround(0.3))
  })

  it('handles the named float symbols with an optional sign', () => {
    expect(parseFloatInvariant('Infinity')).toBe(Number.POSITIVE_INFINITY)
    expect(parseFloatInvariant('-Infinity')).toBe(Number.NEGATIVE_INFINITY)
    expect(parseFloatInvariant('+NaN')).toBeNaN()
    expect(parseFloatInvariant('+ NaN')).toBeNull()
  })

  it('round-trips a volume through format and parse', () => {
    for (const volume of [0, 0.5, 0.75, 1]) {
      expect(parseFloatInvariant(formatFloatInvariant(volume))).toBe(volume)
    }
  })

  it('formats the named float symbols', () => {
    expect(formatFloatInvariant(Number.NaN)).toBe('NaN')
    expect(formatFloatInvariant(Number.POSITIVE_INFINITY)).toBe('Infinity')
    expect(formatFloatInvariant(Number.NEGATIVE_INFINITY)).toBe('-Infinity')
  })

  it('falls back when the value is absent or malformed', () => {
    expect(floatOr('', 1)).toBe(1)
    expect(floatOr('0,5x', 1)).toBe(1)
    expect(intOr('nope', 42)).toBe(42)
    expect(boolOr('', true)).toBe(true)
  })
})

describe('ConfigFile pack management (migrated from ConfigFileTests.cs)', () => {
  it('GetPacks_ExistingPacks_ReturnsPackKeys', () => {
    const config = ConfigFile.parse('[D2EPacks]\nbase_game=\nconversion_kit=\nmanor_of_ravens=')

    expect(config.getPacks('D2E')).toEqual(['base_game', 'conversion_kit', 'manor_of_ravens'])
  })

  it('GetPacks_NoPacks_ReturnsEmpty', () => {
    expect(new ConfigFile().getPacks('D2E')).toEqual([])
  })

  it('AddPack_NewPack_AddsToSection', () => {
    const config = new ConfigFile()
    config.addPack('D2E', 'new_expansion')

    expect(config.getPacks('D2E')).toContain('new_expansion')
  })

  it('RemovePack_ExistingPack_RemovesFromSection', () => {
    const config = new ConfigFile()
    config.addPack('D2E', 'pack1')
    config.addPack('D2E', 'pack2')

    config.removePack('D2E', 'pack1')

    expect(config.getPacks('D2E')).toEqual(['pack2'])
  })

  it('returns an empty language map when the section is absent', () => {
    expect(new ConfigFile().getPackLanguages('D2E').size).toBe(0)
  })

  it('GetPackLanguages_PacksWithLanguages_ReturnsDictionary', () => {
    const config = ConfigFile.parse('[D2EPacks]\nbase_game=English\nexpansion1=French\nexpansion2=')

    expect(Object.fromEntries(config.getPackLanguages('D2E'))).toEqual({
      base_game: 'English',
      expansion1: 'French',
      expansion2: '',
    })
  })
})

describe('ConfigFile persistence contract', () => {
  it('notifies on every mutation so the host can persist', () => {
    const onChanged = vi.fn()
    const config = new ConfigFile(undefined, { onChanged })

    config.addPack('D2E', 'a')
    config.removePack('D2E', 'a')
    config.set('UserConfig', 'music', '0.5')

    expect(onChanged).toHaveBeenCalledTimes(3)
  })

  it('reports pack language changes for the localization layer', () => {
    const onPackLanguageChanged = vi.fn()
    const config = new ConfigFile(undefined, { onPackLanguageChanged })

    config.addPack('MoM', 'pack', 'German')
    config.removePack('MoM', 'pack')

    expect(onPackLanguageChanged).toHaveBeenNthCalledWith(1, 'pack', 'German')
    expect(onPackLanguageChanged).toHaveBeenNthCalledWith(2, 'pack', '')
  })

  it('round-trips through serialize and parse', () => {
    const config = new ConfigFile()
    config.addPack('D2E', 'base', 'English')
    config.set('UserConfig', 'music', formatFloatInvariant(0.5))

    const reloaded = ConfigFile.parse(config.serialize())

    expect(reloaded.getPacks('D2E')).toEqual(['base'])
    expect(reloaded.getPackLanguages('D2E').get('base')).toBe('English')
    expect(parseFloatInvariant(reloaded.get('UserConfig', 'music'))).toBe(0.5)
  })

  it('treats absent config as empty rather than failing', () => {
    expect(ConfigFile.parse(null).getPacks('D2E')).toEqual([])
    expect(ConfigFile.parse('').getPacks('D2E')).toEqual([])
  })
})
