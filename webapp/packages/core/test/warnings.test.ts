/**
 * The parser's warnings are the only feedback a scenario author gets when a
 * content pack is subtly malformed, so the messages are pinned here rather
 * than treated as incidental logging.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { readFromString } from '../src/ini/IniRead.js'
import { setLogSink } from '../src/ini/logger.js'

function capture(content: string): string[] {
  const messages: string[] = []
  setLogSink((message) => messages.push(message))
  try {
    readFromString(content)
  } finally {
    setLogSink(null)
  }
  return messages
}

afterEach(() => setLogSink(null))

describe('parser warnings', () => {
  it('is silent for well-formed content', () => {
    expect(capture('[S]\na=1\n[T]\nb=2')).toEqual([])
  })

  it('warns about a duplicate section', () => {
    expect(capture('[S]\na=1\n[S]\nb=2')).toEqual([
      'Warning: duplicate section "S" in <INTERNAL> will be ignored.',
    ])
  })

  it('warns about a duplicate section at end of file', () => {
    // The final flush is a separate code path from the mid-file one.
    expect(capture('[S]\na=1\n[T]\nb=2\n[S]\nc=3')).toEqual([
      'Warning: duplicate section "S" in <INTERNAL> will be ignored.',
    ])
  })

  it('warns when the duplicate is flushed mid-file rather than at EOF', () => {
    // A third section forces the duplicate through the in-loop flush, which is
    // a different call site from the end-of-file one above.
    expect(capture('[S]\na=1\n[S]\nb=2\n[T]\nc=3')).toEqual([
      'Warning: duplicate section "S" in <INTERNAL> will be ignored.',
    ])
  })

  it('warns about a duplicate key', () => {
    expect(capture('[S]\na=1\na=2')).toEqual([
      'Warning: duplicate "a" data in section "S" in <INTERNAL> will be ignored.',
    ])
  })

  it('warns about a duplicate valueless key', () => {
    expect(capture('[S]\nflag\nflag')).toEqual([
      'Warning: duplicate "flag" data in section "S" in <INTERNAL> will be ignored.',
    ])
  })

  it('warns about an empty section name', () => {
    expect(capture('[]\na=1')).toContain('Warning: empty section in <INTERNAL> will be ignored.')
  })

  it('warns about data before the first section', () => {
    expect(capture('orphan=1\n[S]\na=2')).toEqual([
      'Warning: data orphan=1 without section in <INTERNAL> will be ignored.',
    ])
  })

  it('does not invoke a sink that has been cleared', () => {
    const messages: string[] = []
    setLogSink((message) => messages.push(message))
    setLogSink(null)

    readFromString('[S]\na=1\n[S]\nb=2')

    expect(messages).toEqual([])
  })
})
