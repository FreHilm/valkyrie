/**
 * Quest text as the player should see it: markup and symbols separated out.
 *
 * `UnityEngine.UI.Text` has `supportRichText` on by default, so the tags a
 * scenario writes into its own localisation are formatting, not literal
 * characters — 503 `<i>` and 283 `<b>` across the shipped Mansions content.
 * `outputSymbolReplace` has already turned `{action}` and friends into the
 * private-use codepoints the game font draws its icons at, and there are 424
 * of those in the same content.
 *
 * Rendering either as plain text puts markup and invisible glyphs on screen,
 * so this splits a line into runs a renderer can build elements from. It stops
 * at that: the parse is host-free and testable, and nothing here decides what
 * a symbol looks like or emits any markup of its own — which is also what
 * keeps scenario text, some of it downloaded, from reaching `innerHTML`.
 */

/** The formatting in force over a run. */
export interface RichStyle {
  bold: boolean
  italic: boolean
}

export type RichSpan =
  | ({ kind: 'text'; text: string } & RichStyle)
  /** A game symbol, named as the marker that produced it: `will`, `action`. */
  | ({ kind: 'symbol'; symbol: string } & RichStyle)

/**
 * The tags Unity's legacy `Text` honours and the shipped content uses.
 *
 * `<size>` and `<color>` are also part of the control set, and no scenario in
 * the corpus uses either; they are left to render literally rather than
 * half-supported, which is what an unknown tag does below.
 */
const TAGS: Record<string, keyof RichStyle> = { b: 'bold', i: 'italic' }

/**
 * Splits a line into styled runs.
 *
 * `symbolOf` names the symbol a character stands for, or returns null for an
 * ordinary one; a caller with no symbol table gets plain formatted text.
 *
 * Unknown tags are text. Unity does not strip what it cannot interpret, and
 * neither can this — the corpus has a stray `<click>` that shows up in the
 * game exactly as written.
 *
 * Unbalanced tags close themselves at the end of the line, which the corpus
 * needs: two of its 503 `<i>` are never closed.
 */
export function parseRichText(
  input: string,
  symbolOf: (character: string) => string | null = () => null,
): RichSpan[] {
  const spans: RichSpan[] = []
  const open: (keyof RichStyle)[] = []
  let pending = ''

  const style = (): RichStyle => ({
    bold: open.includes('bold'),
    italic: open.includes('italic'),
  })

  const flush = (): void => {
    if (pending.length === 0) return
    spans.push({ kind: 'text', text: pending, ...style() })
    pending = ''
  }

  for (let at = 0; at < input.length;) {
    const character = input[at] ?? ''

    if (character === '<') {
      const end = input.indexOf('>', at)
      const tag = end === -1 ? null : input.slice(at + 1, end).toLowerCase()
      const closing = tag !== null && tag.startsWith('/')
      const name = tag === null ? '' : closing ? tag.slice(1) : tag
      const known = Object.hasOwn(TAGS, name) ? TAGS[name] : undefined

      if (end !== -1 && known !== undefined) {
        flush()
        if (closing) {
          // The innermost matching tag, so `<b><i></b></i>` still unwinds.
          const found = open.lastIndexOf(known)
          if (found !== -1) open.splice(found, 1)
        } else {
          open.push(known)
        }
        at = end + 1
        continue
      }
    }

    const symbol = symbolOf(character)
    if (symbol !== null) {
      flush()
      spans.push({ kind: 'symbol', symbol, ...style() })
      at += character.length
      continue
    }

    pending += character
    at += 1
  }

  flush()
  return spans
}

/** Whether a line carries anything a plain-text renderer would get wrong. */
export function needsRichText(
  input: string,
  symbolOf: (character: string) => string | null = () => null,
): boolean {
  return parseRichText(input, symbolOf).some(
    (span) => span.kind === 'symbol' || span.bold || span.italic,
  )
}
