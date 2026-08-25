/**
 * A targeted reader for Unity `SerializedFile` archives.
 *
 * The FFG import has to run on the user's own device — the content is
 * licensed to them, not to us — so this has to work in a browser. AssetStudio,
 * which the Unity build uses, is 110 files of C# and reads every Unity class
 * there has ever been. The import needs exactly three: `Texture2D`,
 * `AudioClip` and `TextAsset`.
 *
 * So this reads the container faithfully and then only those three classes,
 * which is a few hundred lines rather than tens of thousands. Verified against
 * the real AssetStudio over a licensed Mansions of Madness install — 936
 * objects, every payload hash matching. See `tools/differential/unity`.
 *
 * Release builds strip the type tree, so objects are read by the field layout
 * for the file's Unity version, exactly as AssetStudio does.
 */

/** `ClassIDType` values for the three classes the import needs. */
export const ClassID = {
  Texture2D: 28,
  TextAsset: 49,
  AudioClip: 83,
} as const

export class UnityAssetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnityAssetError'
  }
}

/** Little-endian reader with Unity's 4-byte alignment rules. */
class Reader {
  private offset = 0
  private readonly view: DataView

  constructor(
    private readonly bytes: Uint8Array,
    private readonly base = 0,
  ) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  get position(): number {
    return this.offset
  }

  set position(value: number) {
    this.offset = value
  }

  get length(): number {
    return this.bytes.byteLength
  }

  u8(): number {
    return this.bytes[this.offset++] ?? 0
  }

  bool(): boolean {
    return this.u8() !== 0
  }

  i16(): number {
    const value = this.view.getInt16(this.offset, true)
    this.offset += 2
    return value
  }

  i32(): number {
    const value = this.view.getInt32(this.offset, true)
    this.offset += 4
    return value
  }

  u32(): number {
    const value = this.view.getUint32(this.offset, true)
    this.offset += 4
    return value
  }

  /** A raw 64-bit value. Path IDs are hashes and use the full range. */
  i64Raw(): bigint {
    const value = this.view.getBigInt64(this.offset, true)
    this.offset += 8
    return value
  }

  /**
   * A 64-bit *offset* as a `number`.
   *
   * File positions stay far below `Number.MAX_SAFE_INTEGER`, so anything
   * larger means a corrupt file and is rejected rather than silently
   * truncated. Path IDs deliberately do not go through here — in an
   * AssetBundle they are 64-bit hashes that routinely exceed the safe range,
   * which is why `i64Raw` exists.
   */
  i64(): number {
    const value = this.view.getBigInt64(this.offset, true)
    this.offset += 8
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(-Number.MAX_SAFE_INTEGER)) {
      throw new UnityAssetError(`Offset out of range: ${value}`)
    }
    return Number(value)
  }

  f32(): number {
    const value = this.view.getFloat32(this.offset, true)
    this.offset += 4
    return value
  }

  bytesOf(count: number): Uint8Array {
    const slice = this.bytes.subarray(this.offset, this.offset + count)
    this.offset += count
    return slice
  }

  /** Reads to the next NUL. Used for the Unity version string. */
  stringToNull(): string {
    const start = this.offset
    while (this.offset < this.bytes.byteLength && this.bytes[this.offset] !== 0) this.offset++
    const text = new TextDecoder().decode(this.bytes.subarray(start, this.offset))
    this.offset++
    return text
  }

  /** Unity pads to a 4-byte boundary after variable-length data. */
  align(): void {
    const absolute = this.base + this.offset
    const padding = (4 - (absolute % 4)) % 4
    this.offset += padding
  }

  alignedString(): string {
    const length = this.i32()
    if (length < 0 || this.offset + length > this.bytes.byteLength) {
      throw new UnityAssetError(`Bad string length: ${length}`)
    }
    const text = new TextDecoder().decode(this.bytesOf(length))
    this.align()
    return text
  }

  u8Array(): Uint8Array {
    const length = this.i32()
    if (length < 0 || this.offset + length > this.bytes.byteLength) {
      throw new UnityAssetError(`Bad array length: ${length}`)
    }
    return this.bytesOf(length)
  }
}

export interface ObjectInfo {
  /**
   * Unity's object identifier. A `bigint` because an AssetBundle's path IDs
   * are 64-bit hashes, not the small sequential numbers an install's asset
   * files use — they overflow `Number.MAX_SAFE_INTEGER` routinely.
   */
  pathId: bigint
  byteStart: number
  byteSize: number
  classId: number
}

