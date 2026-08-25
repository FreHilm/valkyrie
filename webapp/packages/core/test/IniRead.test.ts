/**
 * Conformance tests for the IniRead port.
 *
 * The first block is a 1:1 migration of
 * `unity/Assets/UnitTests/Editor/IniReadTests.cs` — same cases, same names, so
 * the two suites can be diffed. Later blocks pin behaviour that the C# suite
 * left uncovered but that real content depends on.
 */

import { describe, expect, it } from 'vitest'
import { IniData } from '../src/ini/IniData.js'
import {
  readFromString,
  readFromStringArray,
  readSectionFromStringArray,
} from '../src/ini/IniRead.js'
import { detectNewline, leadingComments, rewriteIni, writeIni } from '../src/ini/IniWriter.js'

describe('IniReadTests (migrated from IniReadTests.cs)', () => {
  it('ReadFromString_SimpleSingleSection_ParsesCorrectly', () => {
    const result = readFromString('[Section1]\nkey1=value1\nkey2=value2')

    expect(result.get('Section1', 'key1')).toBe('value1')
    expect(result.get('Section1', 'key2')).toBe('value2')
  })

  it('ReadFromString_MultipleSections_ParsesAllSections', () => {
    const result = readFromString('[Section1]\nkey1=value1\n\n[Section2]\nkey2=value2')

    expect(result.get('Section1', 'key1')).toBe('value1')
    expect(result.get('Section2', 'key2')).toBe('value2')
  })

  it('ReadFromString_CommentsIgnored_OnlyParsesData', () => {
    const result = readFromString(
      '# This is a comment\n[Section1]\n; This is also a comment\nkey1=value1',
    )

    expect(result.get('Section1', 'key1')).toBe('value1')
    expect(result.getSection('Section1')!.size).toBe(1)
  })

  it('ReadFromString_KeyWithoutValue_ParsesAsEmptyValue', () => {
    const result = readFromString('[Section1]\nkeyonly')

    expect(result.get('Section1', 'keyonly')).toBe('')
    expect(result.getSection('Section1')!.has('keyonly')).toBe(true)
  })

  it('ReadFromString_QuotedValue_TrimsQuotes', () => {
    const result = readFromString('[Section1]\nkey="quoted value"')

    expect(result.get('Section1', 'key')).toBe('quoted value')
  })

  it('ReadFromString_EmptyInput_ReturnsEmptyData', () => {
    const result = readFromString('')

    expect(result).toBeInstanceOf(IniData)
    expect(result.data.size).toBe(0)
  })

  it('ReadFromString_WhitespaceAroundValues_TrimsProperly', () => {
    const result = readFromString('[Section1]\n  key1  =  value1  ')

    expect(result.get('Section1', 'key1')).toBe('value1')
  })

  it('IniData_Add_AddsNewSection', () => {
    const data = new IniData()
    data.add('NewSection', 'key', 'value')

    expect(data.get('NewSection', 'key')).toBe('value')
  })

  it('IniData_Remove_RemovesEntry', () => {
    const data = new IniData()
    data.add('Section', 'key', 'value')
    data.remove('Section', 'key')

    expect(data.get('Section', 'key')).toBe('')
  })

  it('IniData_RemoveSection_RemovesEntireSection', () => {
    const data = new IniData()
    data.add('Section', 'key1', 'value1')
    data.add('Section', 'key2', 'value2')
    data.removeSection('Section')

    expect(data.getSection('Section')).toBeNull()
  })

  it('IniData_GetNonExistentSection_ReturnsNull', () => {
    expect(new IniData().getSection('NonExistent')).toBeNull()
  })

  it('IniData_GetNonExistentKey_ReturnsEmptyString', () => {
    const data = new IniData()
    data.add('Section', 'key', 'value')

    expect(data.get('Section', 'nonexistent')).toBe('')
  })

  it('IniData_ToString_OutputsValidIniFormat', () => {
    const data = new IniData()
    data.add('Section', 'key', 'value')

    const result = data.toString()

    expect(result).toContain('[Section]')
    expect(result).toContain('key=value')
  })

  it('IniData_AddDuplicateKey_ReplacesValue', () => {
    const data = new IniData()
    data.add('Section', 'key', 'value1')
    data.add('Section', 'key', 'value2')

    expect(data.get('Section', 'key')).toBe('value2')
  })

  it('ReadFromString_DuplicateSections_IgnoresSecondOccurrence', () => {
    const result = readFromString('[Section1]\nkey1=value1\n\n[Section1]\nkey2=value2')

    expect(result.get('Section1', 'key1')).toBe('value1')
    expect(result.get('Section1', 'key2')).toBe('')
  })
})

