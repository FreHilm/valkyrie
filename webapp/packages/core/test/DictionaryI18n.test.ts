/**
 * Migrated from `unity/Assets/UnitTests/Editor/DictionaryI18nTests.cs`.
 *
 * That suite has 74 tests but constructs `DictionaryI18n` in only four of them.
 * The rest — every `ParseEntryLogic_*`, `CsvSplitLogic_*`, `QuoteCountLogic_*`,
 * `SerializationLogic_*` case — reimplements the algorithm inline and asserts
 * against its own copy, so it would pass even if the real class were broken.
 *
 * Those cases are kept here, with their original names, but pointed at the
 * actual implementation.
 */

import { describe, expect, it } from 'vitest'
import { DictionaryI18n } from '../src/i18n/DictionaryI18n.js'

const EN = (...lines: string[]) => ['.,English', ...lines]
const FR = (...lines: string[]) => ['.,French', ...lines]
const DE = (...lines: string[]) => ['.,German', ...lines]

function build(...blocks: string[][]): DictionaryI18n {
  const dict = new DictionaryI18n()
  for (const block of blocks) dict.addData(block)
  return dict
}

/** Round-trips a single value through addData + getValue. */
function valueOf(rawValue: string): string {
  return build(EN(`KEY,${rawValue}`)).getValue('KEY')
}

describe('ParseEntry (now against the real implementation)', () => {
  const dict = new DictionaryI18n()

  it('ParseEntryLogic_SimpleValue_ReturnedUnchanged', () => {
    expect(dict.parseEntry('simple value')).toBe('simple value')
  })

  it('ParseEntryLogic_ValueWithEscapedNewline_ConvertsToRealNewline', () => {
    expect(dict.parseEntry('line1\\nline2')).toBe('line1\nline2')
  })

  it('ParseEntryLogic_MultipleEscapedNewlines_AllConverted', () => {
    expect(dict.parseEntry('a\\nb\\nc')).toBe('a\nb\nc')
  })

  it('ParseEntryLogic_QuotedValue_TrimmsQuotes', () => {
    expect(dict.parseEntry('"quoted value"')).toBe('quoted value')
  })

  it('ParseEntryLogic_QuotedValueWithEscapedQuotes_HandlesCorrectly', () => {
    expect(dict.parseEntry('"value with ""quotes"" inside"')).toBe('value with "quotes" inside')
  })

  it('ParseEntryLogic_TripleQuotedValue_TrimsTripleQuotes', () => {
    expect(dict.parseEntry('|||triple value|||')).toBe('triple value')
  })

  it('ParseEntryLogic_TripleQuotedWithInternalQuotes_PreservesInternalQuotes', () => {
    expect(dict.parseEntry('|||has "quotes" inside|||')).toBe('has "quotes" inside')
  })

  it('ParseEntryLogic_EmptyQuotedString_ReturnsEmpty', () => {
    expect(dict.parseEntry('""')).toBe('')
  })

  it('ParseEntryLogic_SingleCharacter_ReturnedUnchanged', () => {
    expect(dict.parseEntry('x')).toBe('x')
  })

  it('ParseEntryLogic_EmptyString_ReturnsEmpty', () => {
    expect(dict.parseEntry('')).toBe('')
  })

  it('leaves a lone quote alone', () => {
    expect(dict.parseEntry('"')).toBe('"')
  })

  it('strips triple quotes before quotes, so both layers unwrap', () => {
    expect(dict.parseEntry('|||"quoted"|||')).toBe('quoted')
  })
})

