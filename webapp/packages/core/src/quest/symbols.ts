/**
 * Symbol replacement in quest text.
 *
 * Port of `EventManager.OutputSymbolReplace` and `InputSymbolReplace`. Every
 * line of text a quest shows goes through this, so it is worth being exact:
 * it substitutes `{var:…}` with live variable values and turns markers like
 * `{heart}` into the glyphs the game font carries.
 *
 * Verified against the extracted C# by `tools/differential/symbols`.
 */

import { CHARS_MAP, CHAR_PACKS_MAP } from './characterMap.js'
import type { VarManager } from './VarManager.js'

export interface SymbolContext {
  gameType: string
  vars: VarManager
  /** Receives the warning the C# logs for a malformed `{var:}` clause. */
  onWarning?: (message: string) => void
}

/**
 * The marker-to-glyph map for a game type.
 *
 * Returns null for an unknown game, as `GetCharacterMap` does — the callers
 * then iterate nothing rather than throwing.
 */
export function characterMap(
  gameType: string,
  addRandom = false,
  addPacks = false,
): Map<string, string> | null {
  const base = CHARS_MAP[gameType]
  if (base === undefined) return null

  const map = new Map(Object.entries(base))
  if (addRandom) map.set('{rnd:hero}', 'Rnd')
  if (addPacks) {
    for (const [marker, glyph] of Object.entries(CHAR_PACKS_MAP[gameType] ?? {})) {
      map.set(marker, glyph)
    }
  }
  return map
}

/**
 * Text as the player should see it: variables resolved, markers as glyphs.
 *
 * The `{var:}` loop mirrors the C# exactly, including that it re-searches from
 * the start after each substitution — which is what lets a variable's value
 * itself contain another marker.
 *
 * A malformed clause throws in the C#, is caught, and leaves the text
 * *unchanged from wherever it got to*. Reproduced: a scenario with a broken
 * clause shows partially-substituted text rather than nothing.
 */
export function outputSymbolReplace(input: string, context: SymbolContext): string {
  let output = input

  try {
    let index = output.indexOf('{var:')
    while (index !== -1) {
      const close = output.indexOf('}', index)
      if (close === -1) throw new Error('unclosed var clause')

      const statement = output.slice(index, close + 1)
      const name = statement.slice(5, statement.length - 1)
      output = output.split(statement).join(String(context.vars.getValue(name)))
      index = output.indexOf('{var:')
    }
  } catch {
    context.onWarning?.(`Warning: Invalid var clause in text: ${input}`)
  }

  for (const [marker, glyph] of characterMap(context.gameType, false, true) ?? []) {
    output = output.split(marker).join(glyph)
  }
  return output
}

/** The inverse, for storing text the editor produced. */
export function inputSymbolReplace(input: string, gameType: string): string {
  let output = input
  for (const [marker, glyph] of characterMap(gameType, false, true) ?? []) {
    output = output.split(glyph).join(marker)
  }
  return output
}
