/**
 * Localized text.
 *
 * `.agent/rules/text-localization.md` forbids hardcoded UI strings. Rather
 * than rely on review to catch them, the component API takes a `StringKey` and
 * has no overload that accepts a bare string — so writing an unlocalized
 * string is awkward, and the rule enforces itself.
 *
 * `rawText` exists for the cases that genuinely are not translatable — a
 * quest's own title, a filename, a number — and is named so that using it by
 * mistake stands out in review.
 */

import type { StringKey } from '@valkyrie/core'

/** Text that must be translated. */
export interface Localized {
  readonly kind: 'key'
  readonly key: StringKey
}

/** Content that is data rather than interface copy, so it is not translated. */
export interface Raw {
  readonly kind: 'raw'
  readonly value: string
}

export type Text = Localized | Raw

export function text(key: StringKey): Localized {
  return { kind: 'key', key }
}

/**
 * Content that is not interface copy: a quest name, an author, a file path.
 *
 * If you are reaching for this to write a label, a button or a message, it is
 * the wrong tool — add a translation key instead.
 */
export function rawText(value: string): Raw {
  return { kind: 'raw', value }
}

export function resolve(value: Text): string {
  return value.kind === 'raw' ? value.value : value.key.translate()
}
