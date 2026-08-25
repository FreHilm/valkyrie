/**
 * Migrated from `UtilityTests.cs`, `VersionManagerTests.cs` and
 * `SetVersionTests.cs` (T-010).
 *
 * `UtilityTests` covers three separate things: the `ToSet` LINQ helper,
 * `TextAlignmentUtils.ParseAlignment`, and the `QuestFormat` constants. The
 * `ToSet` cases are dismissed — the port uses `Set` directly, so there is no
 * helper to test — and the rest map onto the ported code.
 */

import { describe, expect, it } from 'vitest'
import {
  CURRENT_QUEST_FORMAT,
  QuestFormatVersions,
  SCENARIOS_THAT_REQUIRE_CONVERSION_KIT,
  requiresConversionKit,
} from '../src/content/FormatVersions.js'
import {
  parseTextAlignment,
  TextAlignment,
  textAlignmentName,
} from '../src/quest/QuestComponent.js'
import {
  isBeta,
  parseVersionFile,
  versionCodeGenerate,
  versionNewer,
  versionNewerOrEqual,
} from '../src/version/version.js'

describe('ParseAlignment (from UtilityTests.cs)', () => {
  it('ParseAlignment_Top_ReturnsTop', () => {
    expect(parseTextAlignment('TOP')).toBe(TextAlignment.TOP)
  })

  it('ParseAlignment_Center_ReturnsCenter', () => {
    expect(parseTextAlignment('CENTER')).toBe(TextAlignment.CENTER)
  })

  it('ParseAlignment_Bottom_ReturnsBottom', () => {
    expect(parseTextAlignment('BOTTOM')).toBe(TextAlignment.BOTTOM)
  })

  it('ParseAlignment_LowercaseTop_ReturnsTop', () => {
    expect(parseTextAlignment('top')).toBe(TextAlignment.TOP)
  })

  it('ParseAlignment_MixedCaseCenter_ReturnsCenter', () => {
    expect(parseTextAlignment('CeNtEr')).toBe(TextAlignment.CENTER)
  })

  it('ParseAlignment_InvalidValue_ReturnsCenter', () => {
    expect(parseTextAlignment('sideways')).toBe(TextAlignment.CENTER)
  })

  it('ParseAlignment_EmptyString_ReturnsCenter', () => {
    expect(parseTextAlignment('')).toBe(TextAlignment.CENTER)
  })

  it('TextAlignmentEnum_HasExpectedValues', () => {
    expect(Object.keys(TextAlignment)).toEqual(['TOP', 'CENTER', 'BOTTOM'])
  })

  // Beyond UtilityTests.cs: `Enum.Parse` accepts more than the member names,
  // and a scenario that uses those was being mis-parsed. Found by the quest
  // differential fuzz.
  it('takes the underlying number, so 0 is TOP', () => {
    expect(parseTextAlignment('0')).toBe(TextAlignment.TOP)
    expect(parseTextAlignment('1')).toBe(TextAlignment.CENTER)
    expect(parseTextAlignment('2')).toBe(TextAlignment.BOTTOM)
  })

  it('keeps a number outside the enum rather than rewriting the file', () => {
    expect(parseTextAlignment('-1')).toBe(-1)
    expect(textAlignmentName(parseTextAlignment('-1'))).toBe('-1')
    expect(parseTextAlignment('7')).toBe(7)
  })

  it('ORs a comma-separated list, as Enum.Parse does', () => {
    expect(parseTextAlignment('TOP,BOTTOM')).toBe(TextAlignment.BOTTOM)
    expect(parseTextAlignment('CENTER, BOTTOM')).toBe(3)
  })

  it('rejects a list with an empty or unknown element', () => {
    expect(parseTextAlignment('TOP,')).toBe(TextAlignment.CENTER)
    expect(parseTextAlignment('TOP,sideways')).toBe(TextAlignment.CENTER)
    expect(parseTextAlignment('0,1')).toBe(TextAlignment.CENTER)
  })

  it('names a defined value and numbers everything else', () => {
    expect(textAlignmentName(TextAlignment.TOP)).toBe('TOP')
    expect(textAlignmentName(TextAlignment.BOTTOM)).toBe('BOTTOM')
    expect(textAlignmentName(9)).toBe('9')
  })
})