export interface SerializedFileInfo {
  unityVersion: string
  /** Major, minor, patch, parsed from `unityVersion`. */
  version: [number, number, number]
  formatVersion: number
  dataOffset: number
  objects: ObjectInfo[]
  /** Sibling files this one references, in index order. */
  externals: string[]
}

/** `2022.3.62f2` -> `[2022, 3, 62]`. */
export function parseUnityVersion(text: string): [number, number, number] {
  const parts = text.split(/[.fpab]/).filter((p) => p.length > 0)
  return [Number(parts[0] ?? 0), Number(parts[1] ?? 0), Number(parts[2] ?? 0)]
}

const FORMAT_LARGE_FILES = 22
const FORMAT_HAS_TYPE_TREE_HASHES = 13
const FORMAT_REFACTORED_CLASS_ID = 16
const FORMAT_REFACTOR_TYPE_DATA = 17
const FORMAT_STORES_TYPE_DEPENDENCIES = 21

/** Parses the container: header, type table and object table. */
export function readSerializedFile(bytes: Uint8Array): SerializedFileInfo {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  // The whole header is big-endian. AssetStudio switches its reader to
  // little-endian only *after* the large-file fields, so those are big-endian
  // too — reading them the other way yields a nonsense data offset.
  view.getUint32(0, false) // metadata size
  view.getUint32(4, false) // file size
  const formatVersion = view.getUint32(8, false)
  view.getUint32(12, false) // data offset

  if (formatVersion < FORMAT_LARGE_FILES) {
    throw new UnityAssetError(
      `SerializedFile version ${formatVersion} predates large-file support; only Unity 2020+ builds are supported`,
    )
  }
  if (view.getUint8(16) !== 0) {
    throw new UnityAssetError('Big-endian asset files are not supported')
  }

  view.getUint32(20, false) // metadata size, restated
  view.getBigInt64(24, false) // file size, restated
  const dataOffset = Number(view.getBigInt64(32, false))
  // 40..47 is an unused 64-bit field.

  // Everything from here is little-endian.
  const reader = new Reader(bytes)
  reader.position = 48

  const unityVersion = reader.stringToNull()
  const version = parseUnityVersion(unityVersion)
  reader.i32() // target platform

  const enableTypeTree = formatVersion >= FORMAT_HAS_TYPE_TREE_HASHES ? reader.bool() : true

  const typeCount = reader.i32()
  const types: number[] = []
  for (let i = 0; i < typeCount; i++) {
    types.push(readSerializedType(reader, formatVersion, enableTypeTree, false))
  }

  const objectCount = reader.i32()
  const objects: ObjectInfo[] = []
  for (let i = 0; i < objectCount; i++) {
    reader.align()
    const pathId = reader.i64Raw()
    const byteStart = reader.i64() + dataOffset
    const byteSize = reader.u32()
    const typeId = reader.i32()
    const classId = types[typeId] ?? -1
    objects.push({ pathId, byteStart, byteSize, classId })
  }

  const scriptCount = reader.i32()
  for (let i = 0; i < scriptCount; i++) {
    reader.i32() // localSerializedFileIndex
    reader.align()
    // localIdentifierInFile is an identifier, not an offset, so it uses the
    // full 64-bit range just as a path ID does.
    reader.i64Raw()
  }

  const externalCount = reader.i32()
  const externals: string[] = []
  for (let i = 0; i < externalCount; i++) {
    reader.stringToNull() // temp empty
    reader.position += 16 // guid
    reader.i32() // type
    externals.push(reader.stringToNull())
  }

  return { unityVersion, version, formatVersion, dataOffset, objects, externals }
}

/** Returns the class id, skipping the parts the import does not need. */
function readSerializedType(
  reader: Reader,
  formatVersion: number,
  enableTypeTree: boolean,
  isRefType: boolean,
): number {
  const classId = reader.i32()
  if (formatVersion >= FORMAT_REFACTORED_CLASS_ID) reader.bool()

  let scriptTypeIndex = -1
  if (formatVersion >= FORMAT_REFACTOR_TYPE_DATA) scriptTypeIndex = reader.i16()

  if (formatVersion >= FORMAT_HAS_TYPE_TREE_HASHES) {
    const hasScriptId = isRefType
      ? scriptTypeIndex >= 0
      : formatVersion >= FORMAT_REFACTORED_CLASS_ID
        ? classId === 114
        : classId < 0
    if (hasScriptId) reader.position += 16
    reader.position += 16
  }

  if (enableTypeTree) {
    skipTypeTreeBlob(reader, formatVersion)
    if (formatVersion >= FORMAT_STORES_TYPE_DEPENDENCIES) {
      if (isRefType) {
        reader.stringToNull()
        reader.stringToNull()
        reader.stringToNull()
      } else {
        const dependencies = reader.i32()
        reader.position += dependencies * 4
      }
    }
  }

  return classId
}

