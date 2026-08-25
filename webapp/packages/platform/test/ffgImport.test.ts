/**
 * Tests for the FFG import pipeline (T-014) and the FSB5 reader (T-002).
 *
 * The real assurance is differential, against a licensed install:
 * `tools/differential/unity` matches all 936 objects to AssetStudio,
 * `tools/differential/dds` decodes 468 textures pixel-exact against Pillow,
 * and `tools/differential/fsb` matches 173 audio streams byte-for-byte to
 * FSBExport. These cover the orchestration and the failure paths.
 */

import { describe, expect, it, vi } from 'vitest'

import { MemoryFileSystem } from '../src/filesystem.js'
import { fsbToOgg, readFsb } from '../src/fsb.js'
import { importFfgApp, isLossyFormat, DATA_DIRECTORY } from '../src/ffgImport.js'
import type { AssetSource, TextureEncoder } from '../src/ffgImport.js'
import { TextureFormat } from '../src/dds.js'
import { ClassID } from '../src/unityAssets.js'
import {
  KNOWN_SETUP_CRC,
  audioClipBody,
  fsb5,
  serializedFile,
  textAssetBody,
  texture2DBody,
} from './fixtures/unity.js'

/** A source with no asset files at all. */
const emptySource: AssetSource = {
  list: async () => [],
  read: async () => new Uint8Array(0),
}

const encodeTexture: TextureEncoder = async (rgba, width, height) => ({
  bytes: Uint8Array.from([width, height, rgba.length & 0xff]),
  extension: '.webp',
})

const baseOptions = {
  importPath: '/import',
  game: 'MoM' as const,
  encodeTexture,
}

describe('DATA_DIRECTORY', () => {
  it('knows where each game keeps its Unity data', () => {
    expect(DATA_DIRECTORY.MoM.macos).toBe('Contents/Resources/Data')
    expect(DATA_DIRECTORY.MoM.windows).toBe('Mansions of Madness_Data')
    expect(DATA_DIRECTORY.D2E.windows).toBe('Road to Legend_Data')
  })
})

describe('isLossyFormat', () => {
  // The encoding policy turns on this: a block-compressed source is already
  // lossy, so re-encoding it losslessly preserves artefacts at 3x the size.
  it.each([TextureFormat.DXT1, TextureFormat.DXT5])('treats %i as already lossy', (format) => {
    expect(isLossyFormat(format)).toBe(true)
  })

  it.each([TextureFormat.RGBA32, TextureFormat.RGB24, TextureFormat.Alpha8])(
    'treats %i as pristine',
    (format) => {
      expect(isLossyFormat(format)).toBe(false)
    },
  )
})

describe('importFfgApp', () => {
  it('creates the output layout even with nothing to import', async () => {
    const fs = new MemoryFileSystem()
    const result = await importFfgApp({ ...baseOptions, fs, source: emptySource })

    expect(result).toMatchObject({ textures: 0, audio: 0, text: 0 })
    expect((await fs.stat('/import/img'))?.kind).toBe('directory')
    expect((await fs.stat('/import/audio'))?.kind).toBe('directory')
    expect((await fs.stat('/import/text'))?.kind).toBe('directory')
  })

  it('records a file it cannot parse instead of failing the whole import', async () => {
    const fs = new MemoryFileSystem()
    const source: AssetSource = {
      list: async () => ['broken.assets'],
      read: async () => new Uint8Array(64),
    }

    const result = await importFfgApp({ ...baseOptions, fs, source })

    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]?.name).toBe('broken.assets')
  })

  it('only reads the asset files, not every file in the directory', async () => {
    const read = vi.fn(async () => new Uint8Array(0))
    const source: AssetSource = {
      list: async () => ['readme.txt', 'app.info', 'boot.config'],
      read,
    }

    await importFfgApp({ ...baseOptions, fs: new MemoryFileSystem(), source })

    expect(read).not.toHaveBeenCalled()
  })

  it('loads the sibling resource files, where streamed pixels live', async () => {
    const read = vi.fn(async () => new Uint8Array(0))
    const source: AssetSource = {
      list: async () => ['resources.assets.resS', 'resources.resource'],
      read,
    }

    await importFfgApp({ ...baseOptions, fs: new MemoryFileSystem(), source })

    expect(read).toHaveBeenCalledWith('resources.assets.resS')
    expect(read).toHaveBeenCalledWith('resources.resource')
  })

  it('honours an abort signal', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      importFfgApp({
        ...baseOptions,
        fs: new MemoryFileSystem(),
        source: { list: async () => ['a.assets'], read: async () => new Uint8Array(0) },
        signal: controller.signal,
      }),
    ).rejects.toThrow()
  })
})

