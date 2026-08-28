/**
 * Drawing quest text: its markup as elements, its symbols as icons.
 *
 * The parse is in core; this is the half that touches the DOM. It builds nodes
 * rather than assigning `innerHTML`, which matters beyond tidiness — scenario
 * text is authored by other people and some of it is downloaded, so it must
 * never be able to introduce markup of its own. A `<script>` in a quest's
 * localisation ends up on screen as those nine characters.
 *
 * A symbol becomes a labelled element rather than the private-use character
 * the game font draws. The port does not ship that font (docs/ui-foundation.md
 * — the licences are unresolved), and an unshipped glyph is not a difference
 * in styling: it is invisible, which turns "spend 1 {action}" into "spend 1".
 * The name is always legible, and a font can replace it later without anything
 * here changing.
 */

import { parseRichText } from '@valkyrie/core'
import { el } from './dom.js'

export interface RichTextOptions {
  /** Names the symbol a character stands for; `symbolNames` supplies it. */
  symbolOf?: (character: string) => string | null
  /** How a symbol is spelled for the reader. Defaults to the marker name. */
  labelOf?: (symbol: string) => string
  /**
   * Whether the game font carrying the symbol glyphs is available.
   *
   * The markers become private-use codepoints — `{action}` is U+F208 — which
   * only `MADGaramondPro` draws. With it, the glyph is what a player expects
   * to see. Without it, the codepoint renders as a blank box, so the name is
   * shown in its place instead. The caller decides, because only the
   * application knows what it managed to load.
   */
  glyphs?: boolean
}

/** Title case, so `action` reads as `Action` beside the sentence it sits in. */
function defaultLabel(symbol: string): string {
  return symbol.charAt(0).toUpperCase() + symbol.slice(1)
}

/**
 * Renders one line into a fragment.
 *
 * Text with no markup and no symbols comes back as a single text node, so the
 * common case adds no elements to the page at all.
 */
export function renderRichText(input: string, options: RichTextOptions = {}): DocumentFragment {
  const fragment = document.createDocumentFragment()
  const label = options.labelOf ?? defaultLabel

  for (const span of parseRichText(input, options.symbolOf)) {
    let node: Node
    if (span.kind === 'symbol') {
      const name = label(span.symbol)
      // The glyph when the game font is there to draw it, and the name when
      // it is not — a private-use codepoint with no font behind it is a blank
      // box, which tells a player nothing. Either way the accessible label is
      // the name, so a reader hears "Action" whichever a player sees.
      const drawGlyph = options.glyphs === true
      node = el('span', {
        class: drawGlyph
          ? `vk-symbol vk-symbol--glyph vk-symbol--${span.symbol}`
          : `vk-symbol vk-symbol--${span.symbol}`,
        text: drawGlyph ? span.character : name,
        // Read as one thing rather than spelled out beside the sentence.
        attrs: { role: 'img', 'aria-label': name },
      })
    } else {
      node = document.createTextNode(span.text)
    }

    // Bold and italic nest, so the inner element goes inside the outer one.
    if (span.italic) {
      const em = el('em')
      em.append(node)
      node = em
    }
    if (span.bold) {
      const strong = el('strong')
      strong.append(node)
      node = strong
    }
    fragment.append(node)
  }

  return fragment
}

/** Replaces an element's contents with rendered text. */
export function setRichText(node: Element, input: string, options: RichTextOptions = {}): void {
  node.replaceChildren(renderRichText(input, options))
}
