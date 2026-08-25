/**
 * `QuestLogTests.cs` and the `LogEntry` half of `SaveLoadTests.cs`, migrated
 * by name.
 *
 * The C# cases assert `\r\n` literally, so they only pass on Windows; these
 * assert "\n", which is what the port writes everywhere. See the deviations
 * doc.
 */

import { describe, expect, it } from 'vitest'

import { LogEntry, QuestLog } from '../src/quest/QuestLog.js'

describe('QuestLogTests.cs', () => {
  it('Constructor_Default_CreatesEmptyLog', () => {
    expect(new QuestLog().length).toBe(0)
    expect([...new QuestLog()]).toEqual([])
  })

  it('Add_SingleEntry_IncreasesCount', () => {
    const log = new QuestLog()
    log.add(new LogEntry('one'))

    expect(log.length).toBe(1)
  })

  it('Add_MultipleEntries_IncreasesCountCorrectly', () => {
    const log = new QuestLog()
    for (const text of ['a', 'b', 'c']) log.add(new LogEntry(text))

    expect(log.length).toBe(3)
  })

  it('Add_MultipleEntries_MaintainsOrder', () => {
    const log = new QuestLog()
    for (const text of ['first', 'second', 'third']) log.add(new LogEntry(text))

    expect([...log].map((e) => e.entry)).toEqual(['first', 'second', 'third'])
  })

  it('GetEnumerator_EmptyLog_ReturnsEmptyEnumerator', () => {
    expect([...new QuestLog()]).toHaveLength(0)
  })

  it('GetEnumerator_WithEntries_EnumeratesAllEntries', () => {
    const log = new QuestLog()
    log.add(new LogEntry('a'))
    log.add(new LogEntry('b'))

    expect([...log]).toHaveLength(2)
  })

  it('IEnumerableGetEnumerator_WithEntries_EnumeratesAllEntries', () => {
    const log = new QuestLog()
    log.add(new LogEntry('a'))

    expect(Array.from(log)).toHaveLength(1)
  })

  it('ToList_WithMultipleEntries_ReturnsAllEntries', () => {
    const log = new QuestLog()
    log.add(new LogEntry('a'))
    log.add(new LogEntry('b'))

    expect(log.toArray().map((e) => e.entry)).toEqual(['a', 'b'])
  })

  it('LogEntry_SimpleConstructor_CreatesQuestEntry', () => {
    expect(new LogEntry('message').kind).toBe('quest')
  })

  it('LogEntry_WithEditorFlag_CreatesEditorEntry', () => {
    expect(new LogEntry('message', true).kind).toBe('editor')
  })

  it('LogEntry_WithValkyrieFlag_CreatesValkyrieEntry', () => {
    expect(new LogEntry('message', false, true).kind).toBe('valkyrie')
  })

  it('LogEntry_TypeStringConstructor_QuestType_CreatesQuestEntry', () => {
    expect(LogEntry.fromType('quest0', 'message').kind).toBe('quest')
  })

  it('LogEntry_TypeStringConstructor_EditorType_CreatesEditorEntry', () => {
    expect(LogEntry.fromType('editor0', 'message').kind).toBe('editor')
  })

  it('LogEntry_TypeStringConstructor_ValkyrieType_CreatesValkyrieEntry', () => {
    expect(LogEntry.fromType('valkyrie0', 'message').kind).toBe('valkyrie')
  })

  it('LogEntry_ToString_QuestEntry_FormatsCorrectly', () => {
    expect(new LogEntry('Test message').toString(5)).toBe('quest5=Test message\n')
  })

  it('LogEntry_ToString_EditorEntry_FormatsCorrectly', () => {
    expect(new LogEntry('Editor message', true).toString(3)).toBe('editor3=Editor message\n')
  })

  it('LogEntry_ToString_ValkyrieEntry_FormatsCorrectly', () => {
    expect(new LogEntry('Valkyrie message', false, true).toString(7)).toBe(
      'valkyrie7=Valkyrie message\n',
    )
  })

  it('LogEntry_ToString_WithNewlines_EscapesNewlines', () => {
    expect(new LogEntry('Line1\nLine2\nLine3').toString(0)).toContain('Line1\\nLine2\\nLine3')
  })

  it('LogEntry_GetEntry_WithNewlines_UnescapesNewlines', () => {
    expect(LogEntry.fromType('quest0', 'Line1\\nLine2').getEntry()).toBe('Line1\nLine2\n\n')
  })

  it('LogEntry_GetEntry_EditorFalse_HidesEditorEntries', () => {
    expect(new LogEntry('Notice: Debug info', true).getEntry(false)).toBe('')
  })

  it('LogEntry_GetEntry_EditorTrue_ShowsEditorEntries', () => {
    expect(new LogEntry('Notice: Debug info', true).getEntry(true)).toBe('Notice: Debug info\n\n')
  })

  it('LogEntry_GetEntry_QuestEntry_AlwaysVisible', () => {
    const entry = new LogEntry('Important quest message')

    expect(entry.getEntry(false)).toBe('Important quest message\n\n')
    expect(entry.getEntry(true)).toBe('Important quest message\n\n')
  })

  it('QuestLog_AddAndEnumerate_WorksCorrectly', () => {
    const log = new QuestLog()
    log.add(new LogEntry('a'))
    log.add(new LogEntry('b', true))
    log.add(new LogEntry('c', false, true))

    expect([...log].map((e) => e.kind)).toEqual(['quest', 'editor', 'valkyrie'])
  })

  it('QuestLog_MixedEntryTypes_FiltersCorrectly', () => {
    const log = new QuestLog()
    log.add(new LogEntry('quest text'))
    log.add(new LogEntry('editor note', true))
    log.add(new LogEntry('diagnostic', false, true))

    const visible = [...log].map((e) => e.getEntry(false)).filter((text) => text.length > 0)

    expect(visible).toEqual(['quest text\n\n'])
  })

  it('QuestLog_SerializationRoundTrip_MaintainsData', () => {
    const log = new QuestLog()
    log.add(new LogEntry('first'))
    log.add(new LogEntry('second', true))
    log.add(new LogEntry('third', false, true))

    const section = new Map(
      log
        .toString()
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => {
          const at = line.indexOf('=')
          return [line.slice(0, at), line.slice(at + 1)] as [string, string]
        }),
    )
    const restored = QuestLog.fromSection(section)

    expect(restored.toArray().map((e) => [e.kind, e.entry])).toEqual([
      ['quest', 'first'],
      ['editor', 'second'],
      ['valkyrie', 'third'],
    ])
  })
})