/**
 * Skips an embedded type tree.
 *
 * Release builds strip these, so this path is rarely taken — but a development
 * build has them and would otherwise desynchronise the whole table.
 */
function skipTypeTreeBlob(reader: Reader, formatVersion: number): void {
  const nodeCount = reader.i32()
  const stringBufferSize = reader.i32()
  const nodeSize = formatVersion >= 19 ? 32 : 24
  reader.position += nodeCount * nodeSize + stringBufferSize
}

export interface StreamingInfo {
  offset: number
  size: number
  path: string
}

export interface TextureAsset {
  kind: 'Texture2D'
  pathId: bigint
  name: string
  width: number
  height: number
  textureFormat: number
  mipCount: number
  /** Where the pixels live when they are not inline. */
  streamData: StreamingInfo | null
  /** Inline pixel data, empty when `streamData` is set. */
  data: Uint8Array
}

export interface AudioAsset {
  kind: 'AudioClip'
  pathId: bigint
  name: string
  channels: number
  frequency: number
  compressionFormat: number
  streamData: StreamingInfo | null
  data: Uint8Array
}

export interface TextAsset {
  kind: 'TextAsset'
  pathId: bigint
  name: string
  data: Uint8Array
}

export type UnityAsset = TextureAsset | AudioAsset | TextAsset

/** Reads one object's body. Returns null for a class the import ignores. */
export function readObject(
  bytes: Uint8Array,
  info: ObjectInfo,
  version: [number, number, number],
): UnityAsset | null {
  const body = bytes.subarray(info.byteStart, info.byteStart + info.byteSize)
  // `base` carries the absolute position so Unity's alignment lands where it
  // does in the whole file, not where it would in an isolated slice.
  const reader = new Reader(body, info.byteStart)

  switch (info.classId) {
    case ClassID.Texture2D:
      return readTexture2D(reader, info, version)
    case ClassID.AudioClip:
      return readAudioClip(reader, info)
    case ClassID.TextAsset:
      return readTextAsset(reader, info)
    default:
      return null
  }
}

const atLeast = (version: [number, number, number], major: number, minor: number): boolean =>
  version[0] > major || (version[0] === major && version[1] >= minor)

function readTexture2D(
  reader: Reader,
  info: ObjectInfo,
  version: [number, number, number],
): TextureAsset {
  const name = reader.alignedString()

  // Texture base class.
  if (atLeast(version, 2017, 3)) {
    reader.i32() // m_ForcedFallbackFormat
    reader.bool() // m_DownscaleFallback
    if (atLeast(version, 2020, 2)) reader.bool() // m_IsAlphaChannelOptional
    reader.align()
  }

  const width = reader.i32()
  const height = reader.i32()
  reader.i32() // m_CompleteImageSize
  if (version[0] >= 2020) reader.i32() // m_MipsStripped
  const textureFormat = reader.i32()
  const mipCount = reader.i32()

  reader.bool() // m_IsReadable
  if (version[0] >= 2020) reader.bool() // m_IsPreProcessed
  if (atLeast(version, 2019, 3)) {
    if (atLeast(version, 2022, 2)) {
      reader.bool() // m_IgnoreMipmapLimit
      reader.align()
    } else {
      reader.bool() // m_IgnoreMasterTextureLimit
    }
  }
  if (atLeast(version, 2022, 2)) reader.alignedString() // m_MipmapLimitGroupName
  if (atLeast(version, 2018, 2)) reader.bool() // m_StreamingMipmaps
  reader.align()
  if (atLeast(version, 2018, 2)) reader.i32() // m_StreamingMipmapsPriority

  reader.i32() // m_ImageCount
  reader.i32() // m_TextureDimension

  // GLTextureSettings
  reader.i32() // filter
  reader.i32() // aniso
  reader.f32() // mip bias
  reader.i32() // wrap U
  if (version[0] >= 2017) {
    reader.i32() // wrap V
    reader.i32() // wrap W
  }

  reader.i32() // m_LightmapFormat
  reader.i32() // m_ColorSpace
  if (atLeast(version, 2020, 2)) {
    reader.u8Array() // m_PlatformBlob
    reader.align()
  }

  let size = reader.i32()
  let streamData: StreamingInfo | null = null
  if (size === 0) {
    streamData = readStreamingInfo(reader, version)
    size = streamData.size
    if (streamData.path.length === 0) streamData = null
  }

  const data = streamData === null ? reader.bytesOf(size) : new Uint8Array(0)
  return {
    kind: 'Texture2D',
    pathId: info.pathId,
    name,
    width,
    height,
    textureFormat,
    mipCount,
    streamData,
    data,
  }
}

