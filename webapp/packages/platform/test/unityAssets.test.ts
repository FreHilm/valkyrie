/**
 * Tests for the Unity SerializedFile reader (T-014).
 *
 * The bulk of the assurance is `tools/differential/unity`, which reads a real
 * Mansions of Madness install and matches all 936 objects against AssetStudio
 * byte for byte. These cover the container rules and the alignment behaviour —
 * including one case a mutation test proved that corpus never exercises.
 */

import { describe, expect, it } from 'vitest'

import {
  ClassID,
  UnityAssetError,
  deobfuscate,
  looksObfuscated,
  parseUnityVersion,
  readObject,
  readSerializedFile,
  resolveStreamData,
  resourceKey,
} from '../src/unityAssets.js'
import type { UnityAsset } from '../src/unityAssets.js'
import {
  Builder,
  audioClipBody,
  fontBody,
  fontFile,
  serializedFile as fixtureFile,
  textAssetBody,
  texture2DBody,
} from './fixtures/unity.js'

/** Builds a minimal SerializedFile with one object of the given class. */
function serializedFile(options: {
  unityVersion?: string
  classId: number
  body: Uint8Array
  formatVersion?: number
}): Uint8Array {
  const version = options.unityVersion ?? '2022.3.62f2'
  const versionBytes = new TextEncoder().encode(`${version}\0`)

  // Header (48 bytes) + metadata + object data.
  const metadata: number[] = []
  const pushI32 = (value: number): void => {
    metadata.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff)
  }
  const pushI64 = (value: number): void => {
    pushI32(value)
    pushI32(0)
  }

  metadata.push(...versionBytes)
  pushI32(19) // target platform
  metadata.push(0) // enableTypeTree = false

  pushI32(1) // type count
  pushI32(options.classId) // classID
  metadata.push(0) // m_IsStrippedType
  metadata.push(0, 0) // m_ScriptTypeIndex
  for (let i = 0; i < 16; i++) metadata.push(0) // m_OldTypeHash

  pushI32(1) // object count
  while (metadata.length % 4 !== 0) metadata.push(0) // align before pathId
  pushI64(1) // pathId
  pushI64(0) // byteStart, relative to dataOffset
  pushI32(options.body.length) // byteSize
  pushI32(0) // typeID

  pushI32(0) // script count
  pushI32(0) // external count

  const headerSize = 48
  const dataOffset = headerSize + metadata.length
  const total = dataOffset + options.body.length
  const bytes = new Uint8Array(total)
  const view = new DataView(bytes.buffer)

  // The header is big-endian throughout.
  view.setUint32(0, metadata.length, false)
  view.setUint32(4, total, false)
  view.setUint32(8, options.formatVersion ?? 22, false)
  view.setUint32(12, dataOffset, false)
  view.setUint8(16, 0) // little-endian metadata
  view.setUint32(20, metadata.length, false)
  view.setBigInt64(24, BigInt(total), false)
  view.setBigInt64(32, BigInt(dataOffset), false)

  bytes.set(Uint8Array.from(metadata), headerSize)
  bytes.set(options.body, dataOffset)
  return bytes
}

/** An aligned Unity string: length prefix, bytes, padding to 4. */
function alignedString(text: string): number[] {
  const bytes = [...new TextEncoder().encode(text)]
  const out = [bytes.length & 0xff, (bytes.length >>> 8) & 0xff, 0, 0, ...bytes]
  while (out.length % 4 !== 0) out.push(0)
  return out
}

describe('parseUnityVersion', () => {
  it.each([
    ['2022.3.62f2', [2022, 3, 62]],
    ['2019.4.41f1', [2019, 4, 41]],
    ['5.6.7p4', [5, 6, 7]],
  ])('parses %s', (input, expected) => {
    expect(parseUnityVersion(input)).toEqual(expected)
  })
})

describe('readSerializedFile', () => {
  it('reads the header as big-endian', () => {
    const file = serializedFile({ classId: ClassID.TextAsset, body: new Uint8Array(8) })
    const parsed = readSerializedFile(file)

    expect(parsed.unityVersion).toBe('2022.3.62f2')
    expect(parsed.version).toEqual([2022, 3, 62])
    expect(parsed.formatVersion).toBe(22)
    expect(parsed.objects).toHaveLength(1)
  })

  it('locates the object relative to the data offset', () => {
    const body = Uint8Array.from([...alignedString('x'), 1, 0, 0, 0, 42])
    const file = serializedFile({ classId: ClassID.TextAsset, body })
    const parsed = readSerializedFile(file)

    expect(parsed.objects[0]?.byteStart).toBe(parsed.dataOffset)
    expect(parsed.objects[0]?.classId).toBe(ClassID.TextAsset)
  })

  // The port targets Unity 2020+ builds, where the large-file header exists.
  // Anything older needs the pre-22 branches, which are deliberately absent.
  it('refuses a format version older than large-file support', () => {
    const file = serializedFile({
      classId: ClassID.TextAsset,
      body: new Uint8Array(8),
      formatVersion: 17,
    })

    expect(() => readSerializedFile(file)).toThrow(/predates large-file support/)
  })

  it('refuses a big-endian metadata file', () => {
    const file = serializedFile({ classId: ClassID.TextAsset, body: new Uint8Array(8) })
    file[16] = 1

    expect(() => readSerializedFile(file)).toThrow(/Big-endian/)
  })
})

