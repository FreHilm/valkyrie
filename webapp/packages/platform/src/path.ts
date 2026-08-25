/**
 * Path helpers for the virtual filesystem.
 *
 * The Unity code uses `System.IO.Path` and `Path.DirectorySeparatorChar`
 * throughout — 61 `Path.Combine` calls, 60 raw separator references, 40
 * `GetDirectoryName`. That makes stored paths platform-dependent: the same
 * content pack yields `\`-separated paths on Windows and `/` elsewhere.
 *
 * The port normalises to `/` everywhere. `normalise` accepts either separator
 * on input so paths written by the Unity build stay readable.
 */

export const SEPARATOR = '/'

/** Rewrites `\` to `/` and collapses repeated separators. */
export function normalise(path: string): string {
  return path.replace(/\\/g, SEPARATOR).replace(/\/{2,}/g, SEPARATOR)
}

/**
 * `Path.Combine` semantics: an empty segment is skipped, a rooted segment
 * restarts the path, and exactly one separator joins the rest.
 */
export function combine(...segments: string[]): string {
  let result = ''
  for (const raw of segments) {
    const segment = normalise(raw)
    if (segment.length === 0) continue
    if (segment.startsWith(SEPARATOR)) {
      result = segment
      continue
    }
    if (result.length === 0) result = segment
    else result = result.endsWith(SEPARATOR) ? result + segment : result + SEPARATOR + segment
  }
  return result
}

/** `Path.GetDirectoryName`. Returns "" when there is no directory part. */
export function dirname(path: string): string {
  const normalised = trimTrailing(normalise(path))
  const at = normalised.lastIndexOf(SEPARATOR)
  if (at === -1) return ''
  if (at === 0) return SEPARATOR
  return normalised.slice(0, at)
}

/** `Path.GetFileName`. */
export function basename(path: string): string {
  const normalised = trimTrailing(normalise(path))
  const at = normalised.lastIndexOf(SEPARATOR)
  return at === -1 ? normalised : normalised.slice(at + 1)
}

/** `Path.GetExtension`, including the leading dot. "" when there is none. */
export function extname(path: string): string {
  const name = basename(path)
  const at = name.lastIndexOf('.')
  // A leading dot is part of the name, not an extension.
  if (at <= 0) return ''
  return name.slice(at)
}

/** `Path.GetFileNameWithoutExtension`. */
export function basenameWithoutExtension(path: string): string {
  const name = basename(path)
  const extension = extname(path)
  return extension.length === 0 ? name : name.slice(0, name.length - extension.length)
}

/** Splits into non-empty segments, discarding any leading root. */
export function segments(path: string): string[] {
  return normalise(path)
    .split(SEPARATOR)
    .filter((part) => part.length > 0)
}

/** Whether `child` sits at or below `parent`, after normalisation. */
export function isInside(parent: string, child: string): boolean {
  const base = trimTrailing(normalise(parent)) + SEPARATOR
  const target = normalise(child)
  return target === trimTrailing(normalise(parent)) || target.startsWith(base)
}

/**
 * Resolves `.` and `..` without touching a filesystem.
 *
 * Used by the archive extractor to check a destination stays inside its
 * target directory — the same guard `ZipManager.cs` applies, but without
 * needing `Path.GetFullPath` and a real working directory.
 */
export function resolve(path: string): string {
  const rooted = normalise(path).startsWith(SEPARATOR)
  const out: string[] = []
  for (const part of segments(path)) {
    if (part === '.') continue
    if (part === '..') {
      // A leading ".." on a relative path is kept; it cannot escape a root.
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop()
      else if (!rooted) out.push('..')
      continue
    }
    out.push(part)
  }
  const joined = out.join(SEPARATOR)
  return rooted ? SEPARATOR + joined : joined
}

function trimTrailing(path: string): string {
  if (path.length > 1 && path.endsWith(SEPARATOR)) return path.slice(0, -1)
  return path
}
