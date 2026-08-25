/**
 * @vitest-environment happy-dom
 *
 * Tests for the scenario's screen-space UI layer.
 *
 * What matters here is what was actually broken: these elements were being
 * placed on the board grid as untextured squares, so the assertions are that
 * they are positioned against the viewport instead, that a text element gets
 * its colours, and that only a clickable one is clickable.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { questUiFontSize, questUiLayer } from '../src/questUiLayer.js'
import type { QuestUiElement } from '../src/questUiLayer.js'

function element(over: Partial<QuestUiElement> = {}): QuestUiElement {
  return {
    name: 'UIThing',
    image: null,
    aspect: 1,
    text: 'Read the journal',
    placement: { x: 0, y: 0, size: 0.5, hAlign: 0, vAlign: 0, verticalUnits: false },
    textSize: 1,
    textColour: 'white',
    backgroundColour: 'transparent',
    textAlignment: 'centre',
    border: false,
    clickable: true,
    ...over,
  }
}

/** The layer measures its own box, which jsdom reports as zero without help. */
function sized(layer: { element: HTMLElement }, width: number, height: number): void {
  Object.defineProperty(layer.element, 'clientWidth', { value: width, configurable: true })
  Object.defineProperty(layer.element, 'clientHeight', { value: height, configurable: true })
}

describe('questUiLayer', () => {
  let onSelect: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onSelect = vi.fn()
  })

  it('positions elements against the viewport, not a board grid', () => {
    const layer = questUiLayer({ onSelect })
    sized(layer, 1000, 800)
    layer.setElements([
      element({
        placement: { x: 0, y: 0, size: 0.5, hAlign: -1, vAlign: -1, verticalUnits: false },
      }),
    ])

    const node = layer.element.firstElementChild as HTMLElement
    expect(node.style.position).toBe('absolute')
    expect(node.style.left).toBe('0px')
    expect(node.style.width).toBe('500px')
  })

  it('shows an image element as an img, so the browser decodes it', () => {
    const layer = questUiLayer({ onSelect })
    sized(layer, 1000, 800)
    layer.setElements([element({ image: 'blob:journal', aspect: 2 })])

    const img = layer.element.querySelector('img')
    expect(img?.getAttribute('src')).toBe('blob:journal')
    expect(layer.element.querySelector('.vk-quest-ui__text')).toBeNull()
  })

  it('applies the C# colour names to a text element', () => {
    const layer = questUiLayer({ onSelect })
    sized(layer, 1000, 800)
    layer.setElements([element({ textColour: 'navy', backgroundColour: 'transparent' })])

    const node = layer.element.firstElementChild as HTMLElement
    const text = node.querySelector('.vk-quest-ui__text') as HTMLElement
    expect(text.style.color).toBe('#000080')
    expect(node.style.background).toBe('#00000000')
  })

  it('fires the component name when a clickable element is pressed', () => {
    const layer = questUiLayer({ onSelect })
    sized(layer, 1000, 800)
    layer.setElements([element({ name: 'UIContinue1' })])
    ;(layer.element.firstElementChild as HTMLElement).click()

    expect(onSelect).toHaveBeenCalledWith('UIContinue1')
  })

  it('leaves a non-clickable element inert', () => {
    const layer = questUiLayer({ onSelect })
    sized(layer, 1000, 800)
    layer.setElements([element({ clickable: false })])
    ;(layer.element.firstElementChild as HTMLElement).click()

    expect(onSelect).not.toHaveBeenCalled()
    expect(layer.element.firstElementChild?.getAttribute('role')).toBeNull()
  })

  it('warns about a colour the C# would have warned about', () => {
    const onWarning = vi.fn()
    const layer = questUiLayer({ onSelect, onWarning })
    sized(layer, 1000, 800)
    layer.setElements([element({ textColour: 'chartreuse' })])

    expect(onWarning).toHaveBeenCalledOnce()
    expect(String(onWarning.mock.calls[0]?.[0])).toContain('chartreuse')
  })

  it('replaces the previous elements rather than appending', () => {
    const layer = questUiLayer({ onSelect })
    sized(layer, 1000, 800)
    layer.setElements([element({ name: 'A' }), element({ name: 'B' })])
    layer.setElements([element({ name: 'C' })])

    expect(layer.element.children).toHaveLength(1)
  })
})

describe('questUiFontSize', () => {
  it('scales with the viewport height, as UIScaler does', () => {
    // UIScaler.GetPixelsPerUnit is the screen height over 30 rows.
    expect(questUiFontSize(1, 900)).toBe(30)
    expect(questUiFontSize(1.5, 900)).toBe(45)
  })

  it('honours the readability floor the ported scaler applies', () => {
    // MIN_UNIT_PX keeps a short viewport from putting text at a few pixels.
    expect(questUiFontSize(1, 120)).toBe(14)
  })
})