describe('readObject', () => {
  it('reads a TextAsset name and payload', () => {
    const payload = [1, 2, 3, 4, 5]
    const body = Uint8Array.from([...alignedString('script'), payload.length, 0, 0, 0, ...payload])
    const file = serializedFile({ classId: ClassID.TextAsset, body })
    const parsed = readSerializedFile(file)
    const asset = readObject(file, parsed.objects[0]!, parsed.version)

    expect(asset).toMatchObject({ kind: 'TextAsset', name: 'script' })
    expect([...(asset as { data: Uint8Array }).data]).toEqual(payload)
  })

  it('returns null for a class the import does not need', () => {
    const file = serializedFile({ classId: 1, body: new Uint8Array(8) })
    const parsed = readSerializedFile(file)

    expect(readObject(file, parsed.objects[0]!, parsed.version)).toBeNull()
  })

  /**
   * Unity pads to a 4-byte boundary after a variable-length field, and the
   * padding is relative to the file, not to the object's own slice.
   *
   * A mutation test over 936 real objects showed that removing the align after
   * `m_StreamingMipmaps` changed nothing — every texture in that install
   * happens to sit at a boundary already. That is a gap in the corpus rather
   * than proof the align is dead, so a name of odd length pins it here.
   */
  it.each(['a', 'ab', 'abc', 'abcd'])('aligns after a name of length %s', (name) => {
    const payload = [9, 8, 7]
    const body = Uint8Array.from([...alignedString(name), payload.length, 0, 0, 0, ...payload])
    const file = serializedFile({ classId: ClassID.TextAsset, body })
    const parsed = readSerializedFile(file)
    const asset = readObject(file, parsed.objects[0]!, parsed.version)

    expect(asset).toMatchObject({ name })
    expect([...(asset as { data: Uint8Array }).data]).toEqual(payload)
  })

  it('rejects a payload length that runs past the end', () => {
    const body = Uint8Array.from([...alignedString('x'), 0xff, 0xff, 0, 0])
    const file = serializedFile({ classId: ClassID.TextAsset, body })
    const parsed = readSerializedFile(file)

    expect(() => readObject(file, parsed.objects[0]!, parsed.version)).toThrow(UnityAssetError)
  })
})

describe('resolveStreamData', () => {
  const resources = new Map([['resources.assets.resS', Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7])]])

  it('slices the named resource file', () => {
    const data = resolveStreamData({ offset: 2, size: 3, path: 'resources.assets.resS' }, resources)

    expect([...data]).toEqual([2, 3, 4])
  })

  // Unity writes these as "archive:/CAB-xxxx/name.resS" in some builds.
  it('takes the file name from an archive-style path', () => {
    const data = resolveStreamData(
      { offset: 0, size: 2, path: 'archive:/CAB-abc123/resources.assets.resS' },
      resources,
    )

    expect([...data]).toEqual([0, 1])
  })

  it('returns nothing when the resource file is absent', () => {
    expect(resolveStreamData({ offset: 0, size: 4, path: 'missing.resS' }, resources)).toHaveLength(
      0,
    )
  })
})

describe('resourceKey', () => {
  // A texture names the file it streams from and never says where it sits, so
  // both the map and the lookup have to reduce to the same name. Keying by
  // anything longer left 729 of an install's 1183 textures importing as empty
  // when the source was rooted above the data directory.
  it('reduces a path to the file name', () => {
    expect(resourceKey('sharedassets0.assets.resS')).toBe('sharedassets0.assets.resS')
    expect(resourceKey('Wrapper/Game.app/Data/sharedassets0.assets.resS')).toBe(
      'sharedassets0.assets.resS',
    )
    expect(resourceKey('archive:/CAB-abc123/resources.assets.resS')).toBe('resources.assets.resS')
  })

  it('handles a Windows-style path', () => {
    expect(resourceKey('Game_Data\\resources.resource')).toBe('resources.resource')
  })
})