describe('parser behaviour the C# suite left uncovered', () => {
  it('keeps the first of two duplicate keys in a section', () => {
    const result = readFromString('[S]\nkey=first\nkey=second')

    expect(result.get('S', 'key')).toBe('first')
  })

  it('splits on the first = only, so values may contain =', () => {
    const result = readFromString('[S]\nkey=a=b=c')

    expect(result.get('S', 'key')).toBe('a=b=c')
  })

  it('strips every leading and trailing bracket from a section header', () => {
    const result = readFromString('[[Nested]]\nkey=value')

    expect(result.get('Nested', 'key')).toBe('value')
  })

  it('accepts an unterminated section header', () => {
    const result = readFromString('[Unterminated\nkey=value')

    expect(result.get('Unterminated', 'key')).toBe('value')
  })

  it('drops data that appears before the first section header', () => {
    const result = readFromString('orphan=value\n[S]\nkey=value')

    expect(result.get('S', 'key')).toBe('value')
    expect(result.data.size).toBe(1)
  })

  it('drops a section whose name is empty', () => {
    const result = readFromString('[]\nkey=value\n[S]\nreal=yes')

    expect(result.data.size).toBe(1)
    expect(result.get('S', 'real')).toBe('yes')
  })

  it('trims whitespace before quotes but preserves whitespace inside them', () => {
    const result = readFromString('[S]\nkey=  " padded "  ')

    expect(result.get('S', 'key')).toBe(' padded ')
  })

  it('strips repeated surrounding quotes', () => {
    const result = readFromString('[S]\nkey=""doubled""')

    expect(result.get('S', 'key')).toBe('doubled')
  })

  it('leaves an unbalanced quote stripped from both ends independently', () => {
    const result = readFromString('[S]\nkey="unbalanced')

    expect(result.get('S', 'key')).toBe('unbalanced')
  })

  it('treats a comment marker after other text as data, not a comment', () => {
    const result = readFromString('[S]\nkey=value # not a comment')

    expect(result.get('S', 'key')).toBe('value # not a comment')
  })

  it('honours indented comment markers', () => {
    const result = readFromString('[S]\n   # indented\n   ; also indented\nkey=value')

    expect(result.getSection('S')!.size).toBe(1)
    expect(result.get('S', 'key')).toBe('value')
  })

  it('handles CRLF, LF and CR line endings identically', () => {
    const expected = { S: { a: '1', b: '2' } }

    for (const newline of ['\r\n', '\n', '\r']) {
      const result = readFromString(`[S]${newline}a=1${newline}b=2`)
      expect({ S: Object.fromEntries(result.getSection('S')!) }).toEqual(expected)
    }
  })

  it('skips whitespace-only lines instead of throwing (DEVIATION 1)', () => {
    // The C# evaluates l.Trim()[0] guarded only by l.Length > 0, so this input
    // throws IndexOutOfRangeException there and aborts the whole load.
    const result = readFromString('[S]\n   \nkey=value')

    expect(result.get('S', 'key')).toBe('value')
  })

  it('stores keys that collide with Object.prototype members', () => {
    const result = readFromString('[__proto__]\n__proto__=polluted\nconstructor=also')

    expect(result.get('__proto__', '__proto__')).toBe('polluted')
    expect(result.get('__proto__', 'constructor')).toBe('also')
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
    expect(Object.prototype).not.toHaveProperty('polluted')
  })

  it('is case-sensitive for both section and key names', () => {
    const result = readFromString('[Section]\nKey=value')

    expect(result.get('section', 'Key')).toBe('')
    expect(result.get('Section', 'key')).toBe('')
    expect(result.get('Section', 'Key')).toBe('value')
  })
})

describe('IniData.toString round-trip', () => {
  it('re-parses to an equivalent structure', () => {
    const source = '[A]\nkey=value\nflag\n\n[B]\nother=thing'
    const parsed = readFromString(source)

    const reparsed = readFromString(parsed.toString())

    expect(reparsed.get('A', 'key')).toBe('value')
    expect(reparsed.get('A', 'flag')).toBe('')
    expect(reparsed.get('B', 'other')).toBe('thing')
  })

  it('omits the = for valueless entries', () => {
    const data = new IniData()
    data.add('S', 'flag', '')

    expect(data.toString()).toBe('[S]\nflag\n\n')
  })

  it('preserves section and key insertion order', () => {
    const data = new IniData()
    data.add('Second', 'b', '2')
    data.add('First', 'a', '1')
    data.add('Second', 'a', '1')

    expect(data.toString()).toBe('[Second]\nb=2\na=1\n\n[First]\na=1\n\n')
  })
})

