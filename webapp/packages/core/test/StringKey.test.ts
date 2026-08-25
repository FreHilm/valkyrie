/**
 * Migrated from `unity/Assets/UnitTests/Editor/StringKeyTests.cs`.
 *
 * Behaviour verified byte-for-byte against the C# by the i18n differential
 * harness; these tests document intent and guard regressions.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { DictionaryI18n } from '../src/i18n/DictionaryI18n.js'
import { Localization } from '../src/i18n/Localization.js'
import { StringKey, splitRemoveEmpty } from '../src/i18n/StringKey.js'

let loc: Localization

beforeEach(() => {
  loc = new Localization()
  for (const name of ['ffg', 'val', 'qst']) {
    loc.addDictionary(name, new DictionaryI18n(['.,English']))
  }
})

describe('StringKey construction', () => {
  it('Constructor_ValidKeyFormat_ParsesDictCorrectly', () => {
    expect(StringKey.parse('{val:KEY}', loc).dict).toBe('val')
  })

  it('Constructor_ValidKeyFormat_ParsesKeyCorrectly', () => {
    expect(StringKey.parse('{ffg:MONSTER_NAME}', loc).key).toBe('MONSTER_NAME')
  })

  it('Constructor_ValidKeyWithParameters_ParsesParametersCorrectly', () => {
    // Verified against the C#: a '{0}' parameter puts a '}' before the end of
    // the string, which fails the "first '}' is last character" guard, so this
    // stays a literal rather than parsing into dict/key.
    const sk = StringKey.parse('{qst:X:{0}:y}', loc)

    expect(sk.dict).toBeNull()
    expect(sk.key).toBe('{qst:X:{0}:y}')
    expect(sk.fullKey).toBe('{qst:X:{0}:y}')
  })

  it('Constructor_ValidKeyWithMultipleColonParameters_ParsesCorrectly', () => {
    const sk = StringKey.parse('{val:A:B}', loc)

    expect(sk.dict).toBe('val')
    expect(sk.key).toBe('A')
    expect(sk.fullKey).toBe('{val:A:B}')
  })

  it('Constructor_PlainTextNotKey_SetsKeyAsInput', () => {
    const sk = StringKey.parse('plain text', loc)

    expect(sk.dict).toBeNull()
    expect(sk.key).toBe('plain text')
  })

  it('Constructor_InvalidKeyFormat_TreatsAsPlainText', () => {
    const sk = StringKey.parse('{unknown:KEY}', loc)

    expect(sk.dict).toBeNull()
    expect(sk.key).toBe('{unknown:KEY}')
  })

  it('Constructor_MixedTextAndKeyFormat_TreatsAsMixedKey', () => {
    // The first '}' is not the last character, so it stays a literal — but the
    // regex matched, so lookup is still allowed and the embedded key resolves.
    const sk = StringKey.parse('leading {val:KEY}', loc)

    expect(sk.dict).toBeNull()
    expect(sk.key).toBe('leading {val:KEY}')
  })

  it('Constructor_DictAndKey_SetsPropertiesCorrectly', () => {
    const sk = new StringKey('val', 'KEY')

    expect(sk.dict).toBe('val')
    expect(sk.key).toBe('KEY')
    expect(sk.isKey()).toBe(true)
  })

  it('Constructor_DictAndKeyWithDoLookupFalse_SetsPreventLookup', () => {
    expect(new StringKey('val', 'KEY', false).translate({ localization: loc })).toBe('{val:KEY}')
  })

  it('Constructor_DictAndKeyWithStringParam_SetsParameterFormat', () => {
    expect(StringKey.withParam('val', 'KEY', 'x').fullKey).toBe('{val:KEY:{0}:x}')
  })

  it('Constructor_DictAndKeyWithIntParam_SetsParameterFormat', () => {
    expect(StringKey.withParam('val', 'KEY', 42).fullKey).toBe('{val:KEY:{0}:42}')
  })

  it('Constructor_DictAndKeyWithStringKeyParam_UsesFullKeyOfParam', () => {
    const param = new StringKey('ffg', 'MONSTER')

    expect(StringKey.withParam('val', 'KEY', param).fullKey).toBe('{val:KEY:{0}:{ffg:MONSTER}}')
  })

  it('Constructor_TemplateWithTwoParams_SetsParametersCorrectly', () => {
    const template = new StringKey('val', 'KEY')

    expect(StringKey.fromTemplate(template, '{0}', 'value').fullKey).toBe('{val:KEY:{0}:value}')
  })
})

describe('StringKey properties', () => {
  it('IsKey_ValidKeyFormat_ReturnsTrue', () => {
    expect(StringKey.parse('{val:KEY}', loc).isKey()).toBe(true)
  })

  it('IsKey_PlainText_ReturnsFalse', () => {
    expect(StringKey.parse('plain', loc).isKey()).toBe(false)
  })

  it('IsKey_NullDict_ReturnsFalse', () => {
    expect(new StringKey(null, 'x').isKey()).toBe(false)
  })

  it('FullKey_NullDict_ReturnsKeyOnly', () => {
    expect(new StringKey(null, 'just text').fullKey).toBe('just text')
  })

  it('FullKey_WithDict_ReturnsFormattedKey', () => {
    expect(new StringKey('val', 'KEY').fullKey).toBe('{val:KEY}')
  })

  it('FullKey_WithDictAndParameters_ReturnsFullFormat', () => {
    expect(StringKey.withParam('val', 'KEY', 'p').fullKey).toBe('{val:KEY:{0}:p}')
  })

  it('ToString_PlainKey_ReturnsKey', () => {
    expect(new StringKey(null, 'text').toString()).toBe('text')
  })

  it('ToString_FormattedKey_ReturnsFullKey', () => {
    expect(new StringKey('val', 'KEY').toString()).toBe('{val:KEY}')
  })

  it('ToString_EscapesNewlines', () => {
    expect(new StringKey(null, 'a\nb').toString()).toBe('a\\nb')
  })

  it('NULL_StaticField_HasNullDictAndEmptyKey', () => {
    expect(StringKey.NULL.dict).toBeNull()
    expect(StringKey.NULL.key).toBe('')
    expect(StringKey.NULL.isKey()).toBe(false)
  })
})

describe('StringKey.parse edge cases', () => {
  it('does not treat a parameterised full key as a key when re-parsed', () => {
    // The C# requires the first '}' to be the last character, and '{0}' breaks
    // that, so this round-trip deliberately does not work.
    const sk = StringKey.parse('{val:KEY:{0}:param}', loc)

    expect(sk.dict).toBeNull()
    expect(sk.key).toBe('{val:KEY:{0}:param}')
  })

  it('rejects an unregistered dictionary prefix', () => {
    const empty = new Localization()

    expect(StringKey.parse('{val:KEY}', empty).isKey()).toBe(false)
  })

  it('treats a bare key with no dictionary as a literal (DEVIATION)', () => {
    // The C# indexes parts[1] here and throws IndexOutOfRangeException.
    const sk = StringKey.parse('{val:}', loc)

    expect(sk.dict).toBeNull()
    expect(sk.key).toBe('{val:}')
  })

  it('does not look up plain text when no dictionary matched', () => {
    expect(StringKey.parse('plain', loc).translate({ localization: loc })).toBe('plain')
  })

  it('unescapes newlines in literal text', () => {
    expect(StringKey.parse('line1\\nline2', loc).translate({ localization: loc })).toBe(
      'line1\nline2',
    )
  })
})

describe('splitRemoveEmpty (C# Split with count and RemoveEmptyEntries)', () => {
  // The interaction between the count limit and empty-entry removal is not
  // obvious: empties are dropped first, and the last element is the raw
  // remainder from the start of the count-th non-empty segment.
  it.each([
    ['val:KEY', ['val', 'KEY']],
    ['val:KEY:{0}:x', ['val', 'KEY', '{0}:x']],
    ['val::KEY', ['val', 'KEY']],
    ['a::b::c', ['a', 'b', 'c']],
    ['a::b::c::d', ['a', 'b', 'c::d']],
    ['a:::b', ['a', 'b']],
    ['::a::b', ['a', 'b']],
    ['a::', ['a']],
    ['::', []],
    ['', []],
    [':::', []],
    ['a:b:c:d:e', ['a', 'b', 'c:d:e']],
  ])('splits %j into %j', (input, expected) => {
    expect(splitRemoveEmpty(input, ':', 3)).toEqual(expected)
  })
})

describe('malformed dictionary names', () => {
  it('treats input as a literal when the generated regex is invalid', () => {
    // Dictionary names are interpolated into the pattern unescaped, so a name
    // containing a regex metacharacter produces an invalid pattern. The C#
    // catches ArgumentException here; this catches the SyntaxError.
    const broken = new Localization()
    broken.addDictionary('(', new DictionaryI18n(['.,English']))

    const sk = StringKey.parse('{val:KEY}', broken)

    expect(sk.dict).toBeNull()
    expect(sk.key).toBe('{val:KEY}')
  })
})
