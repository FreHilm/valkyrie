/**
 * Port of `ContentPack.cs` plus the `GetPackData` / `GetContentPack` parsing
 * from `ContentData.cs`.
 *
 * Pack *discovery* — scanning directories, extracting `.valkyrieContentPack`
 * archives, reading the download manifest — is not ported: it is filesystem
 * work belonging to T-011 and T-013. This module turns an already-read
 * `content_pack.ini` into a `ContentPack`.
 */

import type { IniData } from '../ini/IniData.js'
import { log } from '../ini/logger.js'
import { concatPath } from './context.js'

export interface ContentPack {
  name: string
  image: string
  /** null when the pack declares no icon, matching the C# default. */
  icon: string | null
  description: string
  id: string
  type: string
  /** Absolute paths of every ini in the pack, `content_pack.ini` first. */
  iniFiles: string[]
  /** Dictionary id -> localization files providing it. */
  localizationFiles: Map<string, string[]>
  /** Ids of other packs whose content loads with this one. */
  clone: string[]
}

export const CONTENT_PACK_INI = 'content_pack.ini'

export interface ParsePackOptions {
  /** Directory the pack was read from. Relative asset paths resolve against it. */
  path: string
  /** Where FFG-imported assets live, for `{import}`-prefixed values. */
  importPath: string
  /**
   * When set, the pack is only accepted if its `type` starts with this game
   * type name. Port of the `checkGameType` flag.
   */
  requireGameType?: string
}

/**
 * Builds a `ContentPack` from a parsed `content_pack.ini`, or null when the
 * pack is filtered out by game type.
 *
 * DEVIATION: the C# calls `Application.Quit()` when the ini is unreadable or
 * has no `name` — it terminates the process from inside a parser. This throws
 * instead, so a bad community pack can be reported rather than closing the app.
 */
export function parseContentPack(data: IniData, options: ParsePackOptions): ContentPack | null {
  const { path, importPath, requireGameType } = options

  const type = data.get('ContentPack', 'type')
  if (requireGameType !== undefined) {
    if (requireGameType.trim().length === 0 || !type.startsWith(requireGameType)) {
      log(
        `Could not find content pack file: ${path}Please check if type="${requireGameType}" was set correctly in ${CONTENT_PACK_INI} file.`,
      )
      return null
    }
  }

  const name = data.get('ContentPack', 'name')
  if (name === '') {
    throw new RangeError(`Failed to get name data out of ${concatPath(path, CONTENT_PACK_INI)}`)
  }

  const declaredImage = data.get('ContentPack', 'image')
  const image = declaredImage.startsWith('{import}')
    ? importPath + declaredImage.slice(8)
    : concatPath(path, declaredImage)

  // Left null rather than "" when absent — the C# never assigns the field.
  const iconValue = data.get('ContentPack', 'icon')
  const icon = iconValue.trim().length === 0 ? null : concatPath(path, iconValue)

  const iniFiles = [concatPath(path, CONTENT_PACK_INI)]
  const packData = data.getSection('ContentPackData')
  if (packData !== null) {
    for (const file of packData.keys()) iniFiles.push(concatPath(path, file))
  }

  // LanguageData keys are "<dictId> <relative file>".
  const localizationFiles = new Map<string, string[]>()
  const languageData = data.getSection('LanguageData')
  if (languageData !== null) {
    for (const entry of languageData.keys()) {
      const firstSpace = entry.indexOf(' ')
      if (firstSpace === -1) {
        // The C# calls Substring(0, -1) here and throws ArgumentOutOfRange.
        throw new RangeError(`LanguageData entry has no dictionary id: "${entry}"`)
      }
      const id = entry.slice(0, firstSpace)
      const file = entry.slice(firstSpace + 1)
      const existing = localizationFiles.get(id)
      if (existing === undefined) localizationFiles.set(id, [concatPath(path, file)])
      else existing.push(concatPath(path, file))
    }
  }

  return {
    type,
    name,
    id: data.get('ContentPack', 'id'),
    image,
    icon,
    description: data.get('ContentPack', 'description'),
    clone: data
      .get('ContentPack', 'clone')
      .split(' ')
      .filter((part) => part.length > 0),
    iniFiles,
    localizationFiles,
  }
}