describe('CSV splitting and comments (via addData)', () => {
  it('CsvSplitLogic_SimpleKeyValue_SplitsCorrectly', () => {
    expect(valueOf('value')).toBe('value')
  })

  it('CsvSplitLogic_KeyValueWithCommaInValue_ValuePreserved', () => {
    expect(valueOf('a,b,c')).toBe('a,b,c')
  })

  it('CsvSplitLogic_KeyWithEmptyValue_TwoComponents', () => {
    // Verified against the C#: an empty value is blank, so every language check
    // is skipped, and the trailing "any match" loop returns it anyway — "" is
    // the result, not the key.
    expect(build(EN('KEY,')).getValue('KEY')).toBe('')
  })

  it('CsvSplitLogic_QuotedValueWithComma_SplitsAtFirstComma', () => {
    expect(valueOf('"a,b"')).toBe('a,b')
  })

  it('CommentDetection_LineStartsWithDoubleSlash_IsComment', () => {
    const dict = build(EN('//a comment', 'KEY,value'))
    dict.addEntry('OTHER', 'x')

    expect([...dict.serializeMultiple().get('English')!]).not.toContain('//a comment')
  })

  it('CommentDetection_LineContainsDoubleSlashNotAtStart_IsNotComment', () => {
    expect(valueOf('http://example.com')).toBe('http://example.com')
  })
})

describe('multi-line entry assembly', () => {
  it('joins a quoted block spanning several lines', () => {
    expect(build(EN('KEY,"line one', 'line two"', 'NEXT,plain')).getValue('KEY')).toBe(
      'line one\nline two',
    )
  })

  it('joins a triple-quoted block spanning several lines', () => {
    expect(build(EN('KEY,|||line one', 'line two|||', 'NEXT,plain')).getValue('KEY')).toBe(
      'line one\nline two',
    )
  })

  it('keeps a following key separate from a multi-line block', () => {
    expect(build(EN('KEY,"line one', 'line two"', 'NEXT,plain')).getValue('NEXT')).toBe('plain')
  })

  it('LineTrimming_RemovesBothCRLF', () => {
    expect(build(EN('KEY,value\r')).getValue('KEY')).toBe('value')
  })
})

describe('language headers', () => {
  it('LanguageHeaderParsing_ExtractsLanguageName', () => {
    expect(build(EN('KEY,v')).getLanguagesList()).toEqual(['English'])
  })

  it('LanguageHeaderParsing_QuotedLanguageName_TrimmsQuotes', () => {
    expect(build(['.,"English"', 'KEY,v']).getLanguagesList()).toEqual(['English'])
  })

  it('LanguageHeaderParsing_LanguageWithSpaces_Preserved', () => {
    expect(build(['.,Brazilian Portuguese', 'KEY,v']).getLanguagesList()).toEqual([
      'Brazilian Portuguese',
    ])
  })

  it('appends to an existing language rather than replacing it', () => {
    const dict = build(EN('A,1'), EN('B,2'))

    expect(dict.getLanguagesList()).toEqual(['English'])
    expect(dict.getValue('A')).toBe('1')
    expect(dict.getValue('B')).toBe('2')
  })

  it('throws on a header with no language name (DEVIATION)', () => {
    // The C# throws IndexOutOfRangeException from Split(',')[1].
    expect(() => build(['no-comma-header'])).toThrow(RangeError)
  })
})