describe('reading the three asset classes', () => {
  const read = (classId: number, body: Uint8Array): unknown => {
    const file = fixtureFile([{ classId, body }])
    const parsed = readSerializedFile(file)
    return readObject(file, parsed.objects[0]!, parsed.version)
  }

  it('reads a Texture2D with inline pixels', () => {
    const payload = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])
    const asset = read(
      ClassID.Texture2D,
      texture2DBody({ name: 'Tile', width: 4, height: 4, format: 10, payload }),
    )

    expect(asset).toMatchObject({
      kind: 'Texture2D',
      name: 'Tile',
      width: 4,
      height: 4,
      textureFormat: 10,
      streamData: null,
    })
    expect([...(asset as { data: Uint8Array }).data]).toEqual([...payload])
  })

  it('reads a Texture2D whose pixels are streamed', () => {
    const asset = read(
      ClassID.Texture2D,
      texture2DBody({
        name: 'Streamed',
        width: 8,
        height: 8,
        format: 12,
        payload: new Uint8Array(0),
        streamPath: 'resources.assets.resS',
        streamOffset: 4096,
        streamSize: 32,
      }),
    ) as { streamData: { offset: number; size: number; path: string } | null; data: Uint8Array }

    expect(asset.streamData).toEqual({
      offset: 4096,
      size: 32,
      path: 'resources.assets.resS',
    })
    expect(asset.data).toHaveLength(0)
  })

  it('reads an AudioClip', () => {
    const payload = Uint8Array.from([0x46, 0x53, 0x42, 0x35])
    const asset = read(
      ClassID.AudioClip,
      audioClipBody({
        name: 'Click',
        channels: 2,
        frequency: 48000,
        compressionFormat: 1,
        payload,
      }),
    )

    expect(asset).toMatchObject({
      kind: 'AudioClip',
      name: 'Click',
      channels: 2,
      frequency: 48000,
      compressionFormat: 1,
    })
    expect([...(asset as { data: Uint8Array }).data]).toEqual([...payload])
  })

  it('reads an AudioClip whose data is streamed', () => {
    const asset = read(
      ClassID.AudioClip,
      audioClipBody({
        name: 'Music',
        channels: 1,
        frequency: 44100,
        compressionFormat: 1,
        payload: new Uint8Array(64),
        streamPath: 'resources.resource',
        streamOffset: 128,
      }),
    ) as { streamData: { offset: number; size: number; path: string } | null }

    expect(asset.streamData).toEqual({ offset: 128, size: 64, path: 'resources.resource' })
  })

  it('reads several objects from one file', () => {
    const file = fixtureFile([
      { classId: ClassID.TextAsset, body: textAssetBody('a', Uint8Array.from([1])) },
      { classId: ClassID.TextAsset, body: textAssetBody('b', Uint8Array.from([2])) },
      {
        classId: ClassID.AudioClip,
        body: audioClipBody({
          name: 'c',
          channels: 1,
          frequency: 8000,
          compressionFormat: 1,
          payload: Uint8Array.from([3, 4, 5, 6]),
        }),
      },
    ])
    const parsed = readSerializedFile(file)
    const names = parsed.objects.map((info) => {
      const asset = readObject(file, info, parsed.version)
      return asset === null ? null : asset.name
    })

    expect(names).toEqual(['a', 'b', 'c'])
  })
})

describe('reading a Font', () => {
  const read = (body: Uint8Array): UnityAsset | null => {
    const file = fixtureFile([{ classId: ClassID.Font, body }])
    const parsed = readSerializedFile(file)
    return readObject(file, parsed.objects[0]!, parsed.version)
  }

  it('reads the embedded font file out of a Font', () => {
    const font = fontFile()
    const asset = read(fontBody({ name: 'MADGaramondPro', font }))

    expect(asset).toMatchObject({ kind: 'Font', name: 'MADGaramondPro' })
    expect([...(asset?.data ?? [])]).toEqual([...font])
  })

  it('finds the font wherever the preamble ends', () => {
    // The real install puts m_FontData at byte 84 for one face and 6,456 for
    // another. Nothing about the search may depend on which.
    const font = fontFile()
    for (const preamble of [0, 4, 84, 6452]) {
      const asset = read(fontBody({ name: 'Face', font, preamble }))
      expect(asset?.data, `preamble of ${String(preamble)}`).toHaveLength(font.length)
    }
  })

  it('takes a CFF font as readily as a TrueType one', () => {
    const font = fontFile({ signature: 0x4f54544f })
    expect(read(fontBody({ name: 'Cff', font }))?.data).toHaveLength(font.length)
  })

  it('takes a font collection', () => {
    const font = fontFile({ signature: 0x74746366 })
    expect(read(fontBody({ name: 'Collection', font }))?.data).toHaveLength(font.length)
  })

  it('is not fooled by a signature that has no font behind it', () => {
    // The four bytes of a TrueType signature occur in ordinary data, and a
    // preamble is ordinary data. What rejects this is the table directory:
    // there is not one, so nothing here is a font.
    const b = new Builder()
    b.alignedString('NotAFont')
    b.i32(65536) // a length prefix
    b.u8(0x00).u8(0x01).u8(0x00).u8(0x00) // ... followed by the signature
    for (let i = 0; i < 8192; i++) b.u8(0x41)

    expect(read(b.build())).toBeNull()
  })

  it('rejects a font whose table directory runs off the end', () => {
    // Truncation is the failure that matters: half a font written to disk is
    // worse than none, because it loads as a font and draws nothing.
    const font = fontFile()
    const truncated = font.subarray(0, font.length - 100)
    const b = new Builder()
    b.alignedString('Truncated')
    b.u8Array(truncated)

    expect(read(b.build())).toBeNull()
  })

  it('ignores a run too short to be a font', () => {
    expect(read(fontBody({ name: 'Tiny', font: fontFile({ padding: 16 }) }))).toBeNull()
  })
})

