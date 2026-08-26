/**
 * @vitest-environment happy-dom
 *
 * Tests for drawing quest text.
 *
 * Two things are worth pinning. Quest text is written by other people and some
 * of it is downloaded, so markup in it must never become markup on the page.
 * And a symbol has to end up as something a reader can actually read, because
 * the glyph the game would draw is invisible without a font the port does not
 * ship.
 */

import { describe, expect, it } from 'vitest'

import { characterMap, symbolNames } from '@valkyrie/core'
import { renderRichText, setRichText } from '../src/richText.js'

// Derived rather than pasted: the glyph is a private-use codepoint, and an
// invisible literal in source is both unreadable and easy to lose.
const ACTION = characterMap('MoM')?.get('{action}') ?? ''
const names = symbolNames('MoM')
const symbolOf = (character: string): string | null => names.get(character) ?? null

function html(input: string, options = {}): string {
  const node = document.createElement('div')
  node.append(renderRichText(input, options))
  return node.innerHTML
}

describe('renderRichText', () => {
  it('leaves plain text as a single text node', () => {
    const node = document.createElement('div')
    node.append(renderRichText('The door is locked.'))

    expect(node.childNodes).toHaveLength(1)
    expect(node.childNodes[0]?.nodeType).toBe(Node.TEXT_NODE)
  })

  it('turns the tags the game honours into elements', () => {
    expect(html('a <i>b</i> <b>c</b>')).toBe('a <em>b</em> <strong>c</strong>')
  })

  it('nests them the way they were nested', () => {
    expect(html('<b>a<i>b</i></b>')).toBe('<strong>a</strong><strong><em>b</em></strong>')
  })

  it('never lets quest text introduce markup of its own', () => {
    // A scenario's localisation is authored elsewhere and may be downloaded.
    const escaped = html('<script>alert(1)</script> & <img src=x onerror=y>')

    expect(escaped).not.toContain('<script')
    expect(escaped).not.toContain('<img')
    expect(escaped).toContain('&lt;script&gt;')
  })

  it('renders a symbol as its name, which is legible without the font', () => {
    const node = document.createElement('div')
    node.append(renderRichText(`spend 1 ${ACTION}`, { symbolOf }))
    const symbol = node.querySelector('.vk-symbol')

    expect(symbol?.textContent).toBe('Action')
    expect(node.textContent).toBe('spend 1 Action')
  })

  it('gives a symbol a label a screen reader reads as one thing', () => {
    const node = document.createElement('div')
    node.append(renderRichText(ACTION, { symbolOf }))
    const symbol = node.querySelector('.vk-symbol')

    expect(symbol?.getAttribute('role')).toBe('img')
    expect(symbol?.getAttribute('aria-label')).toBe('Action')
  })

  it('classes a symbol by name, so a font or an icon can target it', () => {
    const node = document.createElement('div')
    node.append(renderRichText(ACTION, { symbolOf }))

    expect(node.querySelector('.vk-symbol--action')).not.toBeNull()
  })

  it('takes a caller’s own spelling for a symbol', () => {
    const node = document.createElement('div')
    node.append(renderRichText(ACTION, { symbolOf, labelOf: () => 'Handling' }))

    expect(node.textContent).toBe('Handling')
  })

  it('keeps the style a symbol sits inside', () => {
    const node = document.createElement('div')
    node.append(renderRichText(`<i>${ACTION}</i>`, { symbolOf }))

    expect(node.querySelector('em .vk-symbol')).not.toBeNull()
  })
})

describe('setRichText', () => {
  it('replaces what was there rather than appending', () => {
    const node = document.createElement('p')
    setRichText(node, 'first')
    setRichText(node, '<i>second</i>')

    expect(node.innerHTML).toBe('<em>second</em>')
  })
})
