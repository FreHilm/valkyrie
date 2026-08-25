/**
 * Port of the version comparison in `unity/Assets/Scripts/VersionManager.cs`
 * and the Android version-code generator in `libraries/SetVersion/Program.cs`.
 *
 * The network half of `VersionManager` (fetching the latest release) belongs
 * to the platform layer; this is the comparison logic the update check runs.
 */

import { log } from '../ini/logger.js'

const DIGITS_ONLY = /[^0-9]/g

/**
 * Whether a version string names a beta.
 *
 * More than two dot-separated components counts, so `3.12.1` is a beta while
 * `3.12` is not — patch releases are the beta channel.
 */
export function isBeta(version: string): boolean {
  return version.split('.').length > 2 || version.toLowerCase().includes('beta')
}

/** Release channel ranking: beta < normal < major. */
function versionPriority(version: string): number {
  const lower = version.toLowerCase()
  if (lower.includes('major')) return 3
  if (isBeta(version)) return 1
  return 2
}

/**
 * Whether `newVersion` supersedes `oldVersion`.
 *
 * Components are compared numerically with every non-digit stripped, so
 * `3.12a` and `3.12` compare equal on that pass. Only when the numbers are
 * identical does the release channel break the tie, which is how
 * `3.20 BETA` -> `3.20` reads as an update.
 */
export function versionNewer(oldVersion: string, newVersion: string): boolean {
  if (newVersion === '') return false
  if (oldVersion === '') return true

  const oldParts = oldVersion.split('.')
  const newParts = newVersion.split('.')
  const maxLength = Math.max(oldParts.length, newParts.length)

  for (let i = 0; i < maxLength; i++) {
    const oldNumber = Number.parseInt((oldParts[i] ?? '').replace(DIGITS_ONLY, ''), 10) || 0
    const newNumber = Number.parseInt((newParts[i] ?? '').replace(DIGITS_ONLY, ''), 10) || 0

    if (oldNumber < newNumber) return true
    if (oldNumber > newNumber) return false
  }

  return versionPriority(newVersion) > versionPriority(oldVersion)
}

/**
 * Whether `newVersion` supersedes or matches `oldVersion`.
 *
 * The equality check strips every non-digit from the *whole* string, so
 * `3.12` and `3.1.2` are considered equal here.
 */
export function versionNewerOrEqual(oldVersion: string, newVersion: string): boolean {
  if (oldVersion.replace(DIGITS_ONLY, '') === newVersion.replace(DIGITS_ONLY, '')) return true
  return versionNewer(oldVersion, newVersion)
}

/**
 * Android `versionCode` for a `major.minor.patch` string.
 *
 * Returns "0" for anything it cannot encode: an empty string, a letter
 * anywhere, a trailing suffix, or a value past Android's 2,100,000,000 limit.
 */
export function versionCodeGenerate(version: string): string {
  if (version.length === 0) {
    log('No version found to convert.')
    return '0'
  }

  if (version.length === 1) {
    if (version >= '0' && version <= '9') return version
    log('Version does not include a number.')
    return '0'
  }

  // Only digits and dots, except possibly the final character.
  for (let i = 0; i < version.length - 1; i++) {
    const char = version[i]!
    if (!(char >= '0' && char <= '9') && char !== '.') {
      log('Version has letters (other than a single final little).')
      return '0'
    }
  }

  let majorString = version
  let minorString = '0'
  let patchString = '0'

  const majorDot = version.indexOf('.')
  if (majorDot !== -1) {
    majorString = version.slice(0, majorDot)
    const minorDot = version.indexOf('.', majorDot + 1)
    minorString = version.slice(majorDot + 1)

    if (minorDot !== -1) {
      minorString = version.slice(majorDot + 1, minorDot)
      patchString = version.slice(minorDot + 1)
      const last = version[version.length - 1]!
      if (!(last >= '0' && last <= '9')) patchString = patchString.slice(0, -1)
    }
  }

  const major = parseComponent(majorString, 'major')
  if (major === null) return '0'
  const minor = parseComponent(minorString, 'minor')
  if (minor === null) return '0'
  const patch = parseComponent(patchString, 'patch')
  if (patch === null) return '0'

  const last = version[version.length - 1]!
  if (!(last >= '0' && last <= '9')) {
    log('Version does not end in a digit (suffixes not supported).')
    return '0'
  }

  // PRESERVED BUG: the C# accumulates into an `int`, so a large major
  // version overflows and wraps negative — and a negative number then passes
  // the "exceeds android limit" check and is returned as the version code.
  // `300.0.0` yields -1294967296 rather than being rejected.
  let versionCode = 0
  versionCode = (versionCode + Math.imul(patch, 10)) | 0
  versionCode = (versionCode + Math.imul(minor, 10000)) | 0
  versionCode = (versionCode + Math.imul(major, 10000000)) | 0

  if (versionCode > 2100000000) {
    log('Version exceeds android limit.')
    return '0'
  }
  return String(versionCode)
}

/** C# `int.TryParse`: the whole string must be an integer. */
function parseComponent(value: string, name: string): number | null {
  if (!/^[+-]?[0-9]+$/.test(value.trim())) {
    log(`Error reading ${name} version: ${value}.`)
    return null
  }
  return Number(value.trim())
}

/** What `version.txt` declares. */
export interface VersionFile {
  /** The version as written on line 1, e.g. "3.28". */
  base: string
  /** "BETA", "MAJOR", or null. Line 2, upper-cased. */
  channel: 'BETA' | 'MAJOR' | null
  /** What `SetVersion` writes as `bundleVersion`, e.g. "3.28-major". */
  bundle: string
}

/**
 * Parses `unity/Assets/Resources/version.txt`.
 *
 * Port of the reading half of `libraries/SetVersion/Program.cs`. The web build
 * needs the same answer so the in-app version display keeps matching the
 * Unity build's, and so a single `version.txt` stays the source of truth for
 * both.
 *
 * Returns null for an empty or blank file, where `SetVersion` prints
 * "version is invalid!" and exits without writing.
 */
export function parseVersionFile(content: string): VersionFile | null {
  const lines = content.split(/\r\n|\r|\n/)
  const base = (lines[0] ?? '').trim()
  if (base.length === 0) return null

  const declared = (lines[1] ?? '').trim().toUpperCase()
  const channel = declared === 'BETA' || declared === 'MAJOR' ? declared : null
  const suffix = channel === null ? '' : `-${channel.toLowerCase()}`

  return { base, channel, bundle: `${base}${suffix}` }
}
