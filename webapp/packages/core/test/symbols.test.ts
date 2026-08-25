/**
 * Tests for quest-text symbol replacement (T-018).
 *
 * The real assurance is `tools/differential/symbols`, which extracts
 * `OutputSymbolReplace` from `EventManager.cs` and compares it against this
 * over thousands of cases. These document the behaviour without needing
 * dotnet, and cover the failure paths.
 */

import { describe, expect, it, vi } from 'vitest'

import { characterMap, inputSymbolReplace, outputSymbolReplace } from '../src/quest/symbols.js'
import { VarManager } from '../src/quest/VarManager.js'

const context = (vars: Record<string, number> = {}, gameType = 'MoM') => {
  const manager = new VarManager()
  for (const [name, value] of Object.entries(vars)) manager.setValue(name, value)
  return { gameType, vars: manager }
}

describe('outputSymbolReplace', () => {
  it('leaves plain text alone', () => {
    expect(outputSymbolReplace('The door is locked.', context())).toBe('The door is locked.')
  })

  it('substitutes a variable', () => {
    expect(outputSymbolReplace('You have {var:$gold} gold.', context({ $gold: 7 }))).toBe(
      'You have 7 gold.',
    )
  })

  // VarManager returns 0 for anything unset, and the text shows it.
  it('reads an unset variable as zero', () => {
    expect(outputSymbolReplace('Count: {var:$nope}', context())).toBe('Count: 0')
  })

  it('substitutes every occurrence of the same variable', () => {
    expect(outputSymbolReplace('{var:$a}{var:$a}', context({ $a: 3 }))).toBe('33')
  })

  it('turns a marker into its glyph', () => {
    expect(outputSymbolReplace('Spend {heart}', context({}, 'D2E'))).toContain('≥')
  })

  /**
   * The mapping is per game, and the two barely overlap: Descent has
   * `{heart}`, `{fatigue}` and `{might}`, Mansions has `{clue}`, `{lore}` and
   * `{strength}`. Only `{will}` and `{action}` appear in both, with different
   * glyphs.
   */
  it('uses the map for the game type in play', () => {
    expect(outputSymbolReplace('{clue}', context({}, 'MoM'))).not.toBe('{clue}')
    expect(outputSymbolReplace('{clue}', context({}, 'D2E'))).toBe('{clue}')

    expect(outputSymbolReplace('{heart}', context({}, 'D2E'))).not.toBe('{heart}')
    expect(outputSymbolReplace('{heart}', context({}, 'MoM'))).toBe('{heart}')
  })

  it('gives a shared marker a different glyph per game', () => {
    const mom = outputSymbolReplace('{will}', context({}, 'MoM'))
    const d2e = outputSymbolReplace('{will}', context({}, 'D2E'))

    expect(mom).not.toBe('{will}')
    expect(d2e).not.toBe('{will}')
    expect(mom).not.toBe(d2e)
  })

  it('includes the expansion markers, which come from a second table', () => {
    expect(outputSymbolReplace('{MAD20}', context({}, 'MoM'))).not.toBe('{MAD20}')
  })

  it('leaves an unknown marker as written', () => {
    expect(outputSymbolReplace('A {nonsense} marker', context())).toBe('A {nonsense} marker')
  })

  /**
   * DEVIATION: `GetCharacterMap` returns null for an unknown game type and the
   * caller iterates it unchecked, so the C# throws NullReferenceException —
   * outside its own try/catch. Returning the text unchanged is better than
   * taking the app down.
   */
  it('returns the text unchanged for an unknown game type', () => {
    expect(outputSymbolReplace('A {heart} marker', context({}, 'Nope'))).toBe('A {heart} marker')
  })

  it('warns about a malformed clause and keeps what it has', () => {
    const onWarning = vi.fn()
    const result = outputSymbolReplace('Broken {var:$a and more', {
      ...context({ $a: 1 }),
      onWarning,
    })

    expect(onWarning).toHaveBeenCalledWith(expect.stringContaining('Invalid var clause'))
    expect(result).toBe('Broken {var:$a and more')
  })

  it('keeps substitutions made before a malformed clause', () => {
    const result = outputSymbolReplace('{var:$a} then {var:$b', context({ $a: 1, $b: 2 }))

    expect(result).toBe('1 then {var:$b')
  })

  it('is unbothered by bare braces', () => {
    expect(outputSymbolReplace('Just { and } braces', context())).toBe('Just { and } braces')
  })
})

describe('inputSymbolReplace', () => {
  it('turns a glyph back into its marker', () => {
    const forward = outputSymbolReplace('Spend {clue}', context())

    expect(inputSymbolReplace(forward, 'MoM')).toBe('Spend {clue}')
  })

  it('round-trips text with several markers', () => {
    const original = 'Spend {clue} and {lore}'
    const forward = outputSymbolReplace(original, context())

    expect(inputSymbolReplace(forward, 'MoM')).toBe(original)
  })

  it('leaves text alone for an unknown game type', () => {
    expect(inputSymbolReplace('anything', 'Nope')).toBe('anything')
  })
})

describe('characterMap', () => {
  it('is null for an unknown game type, as GetCharacterMap is', () => {
    expect(characterMap('Nope')).toBeNull()
  })

  it('adds the random-hero marker only when asked', () => {
    expect(characterMap('MoM', true)?.get('{rnd:hero}')).toBe('Rnd')
    expect(characterMap('MoM', false)?.has('{rnd:hero}')).toBe(false)
  })

  it('merges the expansion table only when asked', () => {
    expect(characterMap('MoM', false, true)?.has('{MAD20}')).toBe(true)
    expect(characterMap('MoM', false, false)?.has('{MAD20}')).toBe(false)
  })
})