describe('SaveLoadTests.cs (LogEntry cases)', () => {
  it('LogEntry_Constructor_SingleParam_SetsEntry', () => {
    expect(new LogEntry('text').entry).toBe('text')
  })

  it('LogEntry_Constructor_WithEditorFlag_SetsEditorPrefix', () => {
    expect(new LogEntry('text', true).toString(0)).toBe('editor0=text\n')
  })

  it('LogEntry_Constructor_WithValkyrieFlag_SetsValkyriePrefix', () => {
    expect(new LogEntry('text', false, true).toString(0)).toBe('valkyrie0=text\n')
  })

  it('LogEntry_Constructor_TypeString_ValkyrieType_SetsValkyriePrefix', () => {
    expect(LogEntry.fromType('valkyrie2', 'text').toString(2)).toBe('valkyrie2=text\n')
  })

  it('LogEntry_Constructor_TypeString_EditorType_SetsEditorPrefix', () => {
    expect(LogEntry.fromType('editor2', 'text').toString(2)).toBe('editor2=text\n')
  })

  it('LogEntry_Constructor_TypeString_QuestType_SetsQuestPrefix', () => {
    expect(LogEntry.fromType('quest2', 'text').toString(2)).toBe('quest2=text\n')
  })

  it('LogEntry_ToString_FormatsIdCorrectly', () => {
    expect(new LogEntry('x').toString(42)).toBe('quest42=x\n')
  })

  it('LogEntry_ToString_EscapesNewlines', () => {
    expect(new LogEntry('a\nb').toString(0)).toBe('quest0=a\\nb\n')
  })

  it('LogEntry_ToString_EndsWithNewline', () => {
    expect(new LogEntry('x').toString(0).endsWith('\n')).toBe(true)
  })
})

describe('LogEntry beyond the C# suite', () => {
  // IndexOf(...) == 0 is a prefix test, not equality.
  it('treats the type as a prefix, so "editorial" is an editor entry', () => {
    expect(LogEntry.fromType('editorial', 'x').kind).toBe('editor')
  })

  it('gives an unrecognised type the quest kind', () => {
    expect(LogEntry.fromType('banana', 'x').kind).toBe('quest')
  })

  // The C# hides these unless Application.isEditor, which is true under the
  // Unity test runner and false in a shipped build.
  it('hides a valkyrie entry outside a development build', () => {
    const entry = new LogEntry('diagnostic', false, true)

    expect(entry.getEntry(true, false)).toBe('')
    expect(entry.getEntry(false, true)).toBe('diagnostic\n\n')
  })

  it('numbers entries by position when serialising a log', () => {
    const log = new QuestLog()
    log.add(new LogEntry('a'))
    log.add(new LogEntry('b', true))

    expect(log.toString()).toBe('quest0=a\neditor1=b\n')
  })
})