describe('getValue language resolution', () => {
  const blocks = [
    EN('KEY,english value', 'ONLY_EN,en only', 'BLANK_ELSEWHERE,en fallback'),
    FR('KEY,French value', 'BLANK_ELSEWHERE,'),
    DE('KEY,German value'),
  ]

  const configured = (config: {
    currentLanguage?: string
    fallbackLanguage?: string
  }): DictionaryI18n => {
    const dict = build(...blocks)
    if (config.fallbackLanguage !== undefined) dict.fallbackLanguage = config.fallbackLanguage
    if (config.currentLanguage !== undefined) dict.currentLanguage = config.currentLanguage
    return dict
  }

  it('GetValue_CurrentLanguagePresent_ReturnsCurrentLanguage', () => {
    expect(configured({ currentLanguage: 'French' }).getValue('KEY')).toBe('French value')
  })

  it('GetValue_CurrentLanguageMissing_FallbackPresent_ReturnsFallback', () => {
    expect(
      configured({ currentLanguage: 'Ukrainian', fallbackLanguage: 'French' }).getValue('KEY'),
    ).toBe('French value')
  })

  it('GetValue_CurrentAndFallbackMissing_ReturnsDefaultLanguage', () => {
    expect(
      configured({ currentLanguage: 'Ukrainian', fallbackLanguage: 'Klingon' }).getValue('KEY'),
    ).toBe('english value')
  })

  it('GetValue_EmptyFallback_SkipsFallbackAndUsesDefault', () => {
    expect(configured({ currentLanguage: 'Ukrainian', fallbackLanguage: '' }).getValue('KEY')).toBe(
      'english value',
    )
  })

  it('GetValue_FallbackSameAsCurrentLanguage_NotCheckedTwice_ReturnsDefault', () => {
    expect(
      configured({ currentLanguage: 'French', fallbackLanguage: 'French' }).getValue('KEY'),
    ).toBe('French value')
  })

  it('GetValue_FallbackSameAsDefault_FallbackUsedCorrectly', () => {
    expect(
      configured({ currentLanguage: 'Ukrainian', fallbackLanguage: 'English' }).getValue('KEY'),
    ).toBe('english value')
  })

  it('returns the key itself when it is missing everywhere', () => {
    expect(configured({ currentLanguage: 'English' }).getValue('NOT_PRESENT')).toBe('NOT_PRESENT')
  })

  it('falls through a blank value in the current language', () => {
    expect(configured({ currentLanguage: 'French' }).getValue('BLANK_ELSEWHERE')).toBe(
      'en fallback',
    )
  })

  it('finds a key present in only one language', () => {
    expect(configured({ currentLanguage: 'German' }).getValue('ONLY_EN')).toBe('en only')
  })
})

describe('group translation (second language shown alongside)', () => {
  const blocks = [EN('KEY,english value'), FR('KEY,French value')]

  it('CombineLogic_DifferentValues_ReturnsCombined', () => {
    const dict = build(...blocks)
    dict.currentLanguage = 'English'
    dict.setKeyToGroup('KEY', 'g1')
    dict.setGroupTranslationLanguage('g1', 'French')

    expect(dict.getValue('KEY')).toBe('english value [French value]')
  })

  it('CombineLogic_SameValue_ReturnsMainOnly', () => {
    const dict = build(...blocks)
    dict.currentLanguage = 'French'
    dict.setKeyToGroup('KEY', 'g1')
    dict.setGroupTranslationLanguage('g1', 'French')

    expect(dict.getValue('KEY')).toBe('French value')
  })

  it('CombineLogic_NoSecondLanguage_ReturnsMainOnly', () => {
    expect(build(...blocks).getValue('KEY')).toBe('english value')
  })

  it('GroupToLanguage_RemoveWithEmptyString_Works', () => {
    const dict = build(...blocks)
    dict.currentLanguage = 'English'
    dict.setKeyToGroup('KEY', 'g1')
    dict.setGroupTranslationLanguage('g1', 'French')
    dict.setGroupTranslationLanguage('g1', '  ')

    expect(dict.getValue('KEY')).toBe('english value')
  })
})