describe('QuestFormat (from UtilityTests.cs)', () => {
  it('QuestFormat_VersionOrdering_IsCorrect', () => {
    const values = Object.values(QuestFormatVersions)
    expect([...values].sort((a, b) => a - b)).toEqual(values)
  })

  it('QuestFormat_RichTextVersion_Is16', () => {
    expect(QuestFormatVersions.RICH_TEXT).toBe(16)
  })

  it('QuestFormat_SplitBaseMomVersion_Is17', () => {
    expect(QuestFormatVersions.SPLIT_BASE_MOM_AND_CONVERSION_KIT).toBe(17)
  })

  it('QuestFormat_Release254Version_Is18', () => {
    expect(QuestFormatVersions.RELEASE_2_5_4).toBe(18)
  })

  it('QuestFormat_Release300Version_Is19', () => {
    expect(QuestFormatVersions.RELEASE_3_0_0).toBe(19)
  })

  it('QuestFormat_Release315Version_Is20', () => {
    expect(QuestFormatVersions.RELEASE_3_1_5).toBe(20)
  })

  it('QuestFormat_CurrentVersion_Is21', () => {
    expect(CURRENT_QUEST_FORMAT).toBe(21)
  })

  it('QuestFormat_ScenariosRequiringConversionKit_ContainsExpectedScenarios', () => {
    expect(requiresConversionKit('HolyMansion')).toBe(true)
    expect(requiresConversionKit('Escape')).toBe(true)
    expect(requiresConversionKit('wiltshire')).toBe(true)
  })

  it('QuestFormat_ScenariosRequiringConversionKit_AllLowercase', () => {
    for (const name of SCENARIOS_THAT_REQUIRE_CONVERSION_KIT) {
      expect(name).toBe(name.toLowerCase())
    }
  })

  it('QuestFormat_ScenariosRequiringConversionKit_IsHashSet', () => {
    expect(SCENARIOS_THAT_REQUIRE_CONVERSION_KIT).toBeInstanceOf(Set)
  })

  it('QuestFormat_ScenariosRequiringConversionKit_NoDuplicates', () => {
    expect(SCENARIOS_THAT_REQUIRE_CONVERSION_KIT.size).toBe(20)
  })
})

describe('isBeta (from VersionManagerTests.cs)', () => {
  it('IsBeta_NormalVersion_ReturnsFalse', () => {
    expect(isBeta('3.20')).toBe(false)
  })

  it('IsBeta_BetaVersion_ReturnsTrue', () => {
    // Three components means the beta channel.
    expect(isBeta('3.20.1')).toBe(true)
  })

  it('IsBeta_StringWithBeta_ReturnsTrue', () => {
    expect(isBeta('3.20 BETA')).toBe(true)
  })

  it('IsBeta_StringWithMajor_ReturnsFalse', () => {
    expect(isBeta('3.20 MAJOR')).toBe(false)
  })

  it('IsBeta_EmptyVersion_ReturnsFalse', () => {
    expect(isBeta('')).toBe(false)
  })

  it('IsBeta_NullVersion_ThrowsException (DEVIATION)', () => {
    // The C# throws NullReferenceException. TypeScript's types rule the case
    // out, so there is nothing to reproduce — passing null is a type error.
    expect(isBeta('')).toBe(false)
  })
})

describe('versionNewer (from VersionManagerTests.cs)', () => {
  it('VersionNewer_BasicComparison_ReturnsCorrectResult', () => {
    expect(versionNewer('3.19', '3.20')).toBe(true)
    expect(versionNewer('3.21', '3.20')).toBe(false)
    expect(versionNewer('3.20', '3.20')).toBe(false)
  })

  it('VersionNewer_BetaToStableUpdate_ReturnsTrue', () => {
    expect(versionNewer('3.20 BETA', '3.20')).toBe(true)
    expect(versionNewer('3.20.0', '3.20')).toBe(true)
    expect(versionNewer('3.20-beta', '3.20')).toBe(true)
  })

  it('VersionNewer_StableToMajorUpdate_ReturnsTrue', () => {
    expect(versionNewer('3.20', '3.20 MAJOR')).toBe(true)
    expect(versionNewer('3.20.0', '3.20 MAJOR')).toBe(true)
  })

  it('VersionNewer_NumericPrecedenceOverSuffix_ReturnsCorrectResult', () => {
    // The numeric comparison wins before the channel is consulted.
    expect(versionNewer('3.15 MAJOR', '3.20 BETA')).toBe(true)
    expect(versionNewer('3.20 BETA', '3.21')).toBe(true)
    expect(versionNewer('3.20 MAJOR', '3.21')).toBe(true)
    expect(versionNewer('3.21', '3.20 MAJOR')).toBe(false)
  })

  it('VersionNewer_StableToNewerBeta_ReturnsTrue', () => {
    expect(versionNewer('3.20', '3.21 BETA')).toBe(true)
    expect(versionNewer('3.20', '3.20.1')).toBe(true)
  })

  it('VersionNewer_EqualVersions_ReturnsFalse', () => {
    expect(versionNewer('3.20', '3.20')).toBe(false)
    expect(versionNewer('3.20 BETA', '3.20 BETA')).toBe(false)
  })

  it('VersionNewer_ComplexSuffixes_HandledCorrectly', () => {
    // Non-digits are stripped per component, so these compare equal
    // numerically and then equal on channel.
    expect(versionNewer('3.20a', '3.20')).toBe(false)
    expect(versionNewer('3.20', '3.20a')).toBe(false)
  })

  it('treats an empty version as older than anything', () => {
    expect(versionNewer('', '1.0')).toBe(true)
    expect(versionNewer('1.0', '')).toBe(false)
  })
})