function readStreamingInfo(reader: Reader, version: [number, number, number]): StreamingInfo {
  const offset = version[0] >= 2020 ? reader.i64() : reader.u32()
  const size = reader.u32()
  const path = reader.alignedString()
  return { offset, size, path }
}

/** Unity 5.0 unified this layout, so no version branching is needed here. */
function readAudioClip(reader: Reader, info: ObjectInfo): AudioAsset {
  const name = reader.alignedString()

  reader.i32() // m_LoadType
  const channels = reader.i32()
  const frequency = reader.i32()
  reader.i32() // m_BitsPerSample
  reader.f32() // m_Length
  reader.bool() // m_IsTrackerFormat
  reader.align()
  reader.i32() // m_SubsoundIndex
  reader.bool() // m_PreloadAudioData
  reader.bool() // m_LoadInBackground
  reader.bool() // m_Legacy3D
  reader.align()

  // StreamedResource
  const path = reader.alignedString()
  const offset = reader.i64()
  const size = reader.i64()
  const compressionFormat = reader.i32()

  const streamData = path.length > 0 ? { offset, size, path } : null
  const data = streamData === null ? reader.bytesOf(size) : new Uint8Array(0)

  return {
    kind: 'AudioClip',
    pathId: info.pathId,
    name,
    channels,
    frequency,
    compressionFormat,
    streamData,
    data,
  }
}

function readTextAsset(reader: Reader, info: ObjectInfo): TextAsset {
  const name = reader.alignedString()
  return { kind: 'TextAsset', pathId: info.pathId, name, data: reader.u8Array() }
}

/** Resolves a `StreamingInfo` against the sibling resource files. */
export function resolveStreamData(
  info: StreamingInfo,
  resources: ReadonlyMap<string, Uint8Array>,
): Uint8Array {
  // Unity records these as "archive:/CAB-xxxx/name.resS" or a bare filename.
  const name = info.path.slice(info.path.lastIndexOf('/') + 1)
  const file = resources.get(name)
  if (file === undefined) return new Uint8Array(0)
  return file.subarray(info.offset, info.offset + info.size)
}

/** `MoMFinder.ObfuscateKey()`. D2E ships its text in the clear. */
export const OBFUSCATE_KEY = { MoM: 68264378, D2E: 0 } as const

/**
 * Whether a payload looks like obfuscated binary rather than text.
 *
 * Port of `TextAsset.isBinary`: any control character means obfuscated. The
 * ranges deliberately exclude tab, newline and carriage return, which are
 * ordinary in the localisation files.
 */
export function looksObfuscated(data: Uint8Array): boolean {
  for (const byte of data) {
    if ((byte > 0 && byte < 8) || (byte > 13 && byte < 26)) return true
  }
  return false
}

/**
 * Undoes the XOR obfuscation MoM applies to its text assets.
 *
 * Port of `TextAsset.Deobfuscate`. Four bytes at a time are read big-endian,
 * XORed with the key and written back.
 *
 * A quirk worth keeping: when the length is not a multiple of four, the final
 * partial group is **never written**, so those trailing bytes come out as
 * zeros. The C# allocates the output array and only fills completed groups.
 * Reproduced, because the shipped files are parsed on that basis.
 */
export function deobfuscate(data: Uint8Array, key: number): Uint8Array {
  if (key === 0 || !looksObfuscated(data)) return data

  const out = new Uint8Array(data.length)
  const group = new Uint8Array(4)
  let offset = 0

  for (let i = 0; i < data.length; i++) {
    group[offset++] = data[i] ?? 0
    if (offset < 4) continue

    const value =
      (((group[0] ?? 0) << 24) |
        ((group[1] ?? 0) << 16) |
        ((group[2] ?? 0) << 8) |
        (group[3] ?? 0)) ^
      key
    offset = 0

    out[i - 3] = (value >>> 24) & 0xff
    out[i - 2] = (value >>> 16) & 0xff
    out[i - 1] = (value >>> 8) & 0xff
    out[i] = value & 0xff
  }
  return out
}
