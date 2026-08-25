/**
 * Port of `unity/Assets/Scripts/Content/RemoteContentPack.cs`.
 *
 * One entry of the remote content-pack manifest — the ini the app fetches from
 * `valkyrie-store` to decide what is available for download. Pure data: the
 * fetching and the local-availability check live in `@valkyrie/platform`.
 */

import { DEFAULT_LANGUAGE } from '../i18n/DictionaryI18n.js'

/** `.NET DateTime(0)` — the value the C# leaves in place when parsing fails. */
export const EPOCH_UNSET = '0001-01-01T00:00:00.000Z'

export interface RemoteContentPackFields {
  readonly [key: string]: string
}

export class RemoteContentPack {
  readonly identifier: string
  readonly defaultLanguage: string = DEFAULT_LANGUAGE

  languagesName = new Map<string, string>()
  languagesDescription = new Map<string, string>()
  /** null when the manifest names no image, matching the unassigned C# field. */
  image: string | null = null
  type = ''
  version = ''
  packageUrl = ''
  /** ISO 8601 in UTC. See `latestUpdate` in the deviations doc. */
  latestUpdate: string = EPOCH_UNSET

  /** Set by the availability check, not by the manifest. */
  downloaded = false
  updateAvailable = false
  valid = false

  constructor(identifier: string, fields: RemoteContentPackFields | Map<string, string>) {
    this.identifier = identifier
    this.valid = this.populate(fields)
  }

  populate(fields: RemoteContentPackFields | Map<string, string>): boolean {
    const entries: [string, string][] = fields instanceof Map ? [...fields] : Object.entries(fields)
    const get = (key: string): string | undefined => entries.find(([k]) => k === key)?.[1]

    // Both maps stay empty unless the default language is present — the C#
    // guards the whole loop on `name.English` existing, so a pack that ships
    // only `name.German` gets no names at all.
    this.languagesName = collectPrefixed(entries, 'name.', this.defaultLanguage)
    this.languagesDescription = collectPrefixed(entries, 'description.', this.defaultLanguage)

    this.type = get('type') ?? ''

    const image = get('image')
    if (image !== undefined) this.image = image.replace(/\\/g, '/')

    this.version = get('version') ?? ''
    this.packageUrl = get('url') ?? ''

    const latest = get('latest_update')
    this.latestUpdate =
      latest === undefined ? EPOCH_UNSET : (parseManifestDate(latest) ?? EPOCH_UNSET)

    return true
  }

  /** User language, then the default, then whatever came first, then "". */
  getTitle(userLanguage: string): string {
    return pick(this.languagesName, userLanguage, this.defaultLanguage)
  }

  getDescription(userLanguage: string): string {
    return pick(this.languagesDescription, userLanguage, this.defaultLanguage)
  }
}

function collectPrefixed(
  entries: readonly [string, string][],
  prefix: string,
  defaultLanguage: string,
): Map<string, string> {
  const result = new Map<string, string>()
  if (!entries.some(([key]) => key === prefix + defaultLanguage)) return result

  for (const [key, value] of entries) {
    if (key.startsWith(prefix)) result.set(key.slice(prefix.length), value)
  }
  return result
}

function pick(values: Map<string, string>, userLanguage: string, defaultLanguage: string): string {
  const exact = values.get(userLanguage)
  if (exact !== undefined) return exact
  const fallback = values.get(defaultLanguage)
  if (fallback !== undefined) return fallback
  for (const value of values.values()) return value
  return ''
}

/**
 * Parses a manifest `latest_update`.
 *
 * DEVIATION: the C# calls `DateTime.TryParse` with the *current culture* and
 * no styles, which converts a trailing `Z` to the machine's local time and
 * leaves `Kind = Local`. Two users in different timezones therefore read
 * different timestamps out of the same manifest. The port keeps UTC.
 *
 * Only the shapes the manifests actually use are accepted — ISO 8601, with or
 * without a zone. Anything else leaves the field at its unset value, as a
 * failed `TryParse` does.
 */
export function parseManifestDate(value: string): string | null {
  const trimmed = value.trim()
  if (
    !/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(trimmed)
  ) {
    return null
  }

  const normalised = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T')
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(normalised)
  const parsed = Date.parse(hasZone || !normalised.includes('T') ? normalised : `${normalised}Z`)
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString()
}