describe('versionNewerOrEqual (from VersionManagerTests.cs)', () => {
  it('VersionNewerOrEqual_BasicComparison_ReturnsCorrectResult', () => {
    expect(versionNewerOrEqual('3.19', '3.20')).toBe(true)
    expect(versionNewerOrEqual('3.20', '3.20')).toBe(true)
    expect(versionNewerOrEqual('3.21', '3.20')).toBe(false)
  })

  it('VersionNewerOrEqual_BetaToStable_ReturnsTrue', () => {
    expect(versionNewerOrEqual('3.20 BETA', '3.20')).toBe(true)
  })

  it('considers versions with the same digits equal, ignoring dots', () => {
    // The equality check strips every non-digit from the whole string.
    expect(versionNewerOrEqual('3.12', '3.1.2')).toBe(true)
  })
})

describe('versionCodeGenerate (from SetVersionTests.cs)', () => {
  it.each([
    ['3.12.1', '30120010'],
    ['3.12.0', '30120000'],
    ['1.0.0', '10000000'],
    ['2.5', '20050000'],
    ['3.12a', '0'],
    ['2.5b', '0'],
  ])('VersionCodeGenerate(%j) is %j', (input, expected) => {
    expect(versionCodeGenerate(input)).toBe(expected)
  })

  it('returns 0 for an empty version', () => {
    expect(versionCodeGenerate('')).toBe('0')
  })

  it('accepts a single digit', () => {
    expect(versionCodeGenerate('7')).toBe('7')
  })

  it('returns 0 for a single non-digit', () => {
    expect(versionCodeGenerate('x')).toBe('0')
  })

  it('overflows to a negative code past the int32 range (PRESERVED BUG)', () => {
    // The C# accumulates into an `int`: 300 * 10000000 wraps negative, and a
    // negative value then passes the "exceeds android limit" check and is
    // returned. Found by the differential fuzz, not by reading the code.
    expect(versionCodeGenerate('300.0.0')).toBe('-1294967296')
  })

  it('rejects a value that exceeds the limit without overflowing', () => {
    expect(versionCodeGenerate('211.0.0')).toBe('0')
  })

  it('does not throw on a version ending in a dot (DEVIATION)', () => {
    // The C# calls "".Substring(0, -1) here and throws
    // ArgumentOutOfRangeException.
    expect(() => versionCodeGenerate('20.12.')).not.toThrow()
    expect(versionCodeGenerate('20.12.')).toBe('0')
  })
})

describe('parseVersionFile', () => {
  it('reads the shipped version.txt shape', () => {
    expect(parseVersionFile('3.28\nMAJOR')).toEqual({
      base: '3.28',
      channel: 'MAJOR',
      bundle: '3.28-major',
    })
  })

  it('reads a beta channel', () => {
    expect(parseVersionFile('3.29\nBETA')?.bundle).toBe('3.29-beta')
  })

  it('leaves the version bare when no channel is declared', () => {
    expect(parseVersionFile('3.28')).toEqual({ base: '3.28', channel: null, bundle: '3.28' })
  })

  it('upper-cases the channel, as SetVersion does', () => {
    expect(parseVersionFile('3.28\nbeta')?.channel).toBe('BETA')
  })

  it('ignores an unrecognised channel rather than appending it', () => {
    expect(parseVersionFile('3.28\nnightly')).toEqual({
      base: '3.28',
      channel: null,
      bundle: '3.28',
    })
  })

  it.each(['', '   ', '\n\nMAJOR'])('returns null for an invalid file %j', (content) => {
    expect(parseVersionFile(content)).toBeNull()
  })

  it('tolerates CRLF and trailing whitespace', () => {
    expect(parseVersionFile('3.28  \r\n  MAJOR  \r\n')?.bundle).toBe('3.28-major')
  })
})
