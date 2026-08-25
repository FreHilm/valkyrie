/**
 * Persistence for `ConfigFile`, which T-005 deliberately left out until a
 * filesystem existed.
 *
 * Port of the constructor and `Save()` of
 * `unity/Assets/Scripts/ConfigFile.cs`. The parsing and the accessors are in
 * `@valkyrie/core`; only the reading and writing are here.
 */

import { ConfigFile } from '@valkyrie/core'
import type { ConfigFileOptions } from '@valkyrie/core'

import type { FileSystem, StoragePaths } from './filesystem.js'

/**
 * Loads `config.ini`, or an empty config when there is none.
 *
 * The C# swallows a read failure by leaving `data` empty. A corrupt config is
 * not worth refusing to start over, so that is kept — but the error is passed
 * to `onError` rather than vanishing.
 */
export async function loadConfig(
  fs: FileSystem,
  paths: StoragePaths,
  options: ConfigFileOptions & { onError?: (error: unknown) => void } = {},
): Promise<ConfigFile> {
  const path = paths.configPath
  if (!(await fs.exists(path))) return ConfigFile.parse(null, options)

  try {
    return ConfigFile.parse(await fs.readText(path), options)
  } catch (error) {
    options.onError?.(error)
    return ConfigFile.parse(null, options)
  }
}

/**
 * Writes `config.ini`.
 *
 * DEVIATION: the C# catches every exception and logs a warning, so a full disk
 * silently discards the user's settings. This throws, so a caller can tell the
 * user — `StorageFullError` in particular is worth surfacing in a browser,
 * where quota is a normal condition rather than an exceptional one.
 */
export async function saveConfig(
  fs: FileSystem,
  paths: StoragePaths,
  config: ConfigFile,
): Promise<void> {
  await fs.createDirectory(dirnameOf(paths.configPath))
  await fs.writeText(paths.configPath, config.serialize())
}

/** Persists on every change, so settings survive a closed tab. */
export function autoSaveConfig(
  fs: FileSystem,
  paths: StoragePaths,
  onError?: (error: unknown) => void,
): ConfigFileOptions {
  return {
    onChanged: (config) => {
      void saveConfig(fs, paths, config).catch((error: unknown) => onError?.(error))
    },
  }
}

function dirnameOf(path: string): string {
  const at = path.lastIndexOf('/')
  return at <= 0 ? '/' : path.slice(0, at)
}
