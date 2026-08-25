/**
 * Writing ini files back out, for the quest editor.
 *
 * The editor's job is to round-trip: a quest opened in the web editor and
 * saved again must still load in the Unity build, and — just as important —
 * must not produce a diff in every line. Published quests live in git
 * repositories, and a whole-file diff on every save makes review impossible.
 *
 * That is why the line ending is preserved per file rather than normalised.
 * Measured across 12 published scenarios: **58 of 60 quest files are CRLF**,
 * written by the Unity editor on Windows. Normalising to LF would rewrite
 * essentially all of them.
 */

import type { IniData } from './IniData.js'

export type Newline = '\n' | '\r\n'

/**
 * The line ending a file already uses.
 *
 * Mixed files exist; the majority wins, because rewriting the minority is
 * unavoidable and the smaller diff is the better one. A file with no line
 * break at all defaults to LF.
 */
export function detectNewline(text: string): Newline {
  let crlf = 0
  let lf = 0

  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '\n') continue
    if (i > 0 && text[i - 1] === '\r') crlf++
    else lf++
  }

  if (crlf === 0 && lf === 0) return '\n'
  return crlf > lf ? '\r\n' : '\n'
}

export interface WriteOptions {
  /** Defaults to LF, which is what a new file gets. */
  newline?: Newline
  /** Written as the first line, as `QuestEditor` does. */
  header?: string
}

/**
 * Serialises ini data.
 *
 * `IniData.toString()` always writes LF, which is right for a save file
 * nothing else reads. A quest is different: it is the user's source, tracked
 * in git and shared with the Unity editor.
 */
export function writeIni(data: IniData, options: WriteOptions = {}): string {
  const newline = options.newline ?? '\n'
  const lines: string[] = []

  if (options.header !== undefined) lines.push(options.header)

  for (const [section, entries] of data.data) {
    // A blank line before each section, except the very first.
    if (lines.length > 0) lines.push('')
    lines.push(`[${section}]`)
    for (const [key, value] of entries) lines.push(`${key}=${value}`)
  }

  return lines.length === 0 ? '' : `${lines.join(newline)}${newline}`
}

/**
 * The comment lines at the top of a file, if any.
 *
 * `QuestEditor` writes `; Saved by version: X` as the first line of every file
 * it produces, and some quest files contain nothing else. Dropping it on save
 * would lose the marker and rewrite the file to empty.
 */
export function leadingComments(text: string): string[] {
  const comments: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.length === 0) continue
    if (!line.startsWith(';') && !line.startsWith('#')) break
    comments.push(line)
  }
  return comments
}

/**
 * Rewrites a file's content while keeping its line ending.
 *
 * The shape the editor actually needs: it has the original text and new data,
 * and must not change anything it was not asked to.
 */
export function rewriteIni(original: string, data: IniData, header?: string): string {
  const newline = detectNewline(original)
  // Keep whatever comment header the file already had, unless one is given.
  const existing = header ?? leadingComments(original).join(newline)
  const body = writeIni(data, {
    newline,
    ...(existing.length === 0 ? {} : { header: existing }),
  })

  // A file of nothing but comments still has to come back as itself rather
  // than as an empty file.
  if (body.length === 0 && existing.length > 0) return `${existing}${newline}`
  return body
}