describe('readSectionFromStringArray', () => {
  const lines = [
    '[Quest]',
    'name=Test Quest',
    'description="A quest"',
    'flag',
    '[Other]',
    'name=Should not appear',
  ]

  it('reads only the requested section', () => {
    const result = readSectionFromStringArray(lines, 'test.ini', 'Quest')

    expect(Object.fromEntries(result)).toEqual({
      name: 'Test Quest',
      description: 'A quest',
      flag: '',
    })
  })

  it('returns an empty map for a missing section', () => {
    expect(readSectionFromStringArray(lines, 'test.ini', 'Missing').size).toBe(0)
  })

  it('only ends the section on a bracket at column 0', () => {
    const indented = ['[Quest]', 'a=1', '  [NotASection]', 'b=2']
    const result = readSectionFromStringArray(indented, 'test.ini', 'Quest')

    expect(result.get('b')).toBe('2')
  })

  it('keeps the first of two duplicate valueless keys (DEVIATION 2)', () => {
    // The C# calls Dictionary.Add unguarded here and throws ArgumentException.
    const result = readSectionFromStringArray(['[S]', 'flag', 'flag'], 'test.ini', 'S')

    expect(result.get('flag')).toBe('')
    expect(result.size).toBe(1)
  })
})

describe('readFromStringArray', () => {
  it('does not filter empty lines the way readFromString does', () => {
    const result = readFromStringArray(['[S]', '', 'key=value'], 'test.ini')

    expect(result.get('S', 'key')).toBe('value')
  })
})

describe('IniWriter (T-019)', () => {
  it.each([
    ['crlf throughout', 'a\r\nb\r\n', '\r\n'],
    ['lf throughout', 'a\nb\n', '\n'],
    ['no line break at all', 'a', '\n'],
    ['mixed, crlf in the majority', 'a\r\nb\r\nc\n', '\r\n'],
    ['mixed, lf in the majority', 'a\nb\nc\r\n', '\n'],
  ])('detects %s', (_name, text, expected) => {
    expect(detectNewline(text)).toBe(expected)
  })

  it('writes sections and values', () => {
    const data = readFromString('[A]\nx=1\ny=2\n[B]\nz=3\n')

    expect(writeIni(data)).toBe('[A]\nx=1\ny=2\n\n[B]\nz=3\n')
  })

  it('writes with the requested line ending', () => {
    const data = readFromString('[A]\nx=1\n')

    expect(writeIni(data, { newline: '\r\n' })).toBe('[A]\r\nx=1\r\n')
  })

  it('is empty for empty data', () => {
    expect(writeIni(readFromString(''))).toBe('')
  })

  /**
   * Published quests are overwhelmingly CRLF — 101 of 103 files across twelve
   * scenarios — because the Unity editor writes them on Windows. Normalising
   * would turn a one-line edit into a whole-file diff in a git repository.
   */
  it('preserves the line ending a file already uses', () => {
    const original = '[A]\r\nx=1\r\n'

    expect(rewriteIni(original, readFromString(original))).toBe(original)
  })

  it('keeps the comment header the Unity editor writes', () => {
    const original = '; Saved by version: 1.1.0a\r\n[A]\r\nx=1\r\n'

    expect(rewriteIni(original, readFromString(original))).toContain('; Saved by version: 1.1.0a')
  })

  // Some quest files contain nothing but that marker.
  it('does not empty a file that is only a comment', () => {
    const original = '; Saved by version: 1.1.0a\r\n'

    expect(rewriteIni(original, readFromString(original))).toBe(original)
  })

  it('reads the leading comments and stops at the first section', () => {
    expect(leadingComments('; one\n# two\n[A]\n; not this one\n')).toEqual(['; one', '# two'])
  })

  it('takes an explicit header over the existing one', () => {
    const original = '; old\r\n[A]\r\nx=1\r\n'

    expect(rewriteIni(original, readFromString(original), '; new')).toContain('; new')
  })
})
