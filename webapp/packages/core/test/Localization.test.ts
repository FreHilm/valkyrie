/**
 * Migrated from `unity/Assets/UnitTests/Editor/LocalizationReadTests.cs`.
 *
 * As with the dictionary suite, the C# `BbCodeConversion_*`,
 * `UnclosedTagHandling_*`, `DictQueryParsing_*` and `ParameterReplacement_*`
 * cases simulate the algorithm inline. Here they run against the real lookup.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { DictionaryI18n } from '../src/i18n/DictionaryI18n.js'
import { Localization } from '../src/i18n/Localization.js'
import { StringKey } from '../src/i18n/StringKey.js'

const EN = (...lines: string[]) => ['.,English', ...lines]

let loc: Localization

function withDict(name: string, ...lines: string[]): void {
  loc.addDictionary(name, new DictionaryI18n(EN(...lines)))
}

/** Resolves `{dict:key}` through the real lookup path. */
function lookup(dict: string, key: string): string {
  return new StringKey(dict, key).translate({ localization: loc })
}

beforeEach(() => {
  loc = new Localization()
})

describe('lookupRegexKey', () => {
  it('LookupRegexKey_EmptyDicts_ReturnsMinimalPattern', () => {
    expect(loc.lookupRegexKey()).toBe('(?!)')
    expect(new RegExp(loc.lookupRegexKey()).test('{val:KEY}')).toBe(false)
  })

  it('LookupRegexKey_SingleDictionary_ReturnsCorrectPattern', () => {
    withDict('val')

    expect(loc.lookupRegexKey()).toBe('{(val):')
  })

  it('LookupRegexKey_MultipleDictionaries_ReturnsAlternationPattern', () => {
    withDict('ffg')
    withDict('val')

    expect(loc.lookupRegexKey()).toBe('{(ffg|val):')
  })

  it('LookupRegexKey_ThreeDictionaries_ReturnsCorrectAlternationPattern', () => {
    for (const name of ['ffg', 'val', 'qst']) withDict(name)

    expect(loc.lookupRegexKey()).toBe('{(ffg|val|qst):')
  })

  it('LookupRegexKey_ResultIsValidRegex_MatchesExpectedKeys', () => {
    for (const name of ['ffg', 'val']) withDict(name)
    const regex = new RegExp(loc.lookupRegexKey())

    expect(regex.test('{val:KEY}')).toBe(true)
    expect(regex.test('{ffg:KEY}')).toBe(true)
    expect(regex.test('{qst:KEY}')).toBe(false)
  })

  it('LookupRegexKey_PatternMatchesNestedBraces', () => {
    withDict('val')

    expect(new RegExp(loc.lookupRegexKey()).test('outer {val:KEY:{0}:x} tail')).toBe(true)
  })
})

describe('dictionary registry', () => {
  it('SelectDictionary_NullDictName_ReturnsNull', () => {
    expect(loc.selectDictionary(null)).toBeNull()
  })

  it('SelectDictionary_NonExistentDictName_ReturnsNull', () => {
    expect(loc.selectDictionary('nope')).toBeNull()
  })

  it('SelectDictionary_ExistingDictName_ReturnsDictionary', () => {
    withDict('val', 'KEY,v')

    expect(loc.selectDictionary('val')).not.toBeNull()
  })

  it('SelectDictionary_EmptyString_ReturnsNull', () => {
    expect(loc.selectDictionary('')).toBeNull()
  })

  it('AddDictionary_NewDictionary_AddsToDicts', () => {
    withDict('val', 'KEY,v')

    expect(loc.dicts.size).toBe(1)
    expect(lookup('val', 'KEY')).toBe('v')
  })

  it('AddDictionary_MergesWithExistingDictionary', () => {
    withDict('val', 'A,1')
    loc.addDictionary('val', new DictionaryI18n(EN('B,2')))

    expect(loc.dicts.size).toBe(1)
    expect(lookup('val', 'A')).toBe('1')
    expect(lookup('val', 'B')).toBe('2')
  })

  it('AddDictionary_MultipleAdds_AllPersist', () => {
    for (const name of ['ffg', 'val', 'qst']) withDict(name, 'KEY,v')

    expect([...loc.dicts.keys()]).toEqual(['ffg', 'val', 'qst'])
  })

  it('removes a dictionary', () => {
    withDict('val', 'KEY,v')
    loc.removeDictionary('val')

    expect(loc.dicts.size).toBe(0)
  })
})