describe('deobfuscate', () => {
  it('leaves data alone when the key is zero, as D2E does', () => {
    const data = Uint8Array.from([1, 2, 3, 4])

    expect(deobfuscate(data, 0)).toBe(data)
  })

  it('leaves plain text alone even with a key', () => {
    const text = new TextEncoder().encode('<?xml version="1.0"?>')

    expect(deobfuscate(text, 68264378)).toBe(text)
  })

  it('round-trips: XORing twice restores the original', () => {
    const key = 68264378
    // Control characters make it look obfuscated to the heuristic.
    const original = Uint8Array.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x02])
    const once = deobfuscate(original, key)
    const twice = deobfuscate(once, key)

    expect([...twice]).toEqual([...original])
  })

  /**
   * A quirk worth keeping: the C# only writes completed four-byte groups, so
   * a trailing partial group comes out as zeros rather than being carried
   * through. The shipped files are parsed on that basis.
   */
  it('drops a trailing partial group to zeros, as the C# does', () => {
    const data = Uint8Array.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06])
    const out = deobfuscate(data, 68264378)

    expect(out).toHaveLength(6)
    expect([...out.slice(4)]).toEqual([0, 0])
  })
})

describe('looksObfuscated', () => {
  it.each([
    ['plain text', 'hello world', false],
    ['text with tabs and newlines', 'a\tb\nc\r\n', false],
    ['empty', '', false],
  ])('%s', (_name, text, expected) => {
    expect(looksObfuscated(new TextEncoder().encode(text))).toBe(expected)
  })

  it('spots a control character', () => {
    expect(looksObfuscated(Uint8Array.from([0x41, 0x03, 0x42]))).toBe(true)
  })
})

/**
 * Older Unity versions, which no install here can exercise.
 *
 * The differential harness runs against Mansions of Madness on 2022.3, so the
 * version branches for anything earlier are never taken there. Descent's app
 * and older MoM builds use them, and neither is available to test against, so
 * they are pinned synthetically instead of left to chance.
 */
describe('older Unity layouts', () => {
  it.each([
    ['2020.3.48f1', [2020, 3, 48]],
    ['2019.4.41f1', [2019, 4, 41]],
    ['2018.4.36f1', [2018, 4, 36]],
  ])('reads a TextAsset from a %s file', (unityVersion, expected) => {
    const payload = Uint8Array.from([7, 7, 7, 7])
    const file = fixtureFile(
      [{ classId: ClassID.TextAsset, body: textAssetBody('old', payload) }],
      unityVersion,
    )
    const parsed = readSerializedFile(file)

    expect(parsed.version).toEqual(expected)
    const asset = readObject(file, parsed.objects[0]!, parsed.version)
    expect(asset).toMatchObject({ name: 'old' })
    expect([...(asset as { data: Uint8Array }).data]).toEqual([...payload])
  })

  it('reads an AudioClip regardless of version, since 5.0 unified the layout', () => {
    const file = fixtureFile(
      [
        {
          classId: ClassID.AudioClip,
          body: audioClipBody({
            name: 'old',
            channels: 1,
            frequency: 22050,
            compressionFormat: 1,
            payload: Uint8Array.from([1, 2, 3, 4]),
          }),
        },
      ],
      '2019.4.41f1',
    )
    const parsed = readSerializedFile(file)
    const asset = readObject(file, parsed.objects[0]!, parsed.version)

    expect(asset).toMatchObject({ kind: 'AudioClip', channels: 1, frequency: 22050 })
  })
})