describe('readFsb', () => {
  it('rejects something that is not an FSB', () => {
    expect(() => readFsb(new Uint8Array(80))).toThrow(/Not an FSB5/)
  })

  it('rejects a file too short to hold a header', () => {
    expect(() => readFsb(Uint8Array.from([0x46, 0x53, 0x42, 0x35]))).toThrow(/Too short/)
  })

  it('rejects a non-Vorbis format, as the C# does', () => {
    const bytes = new Uint8Array(80)
    bytes.set([0x46, 0x53, 0x42, 0x35], 0) // "FSB5"
    const view = new DataView(bytes.buffer)
    view.setUint32(8, 1, true) // one sample
    view.setUint32(24, 2, true) // FMOD_SOUND_FORMAT_PCM16

    expect(() => readFsb(bytes)).toThrow(/Unsupported FSB audio format: 2/)
  })
})

describe('importFfgApp over synthetic assets', () => {
  /** A source built from fixture objects, plus optional resource files. */
  function sourceOf(
    files: Record<string, Uint8Array>,
    resources: Record<string, Uint8Array> = {},
  ): AssetSource {
    const all = { ...files, ...resources }
    return {
      list: async () => Object.keys(all),
      read: async (name) => all[name] ?? new Uint8Array(0),
    }
  }

  /** A 4x4 DXT1 block: two endpoints and sixteen indices. */
  const dxt1Block = Uint8Array.from([0x00, 0xf8, 0x1f, 0x00, 0, 0, 0, 0])

  it('writes textures, audio and text into the import layout', async () => {
    const fs = new MemoryFileSystem()
    const file = serializedFile([
      {
        classId: ClassID.Texture2D,
        body: texture2DBody({
          name: 'Tile',
          width: 4,
          height: 4,
          format: TextureFormat.DXT1,
          payload: dxt1Block,
        }),
      },
      {
        classId: ClassID.TextAsset,
        body: textAssetBody('Localization_English', new TextEncoder().encode('KEY,value')),
      },
    ])

    const result = await importFfgApp({
      ...baseOptions,
      fs,
      source: sourceOf({ 'resources.assets': file }),
    })

    expect(result).toMatchObject({ textures: 1, text: 1 })
    expect(await fs.exists('/import/img/Tile.webp')).toBe(true)
    expect(await fs.readText('/import/text/Localization_English.txt')).toBe('KEY,value')
  })

  it('reads pixels out of the sibling resource file when they are streamed', async () => {
    const fs = new MemoryFileSystem()
    const resource = new Uint8Array(64)
    resource.set(dxt1Block, 16)

    const file = serializedFile([
      {
        classId: ClassID.Texture2D,
        body: texture2DBody({
          name: 'Streamed',
          width: 4,
          height: 4,
          format: TextureFormat.DXT1,
          payload: dxt1Block,
          streamPath: 'resources.assets.resS',
          streamOffset: 16,
          streamSize: dxt1Block.length,
        }),
      },
    ])

    const encoded: number[] = []
    const result = await importFfgApp({
      ...baseOptions,
      fs,
      source: sourceOf({ 'resources.assets': file }, { 'resources.assets.resS': resource }),
      encodeTexture: async (rgba) => {
        encoded.push(rgba.length)
        return { bytes: Uint8Array.from([1]), extension: '.webp' }
      },
    })

    expect(result.textures).toBe(1)
    expect(encoded).toEqual([4 * 4 * 4])
  })

  // Three textures in a real install carry a header and no pixels. They reach
  // the reader as a streamed texture of zero length — an inline size of zero
  // is what signals "streamed", so the two cases are the same shape.
  it('counts a texture with no pixel data instead of writing an empty file', async () => {
    const fs = new MemoryFileSystem()
    const file = serializedFile([
      {
        classId: ClassID.Texture2D,
        body: texture2DBody({
          name: 'Empty',
          width: 0,
          height: 0,
          format: TextureFormat.DXT5,
          payload: new Uint8Array(0),
          streamPath: 'resources.assets.resS',
          streamOffset: 0,
          streamSize: 0,
        }),
      },
    ])

    const result = await importFfgApp({
      ...baseOptions,
      fs,
      source: sourceOf({ 'resources.assets': file }),
    })

    expect(result).toMatchObject({ textures: 0, emptyTextures: 1 })
    expect(await fs.exists('/import/img/Empty.webp')).toBe(false)
  })

  // A dozen real textures are called "Image_2"; one must not clobber another.
  it('gives repeated names a suffix rather than overwriting', async () => {
    const fs = new MemoryFileSystem()
    const texture = (name: string): { classId: number; body: Uint8Array } => ({
      classId: ClassID.Texture2D,
      body: texture2DBody({
        name,
        width: 4,
        height: 4,
        format: TextureFormat.DXT1,
        payload: dxt1Block,
      }),
    })

    await importFfgApp({
      ...baseOptions,
      fs,
      source: sourceOf({
        'resources.assets': serializedFile([texture('Image_2'), texture('Image_2')]),
      }),
    })

    expect(await fs.exists('/import/img/Image_2.webp')).toBe(true)
    expect(await fs.exists('/import/img/Image_2_000001.webp')).toBe(true)
  })

  it('makes a name with separators safe for a filesystem', async () => {
    const fs = new MemoryFileSystem()
    await importFfgApp({
      ...baseOptions,
      fs,
      source: sourceOf({
        'resources.assets': serializedFile([
          {
            classId: ClassID.Texture2D,
            body: texture2DBody({
              name: 'ui/icons: big',
              width: 4,
              height: 4,
              format: TextureFormat.DXT1,
              payload: dxt1Block,
            }),
          },
        ]),
      }),
    })

    expect(await fs.exists('/import/img/ui_icons__big.webp')).toBe(true)
  })

  it('reports an audio clip whose setup header is unknown', async () => {
    const fs = new MemoryFileSystem()
    const file = serializedFile([
      {
        classId: ClassID.AudioClip,
        body: audioClipBody({
          name: 'Noise',
          channels: 1,
          frequency: 44100,
          compressionFormat: 1,
          payload: Uint8Array.from([1, 2, 3, 4]),
        }),
      },
    ])

    const result = await importFfgApp({
      ...baseOptions,
      fs,
      source: sourceOf({ 'resources.assets': file }),
    })

    expect(result.audio).toBe(0)
    expect(result.skipped[0]?.reason).toMatch(/unsupported Vorbis setup header|FSB5/)
  })

  it('writes raw FSB payloads when audio conversion is turned off', async () => {
    const fs = new MemoryFileSystem()
    const payload = Uint8Array.from([9, 9, 9, 9])
    const file = serializedFile([
      {
        classId: ClassID.AudioClip,
        body: audioClipBody({
          name: 'Raw',
          channels: 2,
          frequency: 48000,
          compressionFormat: 1,
          payload,
        }),
      },
    ])

    const result = await importFfgApp({
      ...baseOptions,
      fs,
      source: sourceOf({ 'resources.assets': file }),
      encodeAudio: null,
    })

    expect(result.audio).toBe(1)
    expect([...(await fs.readBytes('/import/audio/Raw.fsb'))]).toEqual([9, 9, 9, 9])
  })

  // D2E ships its text unobfuscated; MoM XORs it with a key.
  it('deobfuscates MoM text but leaves D2E text alone', async () => {
    const obfuscated = Uint8Array.from([0x01, 0x02, 0x03, 0x04])
    const file = serializedFile([
      { classId: ClassID.TextAsset, body: textAssetBody('Text', obfuscated) },
    ])

    const momFs = new MemoryFileSystem()
    await importFfgApp({
      ...baseOptions,
      fs: momFs,
      game: 'MoM',
      source: sourceOf({ 'resources.assets': file }),
    })

    const d2eFs = new MemoryFileSystem()
    await importFfgApp({
      ...baseOptions,
      fs: d2eFs,
      game: 'D2E',
      source: sourceOf({ 'resources.assets': file }),
    })

    expect([...(await d2eFs.readBytes('/import/text/Text.txt'))]).toEqual([1, 2, 3, 4])
    expect([...(await momFs.readBytes('/import/text/Text.txt'))]).not.toEqual([1, 2, 3, 4])
  })

  it('reports progress as it goes', async () => {
    const seen: string[] = []
    await importFfgApp({
      ...baseOptions,
      fs: new MemoryFileSystem(),
      source: sourceOf({
        'resources.assets': serializedFile([
          { classId: ClassID.TextAsset, body: textAssetBody('One', new Uint8Array(4)) },
          { classId: ClassID.TextAsset, body: textAssetBody('Two', new Uint8Array(4)) },
        ]),
      }),
      onProgress: (_done, _total, what) => seen.push(what),
    })

    expect(seen).toEqual(['One', 'Two'])
  })
})