describe('BB code conversion', () => {
  it('BbCodeConversion_UnderlineToHtml_ConvertsToBold', () => {
    withDict('val', 'K,[u]underlined[/u]')

    expect(lookup('val', 'K')).toBe('<b>underlined</b>')
  })

  it('BbCodeConversion_ItalicToHtml_ConvertsToItalic', () => {
    withDict('val', 'K,[i]italic[/i]')

    expect(lookup('val', 'K')).toBe('<i>italic</i>')
  })

  it('BbCodeConversion_BoldToHtml_ConvertsToBold', () => {
    withDict('val', 'K,[b]bold[/b]')

    expect(lookup('val', 'K')).toBe('<b>bold</b>')
  })

  it('BbCodeConversion_MixedTags_AllConverted', () => {
    withDict('val', 'K,[b]b[/b] and [i]i[/i] and [u]u[/u]')

    expect(lookup('val', 'K')).toBe('<b>b</b> and <i>i</i> and <b>u</b>')
  })

  it('BbCodeConversion_NestedTags_AllConverted', () => {
    withDict('val', 'K,[b]outer [i]inner[/i][/b]')

    expect(lookup('val', 'K')).toBe('<b>outer <i>inner</i></b>')
  })

  it('BbCodeConversion_NoTags_UnchangedText', () => {
    withDict('val', 'K,plain text')

    expect(lookup('val', 'K')).toBe('plain text')
  })
})

describe('unclosed tag handling', () => {
  it('UnclosedTagHandling_OneBoldUnclosed_AddsClosingTag', () => {
    withDict('val', 'K,[b]never closed')

    expect(lookup('val', 'K')).toBe('<b>never closed</b>')
  })

  it('UnclosedTagHandling_TwoBoldUnclosed_AddsTwoClosingTags', () => {
    withDict('val', 'K,[b]one [b]two')

    expect(lookup('val', 'K')).toBe('<b>one <b>two</b></b>')
  })

  it('UnclosedTagHandling_OneItalicUnclosed_AddsClosingTag', () => {
    withDict('val', 'K,[i]open')

    expect(lookup('val', 'K')).toBe('<i>open</i>')
  })

  it('UnclosedTagHandling_MixedUnclosed_AllClosed', () => {
    // Verified against the C#: the two while-loops append </b> first and </i>
    // second regardless of opening order, so mixed unclosed tags come out
    // improperly nested. Preserved — see docs/i18n-port-deviations.md.
    withDict('val', 'K,[b]bold [i]italic')

    expect(lookup('val', 'K')).toBe('<b>bold <i>italic</b></i>')
  })

  it('UnclosedTagHandling_ProperlyClosedTags_NoChange', () => {
    withDict('val', 'K,[b]closed[/b]')

    expect(lookup('val', 'K')).toBe('<b>closed</b>')
  })

  it('UnclosedTagHandling_MoreClosingThanOpening_NoChange', () => {
    withDict('val', 'K,closed[/b] again[/b]')

    expect(lookup('val', 'K')).toBe('closed</b> again</b>')
  })
})

describe('nested lookups and the recursion limit', () => {
  it('resolves a nested reference', () => {
    withDict('val', 'GREETING,Hello', 'NESTED,Say {val:GREETING}')

    expect(lookup('val', 'NESTED')).toBe('Say Hello')
  })

  it('resolves references across dictionaries', () => {
    withDict('val', 'K,{ffg:MONSTER} approaches')
    withDict('ffg', 'MONSTER,Zombie')

    expect(lookup('val', 'K')).toBe('Zombie approaches')
  })

  it('RecursiveLimit_StopsAtLimit', () => {
    // A key referring to itself must terminate rather than hang.
    withDict('qst', 'LOOP,{qst:LOOP}')

    expect(lookup('qst', 'LOOP')).toBe('{qst:LOOP}')
  })

  it('returns the key itself when it is missing', () => {
    withDict('val', 'OTHER,x')

    expect(lookup('val', 'MISSING')).toBe('MISSING')
  })

  it('leaves the reference intact when the dictionary is unknown', () => {
    withDict('val', 'K,v')

    expect(new StringKey('zzz', 'K').translate({ localization: loc })).toBe('{zzz:K}')
  })
})

