/**
 * Tests for config persistence (T-015).
 *
 * T-005 ported `ConfigFile` as data only, deferring the file I/O until a
 * filesystem existed. This is that half.
 */

import { describe, expect, it, vi } from 'vitest'

import { MemoryFileSystem, StoragePaths, StorageFullError } from '../src/filesystem.js'
import { autoSaveConfig, loadConfig, saveConfig } from '../src/configStore.js'

const paths = new StoragePaths({ appData: '/app', content: '/content', temp: '/tmp' }, 'D2E')

describe('loadConfig', () => {
  it('returns an empty config when there is no file', async () => {
    const config = await loadConfig(new MemoryFileSystem(), paths)

    expect(config.get('UserConfig', 'currentLang')).toBe('')
    expect(config.getPacks('D2E')).toEqual([])
  })

  it('reads an existing config', async () => {
    const fs = new MemoryFileSystem()
    await fs.writeText(
      paths.configPath,
      '[UserConfig]\ncurrentLang=German\n\n[D2EPacks]\nbase=\nFA=French\n',
    )

    const config = await loadConfig(fs, paths)

    expect(config.get('UserConfig', 'currentLang')).toBe('German')
    expect(config.getPacks('D2E')).toEqual(['base', 'FA'])
    expect(config.getPackLanguages('D2E').get('FA')).toBe('French')
  })

  it('reads the config from the app data root, not the per-game path', async () => {
    expect(paths.configPath).toBe('/app/config.ini')
  })
})

describe('saveConfig', () => {
  it('round-trips through the filesystem', async () => {
    const fs = new MemoryFileSystem()
    const config = await loadConfig(fs, paths)
    config.set('UserConfig', 'currentLang', 'Spanish')
    config.addPack('D2E', 'SOTP', 'English')

    await saveConfig(fs, paths, config)
    const reloaded = await loadConfig(fs, paths)

    expect(reloaded.get('UserConfig', 'currentLang')).toBe('Spanish')
    expect(reloaded.getPackLanguages('D2E').get('SOTP')).toBe('English')
  })

  it('creates the directory when it is missing', async () => {
    const fs = new MemoryFileSystem()
    const config = await loadConfig(fs, paths)
    config.set('UserConfig', 'x', 'y')

    await saveConfig(fs, paths, config)

    expect(await fs.exists(paths.configPath)).toBe(true)
  })

  // The C# catches every exception and logs a warning, so a full disk discards
  // the user's settings without telling them. In a browser a quota limit is a
  // normal condition, not an exceptional one.
  it('surfaces a full disk rather than swallowing it (DEVIATION)', async () => {
    const fs = new MemoryFileSystem(4)
    const config = await loadConfig(fs, paths)
    config.set('UserConfig', 'currentLang', 'a-language-name-longer-than-the-quota')

    await expect(saveConfig(fs, paths, config)).rejects.toBeInstanceOf(StorageFullError)
  })
})

describe('autoSaveConfig', () => {
  it('persists on every change', async () => {
    const fs = new MemoryFileSystem()
    const config = await loadConfig(fs, paths, autoSaveConfig(fs, paths))

    config.set('UserConfig', 'currentLang', 'German')
    await vi.waitFor(async () => {
      expect(await fs.exists(paths.configPath)).toBe(true)
    })

    const reloaded = await loadConfig(fs, paths)
    expect(reloaded.get('UserConfig', 'currentLang')).toBe('German')
  })

  it('reports a failed write instead of losing it silently', async () => {
    const fs = new MemoryFileSystem(4)
    const errors: unknown[] = []
    const config = await loadConfig(
      fs,
      paths,
      autoSaveConfig(fs, paths, (e) => errors.push(e)),
    )

    config.set('UserConfig', 'currentLang', 'a-language-name-longer-than-the-quota')

    await vi.waitFor(() => {
      expect(errors).toHaveLength(1)
    })
    expect(errors[0]).toBeInstanceOf(StorageFullError)
  })
})