describe('editing', () => {
  it('DictionaryStructure_ReplaceValue_Works', () => {
    const dict = build(EN('KEY,original'))
    dict.addEntry('KEY', 'replaced')

    expect(dict.getValue('KEY')).toBe('replaced')
  })

  it('DictionaryStructure_RemoveKey_Works', () => {
    const dict = build(EN('KEY,value', 'OTHER,x'))
    dict.remove('KEY')

    expect(dict.getValue('KEY')).toBe('KEY')
    expect(dict.getValue('OTHER')).toBe('x')
  })

  it('PrefixRemoval_MatchingPrefix_RemovedFromList', () => {
    const dict = build(EN('Q_A,1', 'Q_B,2', 'KEEP,3'))
    dict.removeKeyPrefix('Q_')

    expect(dict.getValue('Q_A')).toBe('Q_A')
    expect(dict.getValue('KEEP')).toBe('3')
  })

  it('PrefixRename_MatchingPrefix_KeysRenamed', () => {
    const dict = build(EN('OLD_A,1', 'KEEP,2'))
    dict.renamePrefix('OLD_', 'NEW_')

    expect(dict.getValue('NEW_A')).toBe('1')
    expect(dict.getValue('OLD_A')).toBe('OLD_A')
    expect(dict.getValue('KEEP')).toBe('2')
  })

  it('AddData_MergesRawDataFromOtherDictionary_Successfully', () => {
    const target = build(EN('A,1'))
    target.merge(build(FR('B,2')))

    expect(target.getLanguagesList()).toEqual(['English', 'French'])
    // French is not required yet, so the merged key is not resolvable until it
    // becomes the current language. Verified against the C#.
    expect(target.getValue('B')).toBe('B')
    target.currentLanguage = 'French'
    expect(target.getValue('B')).toBe('2')
  })

  it('AddData_NullOtherDictionary_DoesNothing', () => {
    const target = build(EN('A,1'))
    target.merge(null)

    expect(target.getLanguagesList()).toEqual(['English'])
  })

  it('DictionaryStructure_MultipleLanguages_Isolated', () => {
    const dict = build(EN('KEY,en'), FR('KEY,fr'))
    dict.addEntry('KEY', 'edited', 'German')

    expect(dict.getValue('KEY')).toBe('en')
    expect(dict.extractAllMatches('KEY').get('German')).toBe('edited')
  })
})

describe('serialization', () => {
  const roundTrip = (value: string): string => {
    const dict = new DictionaryI18n(['.,English'])
    dict.addEntry('KEY', value)
    const line = dict.serializeMultiple().get('English')![1]!
    return line.slice('KEY,'.length)
  }

  it('SerializationLogic_SimpleValue_NoQuotesAdded', () => {
    expect(roundTrip('simple')).toBe('simple')
  })

  it('SerializationLogic_ValueWithNewlines_GetsQuoted', () => {
    expect(roundTrip('a\nb')).toBe('"a\\nb"')
  })

  it('SerializationLogic_ValueWithQuotes_GetsTripleQuoted', () => {
    expect(roundTrip('say "hi"')).toBe('|||say "hi"|||')
  })

  it('SerializationLogic_ValueWithTripleQuotes_GetsDoubleQuoted', () => {
    expect(roundTrip('a|||b"c')).toBe('"a|||b""c"')
  })

  it('re-parses everything it writes', () => {
    for (const value of ['plain', 'a\nb', 'say "hi"', 'a|||b"c', 'comma,separated', '']) {
      const source = new DictionaryI18n(['.,English'])
      source.addEntry('KEY', value)
      const lines = source.serializeMultiple().get('English')!

      const reloaded = new DictionaryI18n([...lines])

      expect(reloaded.getValue('KEY')).toBe(value)
    }
  })

  it('returns the untouched raw data when nothing was edited', () => {
    const lines = EN('KEY,value')

    expect([...build(lines).serializeMultiple().get('English')!]).toEqual(lines)
  })
})

describe('required languages', () => {
  it('RequiredLanguages_DefaultContainsEnglish', () => {
    // English resolves without being requested explicitly.
    expect(build(EN('KEY,v')).getValue('KEY')).toBe('v')
  })

  it('a language is only searched once it is required', () => {
    const dict = build(EN('KEY,en'), FR('ONLY_FR,fr'))

    expect(dict.getValue('ONLY_FR')).toBe('ONLY_FR')

    dict.currentLanguage = 'French'
    expect(dict.getValue('ONLY_FR')).toBe('fr')
  })

  it('extractAllMatches forces every language to load', () => {
    const dict = build(EN('KEY,en'), FR('KEY,fr'), DE('KEY,de'))

    expect(Object.fromEntries(dict.extractAllMatches('KEY'))).toEqual({
      English: 'en',
      French: 'fr',
      German: 'de',
    })
  })
})