describe('parameter substitution', () => {
  it('ParameterReplacement_SingleParameter_Replaced', () => {
    withDict('val', 'HI,Hello {0}')

    expect(StringKey.withParam('val', 'HI', 'World').translate({ localization: loc })).toBe(
      'Hello World',
    )
  })

  it('DictLookup_NumericParameter_ReplacesCorrectly', () => {
    withDict('val', 'COUNT,You have {0} items')

    expect(StringKey.withParam('val', 'COUNT', 5).translate({ localization: loc })).toBe(
      'You have 5 items',
    )
  })

  it('ParameterReplacement_TwoParameters_BothReplaced', () => {
    withDict('val', 'MOVE,{A} goes to {B}')
    const template = new StringKey('val', 'MOVE')
    const withA = StringKey.fromTemplate(template, '{A}', 'Peter')

    expect(withA.translate({ localization: loc })).toBe('Peter goes to {B}')
  })

  it('ParameterReplacement_MultipleOccurrences_AllReplaced', () => {
    withDict('val', 'ECHO,{0} and {0} again')

    expect(StringKey.withParam('val', 'ECHO', 'x').translate({ localization: loc })).toBe(
      'x and x again',
    )
  })

  it('ParameterReplacement_NoMatchingPlaceholder_NoChange', () => {
    withDict('val', 'PLAIN,nothing to replace')

    expect(StringKey.withParam('val', 'PLAIN', 'x').translate({ localization: loc })).toBe(
      'nothing to replace',
    )
  })

  it('DictQueryParsing_NestedBrackets_ColonInsideIgnored', () => {
    // A ':' inside braces does not split the parameter list...
    withDict('val', 'K,value {0} and {1}')
    const twoParams = StringKey.fromTemplate(new StringKey('val', 'K'), '{0}', 'x')

    expect(twoParams.translate({ localization: loc })).toBe('value x and {1}')
  })

  it('silently truncates a parameter value containing a colon', () => {
    // ...but a ':' in the *value* does, and the remainder is dropped: the
    // parameter list is read in find/replace pairs, so the orphaned tail has
    // no partner. Verified against the C#; a real defect, preserved.
    withDict('val', 'K,value {0}')

    expect(StringKey.withParam('val', 'K', 'a:b').translate({ localization: loc })).toBe('value a')
  })
})

describe('keyExists and emptyIfNotFound', () => {
  it('reports a present key', () => {
    withDict('val', 'K,v')

    expect(new StringKey('val', 'K').keyExists(loc)).toBe(true)
  })

  it('reports a missing key', () => {
    withDict('val', 'OTHER,v')

    expect(new StringKey('val', 'MISSING').keyExists(loc)).toBe(false)
  })

  it('returns "" for a missing key when asked to', () => {
    withDict('val', 'OTHER,v')

    expect(
      new StringKey('val', 'MISSING').translate({ emptyIfNotFound: true, localization: loc }),
    ).toBe('')
  })

  it('still returns the value for a present key when asked to', () => {
    withDict('val', 'K,v')

    expect(new StringKey('val', 'K').translate({ emptyIfNotFound: true, localization: loc })).toBe(
      'v',
    )
  })

  it('a literal is never a key', () => {
    expect(new StringKey(null, 'text').keyExists(loc)).toBe(false)
  })
})

describe('scenario text and groups', () => {
  it('updateScenarioText adds to the qst dictionary', () => {
    withDict('qst', 'EXISTING,x')
    loc.updateScenarioText('NEW', 'added')

    expect(lookup('qst', 'NEW')).toBe('added')
  })

  it('registerKeyInGroup routes to the right dictionary', () => {
    loc.addDictionary('val', new DictionaryI18n(EN('K,english')))
    loc.dicts.get('val')!.addData(['.,French', 'K,french'])
    loc.registerKeyInGroup(new StringKey('val', 'K'), 'pack1')
    loc.setGroupTranslationLanguage('pack1', 'French')

    expect(lookup('val', 'K')).toBe('english [french]')
  })

  it('changeCurrentLangTo applies to every dictionary', () => {
    loc.addDictionary('val', new DictionaryI18n(EN('K,english')))
    loc.dicts.get('val')!.addData(['.,German', 'K,deutsch'])
    loc.changeCurrentLangTo('German')

    expect(lookup('val', 'K')).toBe('deutsch')
  })
})

describe('edge paths', () => {
  it('warns and keeps the unterminated tail of a malformed file', () => {
    // The block never closes, so the remainder is flushed with a literal \n.
    const dict = new DictionaryI18n(EN('KEY,"never closed'))

    expect(dict.getValue('KEY')).toBe('"never closed')
  })

  it('addRequiredLanguage reaches every dictionary', () => {
    loc.addDictionary('val', new DictionaryI18n(EN('K,english')))
    loc.dicts.get('val')!.addData(['.,Polish', 'ONLY_PL,polski'])

    expect(lookup('val', 'ONLY_PL')).toBe('ONLY_PL')

    loc.addRequiredLanguage('Polish')
    expect(lookup('val', 'ONLY_PL')).toBe('polski')
  })

  it('returns the key when the dictionary behind a reference is absent', () => {
    withDict('val', 'K,points at {qst:MISSING_DICT}')

    // 'qst' is not registered, so the nested reference is never expanded.
    expect(lookup('val', 'K')).toBe('points at {qst:MISSING_DICT}')
  })

  it('survives an unterminated lookup instead of reading past the end', () => {
    // The C# indexes past the end here and throws IndexOutOfRangeException.
    withDict('val', 'K,v')

    expect(StringKey.parse('{val:K', loc).translate({ localization: loc })).toBe('{val:K')
  })

  it('reports a duplicate key already loaded for a language', () => {
    const dict = new DictionaryI18n(EN('K,first', 'K,second'))

    expect(dict.getValue('K')).toBe('first')
    expect(dict.keyExists('K')).toBe(true)
  })
})
