/**
 * Port of `libraries/ValkyrieTools/IniRead.cs`.
 *
 * Hundreds of published community scenarios are written against this parser's
 * exact behaviour, including the parts that look like bugs. Fidelity beats
 * elegance here; deliberate deviations are marked DEVIATION and listed in
 * `docs/ini-port-deviations.md`.
 *
 * The file-reading entry points (`ReadFromIni`) are intentionally absent: they
 * belong to the platform layer, so that this package stays free of host APIs.
 */

import { IniData } from './IniData.js'
import { log } from './logger.js'

/**
 * Equivalent of C# `String.Trim(char[])`: strips every leading and trailing
 * character that appears in `chars`. Section headers rely on this, so `[[a]]`
 * parses to `a` exactly as it does in the C# original.
 */
function trimChars(value: string, chars: string): string {
  let start = 0
  let end = value.length
  while (start < end && chars.includes(value[start]!)) start++
  while (end > start && chars.includes(value[end - 1]!)) end--
  return value.slice(start, end)
}

/** Parses INI text into an {@link IniData}. */
export function readFromString(content: string): IniData {
  // C#: content.Split(["\r", "\n"], StringSplitOptions.RemoveEmptyEntries)
  const lines = content.split(/[\r\n]/).filter((line) => line.length > 0)
  return readFromStringArray(lines, '<INTERNAL>')
}

/** Parses pre-split INI lines. `path` only ever appears in warnings. */
export function readFromStringArray(lines: readonly string[], path: string): IniData {
  const output = new IniData()

  let entries = new Map<string, string>()
  let sectionName = ''

  for (const line of lines) {
    const trimmed = line.trim()

    // DEVIATION 1: the C# evaluates `l.Trim()[0]` after only checking
    // `l.Length > 0`, so a whitespace-only line throws IndexOutOfRangeException
    // and takes down the load. We skip such lines instead. No existing content
    // can depend on the old behaviour, because the old behaviour was a crash.
    if (trimmed.length === 0) continue

    // Comments
    if (trimmed[0] === '#') continue
    if (trimmed[0] === ';') continue

    // Start of a new section
    if (trimmed[0] === '[') {
      if (sectionName !== '') {
        if (!output.addSection(sectionName, entries)) {
          log(`Warning: duplicate section "${sectionName}" in ${path} will be ignored.`)
        }
      }
      entries = new Map<string, string>()
      sectionName = trimChars(trimmed, '[]')
      if (sectionName === '') {
        log(`Warning: empty section in ${path} will be ignored.`)
      }
      continue
    }

    // Data line
    const equalsAt = line.indexOf('=')
    if (equalsAt === -1) {
      if (entries.has(trimmed)) {
        log(
          `Warning: duplicate "${trimmed}" data in section "${sectionName}" in ${path} will be ignored.`,
        )
      } else {
        entries.set(trimmed, '')
      }
    } else {
      const key = line.slice(0, equalsAt).trim()
      if (entries.has(key)) {
        log(
          `Warning: duplicate "${key}" data in section "${sectionName}" in ${path} will be ignored.`,
        )
      } else {
        // Whitespace first, then quotes — and no second whitespace pass, so
        // `key=" a "` keeps its inner spaces. Matches C# .Trim().Trim('"').
        entries.set(key, trimChars(line.slice(equalsAt + 1).trim(), '"'))
      }
    }

    // Data before any section header is parsed, then silently dropped when the
    // first real section replaces `entries`. Preserved from the original.
    if (sectionName === '') {
      log(`Warning: data ${line} without section in ${path} will be ignored.`)
    }
  }

  if (sectionName !== '') {
    if (!output.addSection(sectionName, entries)) {
      log(`Warning: duplicate section "${sectionName}" in ${path} will be ignored.`)
    }
  }

  return output
}

/**
 * Parses a single named section. Port of the three-argument
 * `ReadFromStringArray` overload, which behaves subtly differently from the
 * whole-file parser and is kept separate for that reason.
 *
 * Note the untrimmed `indexOf` checks: a section header only ends this section
 * if its `[` is at column 0, exactly as in the C#.
 */
export function readSectionFromStringArray(
  lines: readonly string[],
  path: string,
  section: string,
): Map<string, string> {
  const entries = new Map<string, string>()
  const find = `[${section}]`

  let found = false

  for (const line of lines) {
    if (found) {
      if (line.indexOf('[') === 0) break

      const trimmed = line.trim()
      // DEVIATION 1 again: skip whitespace-only lines rather than throwing.
      if (trimmed.length !== 0 && trimmed[0] !== ';') {
        const equalsAt = line.indexOf('=')
        if (equalsAt === -1) {
          // DEVIATION 2: the C# calls Dictionary.Add unguarded here, so a
          // repeated valueless key throws ArgumentException. We keep the
          // first occurrence, matching how every other duplicate in this
          // parser is handled.
          if (entries.has(trimmed)) {
            log(
              `Warning: duplicate "${trimmed}" data in section "${section}" in ${path} will be ignored.`,
            )
          } else {
            entries.set(trimmed, '')
          }
        } else {
          const key = line.slice(0, equalsAt).trim()
          if (!entries.has(key)) {
            entries.set(key, trimChars(line.slice(equalsAt + 1).trim(), '"'))
          }
        }
      }
    }

    if (line.indexOf(find) === 0) found = true
  }

  return entries
}