describe('FSB5 to Ogg', () => {
  /** A Vorbis audio packet. Bit 1 of the first byte selects the long block. */
  const packet = (length: number, long = false): Uint8Array => {
    const bytes = new Uint8Array(Math.max(length, 1))
    bytes[0] = long ? 0x02 : 0x00
    for (let i = 1; i < bytes.length; i++) bytes[i] = (i * 7) & 0xff
    return bytes
  }

  it('parses the sample header', () => {
    const file = fsb5({
      channels: 2,
      frequencyIndex: 9, // 48000
      crc32: KNOWN_SETUP_CRC,
      packets: [packet(16)],
    })

    const parsed = readFsb(file)

    expect(parsed.samples).toHaveLength(1)
    expect(parsed.samples[0]).toMatchObject({
      channels: 2,
      frequency: 48000,
      crc32: KNOWN_SETUP_CRC,
    })
  })

  it('reads the loop points when the sample carries them', () => {
    const file = fsb5({
      crc32: KNOWN_SETUP_CRC,
      loopStart: 1000,
      loopEnd: 200000,
      packets: [packet(16)],
    })

    expect(readFsb(file).samples[0]).toMatchObject({ loopStart: 1000, loopEnd: 200000 })
  })

  it('produces an Ogg stream that starts with a capture pattern', () => {
    const file = fsb5({ crc32: KNOWN_SETUP_CRC, packets: [packet(32), packet(48, true)] })
    const ogg = fsbToOgg(file)

    expect(ogg).not.toBeNull()
    expect(String.fromCharCode(...(ogg ?? new Uint8Array()).subarray(0, 4))).toBe('OggS')
  })

  // The C# writes a file anyway using a null setup header, and it does not
  // decode — verified with ffmpeg against the real Barricade_02 stream.
  it('refuses a stream whose setup header is unknown', () => {
    const file = fsb5({ crc32: 12345, packets: [packet(16)] })

    expect(fsbToOgg(file)).toBeNull()
  })

  it('returns nothing when the sample holds no packets', () => {
    expect(fsbToOgg(fsb5({ crc32: KNOWN_SETUP_CRC, packets: [] }))).toBeNull()
  })

  /**
   * Several packets, because a page is only emitted per audio packet: with one
   * packet the comment and setup headers stay buffered and never reach the
   * output. `FSBExport` behaves the same way — real clips carry hundreds of
   * packets, so it never shows there.
   */
  it('carries the loop points into the Ogg comment header', () => {
    const file = fsb5({
      crc32: KNOWN_SETUP_CRC,
      loopStart: 1000,
      loopEnd: 200000,
      packets: Array.from({ length: 6 }, (_, i) => packet(24, i % 2 === 1)),
    })
    // The identification packet is alone on the first page, so the comment
    // header lands further in; the whole stream is scanned.
    const ogg = fsbToOgg(file) ?? new Uint8Array()
    const text = new TextDecoder('latin1').decode(ogg)

    expect(text).toContain('LOOP_START=1000')
    expect(text).toContain('LOOP_END=200000')
  })
})
