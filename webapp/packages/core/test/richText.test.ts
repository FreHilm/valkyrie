/**
 * Tests for splitting quest text into styled runs.
 *
 * The corpus is what the awkward cases are drawn from: 503 `<i>` of which two
 * are never closed, a stray `<click>` that is not a tag Unity knows, and 424
 * symbols that have already become private-use codepoints by the time anything
 * tries to draw them.
 */

import { describe, expect, it } from 'vitest'

import { needsRichText, parseRichText } from '../src/quest/richText.js'
import { characterMap, symbolNames } from '../src/quest/symbols.js'

// Derived rather than pasted: these are private-use codepoints, and an
// invisible literal in source is both unreadable and easy to lose.
const symbols = characterMap('MoM')
const WILL = symbols?.get('{will}') ?? ''
const ACTION = symbols?.get('{action}') ?? ''
const names = symbolNames('MoM')
const symbolOf = (character: string): string | null => names.get(character) ?? null

const plain = (spans: ReturnType<typeof parseRichText>): string =>
  spans.map((s) => (s.kind === 'text' ? s.text : `[${s.symbol}]`)).join('')

describe('parseRichText', () => {
  it('leaves text with no markup as one run', () => {
    expect(parseRichText('The door is locked.')).toEqual([
      { kind: 'text', text: 'The door is locked.', bold: false, italic: false },
    ])
  })

  it('marks the run inside a tag', () => {
    expect(parseRichText('a <i>b</i> c')).toEqual([
      { kind: 'text', text: 'a ', bold: false, italic: false },
      { kind: 'text', text: 'b', bold: false, italic: true },
      { kind: 'text', text: ' c', bold: false, italic: false },
    ])
  })

  it('nests bold and italic', () => {
    const spans = parseRichText('<b>a<i>b</i></b>')

    expect(spans).toEqual([
      { kind: 'text', text: 'a', bold: true, italic: false },
      { kind: 'text', text: 'b', bold: true, italic: true },
    ])
  })

  it('closes a tag the content never closed', () => {
    // Two of the corpus's 503 `<i>` have no closing tag.
    expect(parseRichText('<i>to the end')).toEqual([
      { kind: 'text', text: 'to the end', bold: false, italic: true },
    ])
  })

  it('unwinds tags closed out of order', () => {
    expect(plain(parseRichText('<b><i>x</b>y</i>'))).toBe('xy')
    expect(parseRichText('<b><i>x</b>y</i>')[1]).toEqual({
      kind: 'text',
      text: 'y',
      bold: false,
      italic: true,
    })
  })

  it('renders a tag it does not know, as Unity does', () => {
    // The corpus has a stray `<click>`; the game shows it exactly as written.
    expect(plain(parseRichText('press <click> here'))).toBe('press <click> here')
  })

  it('treats an unterminated angle bracket as text', () => {
    expect(plain(parseRichText('5 < 6 and 7 > 6'))).toBe('5 < 6 and 7 > 6')
  })

  it('splits a symbol out of the run around it', () => {
    const spans = parseRichText(`spend 1 ${ACTION} now`, symbolOf)

    expect(spans).toEqual([
      { kind: 'text', text: 'spend 1 ', bold: false, italic: false },
      { kind: 'symbol', symbol: 'action', bold: false, italic: false },
      { kind: 'text', text: ' now', bold: false, italic: false },
    ])
  })

  it('carries the style in force onto a symbol', () => {
    expect(parseRichText(`<i>${WILL}</i>`, symbolOf)).toEqual([
      { kind: 'symbol', symbol: 'will', bold: false, italic: true },
    ])
  })

  it('leaves a symbol alone when the caller has no table', () => {
    expect(parseRichText(`a ${WILL} b`)).toEqual([
      { kind: 'text', text: `a ${WILL} b`, bold: false, italic: false },
    ])
  })

  it('yields nothing for an empty line', () => {
    expect(parseRichText('')).toEqual([])
    expect(parseRichText('<i></i>')).toEqual([])
  })
})

describe('symbolNames', () => {
  it('names the glyph a marker produced', () => {
    expect(symbolNames('MoM').get(ACTION)).toBe('action')
    expect(symbolNames('D2E').get('π')).toBe('will')
  })

  it('is empty for a game it does not know', () => {
    expect(symbolNames('Nothing').size).toBe(0)
  })
})

describe('needsRichText', () => {
  it('is false for text a plain renderer would get right', () => {
    expect(needsRichText('The door is locked.')).toBe(false)
    expect(needsRichText('press <click> here')).toBe(false)
  })

  it('is true once there is markup or a symbol', () => {
    expect(needsRichText('a <b>b</b>')).toBe(true)
    expect(needsRichText(`1 ${ACTION}`, symbolOf)).toBe(true)
  })
})
