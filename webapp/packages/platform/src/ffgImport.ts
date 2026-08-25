/**
 * The FFG asset import pipeline.
 *
 * Port of `libraries/FFGAppImport`, which is 110 files of AssetStudio plus a
 * driver. This reads the same installs and produces the same layout, using the
 * targeted reader in `unityAssets.ts` and the decoders in `dds.ts`.
 *
 * It runs entirely on the user's device. The content is licensed to them and
 * must never reach our origin — that constraint is what shapes the whole
 * design, not a preference.
 *
 * Output layout matches what the Valkyrie content refers to as `{import}`:
 *
 *     <import>/img/<TextureName>.<ext>
 *     <import>/audio/<ClipName>.ogg
 *     <import>/text/<AssetName>.txt
 */

import { TextureFormat, decodeUnityTexture } from './dds.js'
import { fsbToOgg } from './fsb.js'
import { isUnityBundle, readBundle } from './unityBundle.js'
import type { FileSystem } from './filesystem.js'
import { combine } from './path.js'
import {
  ClassID,
  OBFUSCATE_KEY,
  deobfuscate,
  readObject,
  readSerializedFile,
  resolveStreamData,
} from './unityAssets.js'
import type { AudioAsset, TextAsset, TextureAsset } from './unityAssets.js'

export type GameId = 'MoM' | 'D2E'

/**
 * Where a game caches the content it downloads after installation.
 *
 * Current builds ship almost nothing in the install: Mansions of Madness 2.1.6
 * fetches its scenarios and all of its text on first run and puts them here.
 * Without this the import finds no `Localization_*` at all, and MoM base
 * content needs 3,725 `{ffg:…}` keys from it.
 */
export const CONTENT_CACHE: Record<GameId, Record<'macos' | 'windows' | 'linux', string>> = {
  MoM: {
    macos: 'Library/Caches/com.fantasyflightgames.mom',
    windows: 'AppData/LocalLow/Fantasy Flight Games/Mansions of Madness Second Edition',
    linux: '.cache/unity3d/Fantasy Flight Games/Mansions of Madness Second Edition',
  },
  D2E: {
    macos: 'Library/Caches/com.fantasyflightgames.rtl',
    windows: 'AppData/LocalLow/Fantasy Flight Games/Road to Legend',
    linux: '.cache/unity3d/Fantasy Flight Games/Road to Legend',
  },
}

/** Where the Unity data lives inside an install, per `AppFinder`. */
export const DATA_DIRECTORY: Record<GameId, Record<'macos' | 'windows', string>> = {
  MoM: {
    macos: 'Contents/Resources/Data',
    windows: 'Mansions of Madness_Data',
  },
  D2E: {
    macos: 'Contents/Resources/Data',
    windows: 'Road to Legend_Data',
  },
}

/**
 * The files an install exposes.
 *
 * Deliberately minimal so a browser directory handle, a Node directory and a
 * test fixture all satisfy it without the importer knowing which it has.
 */
export interface AssetSource {
  list(): Promise<string[]>
  read(name: string): Promise<Uint8Array>
}

/**
 * Turns decoded pixels into an encoded image.
 *
 * `sourceFormat` is Unity's `TextureFormat`, and it matters: whether the
 * pixels arrived from a lossy block format or an untouched one decides whether
 * re-encoding them lossily gives anything away. See `webpTextureEncoder`.
 */
export type TextureEncoder = (
  rgba: Uint8Array,
  width: number,
  height: number,
  sourceFormat: number,
) => Promise<{ bytes: Uint8Array; extension: string }>

/** Whether a Unity format is block-compressed, and so already lossy. */
export function isLossyFormat(format: number): boolean {
  return format === TextureFormat.DXT1 || format === TextureFormat.DXT5
}

export interface ImportOptions {
  fs: FileSystem
  source: AssetSource
  /** Where the import lands; `ContentData.ImportPath()`. */
  importPath: string
  game: GameId
  encodeTexture: TextureEncoder
  /**
   * Wraps raw FSB audio into a playable container. Defaults to
   * `fsbToOgg`; pass `null` to write the raw `.fsb` payloads instead.
   */
  encodeAudio?: ((asset: AudioAsset, data: Uint8Array) => Promise<Uint8Array | null>) | null
  onProgress?: (done: number, total: number, what: string) => void
  signal?: AbortSignal
}

export interface ImportResult {
  textures: number
  audio: number
  text: number
  /** Textures with no pixel data. The C# writes these out as empty files. */
  emptyTextures: number
  skipped: { name: string; reason: string }[]
  bytesWritten: number
}

/**
 * Files worth opening: an install's `.assets` and `globalgamemanagers`, plus
 * the `__data` AssetBundles a downloaded content cache is made of.
 */
function assetFiles(names: readonly string[]): string[] {
  return names
    .filter(
      (name) =>
        name.endsWith('.assets') ||
        name === 'globalgamemanagers' ||
        name.endsWith('__data') ||
        name.endsWith('.bundle'),
    )
    .sort()
}

interface AssetFile {
  name: string
  bytes: Uint8Array
  /** Resource blobs this file's streamed data points into. */
  resources: ReadonlyMap<string, Uint8Array>
}

/**
 * Expands one candidate file into the SerializedFiles it holds.
 *
 * A plain asset file is itself one. A `UnityFS` bundle holds several, each
 * with its own resource blobs alongside — those travel together, because a
 * texture's pixels live in a sibling entry of the same bundle.
 */
function expand(
  name: string,
  bytes: Uint8Array,
  shared: ReadonlyMap<string, Uint8Array>,
): AssetFile[] {
  if (!isUnityBundle(bytes)) return [{ name, bytes, resources: shared }]

  const entries = readBundle(bytes)
  const resources = new Map(shared)
  for (const entry of entries) {
    if (/\.(resource|resS)$/.test(entry.path)) resources.set(entry.path, entry.data)
  }

  return entries
    .filter((entry) => !/\.(resource|resS)$/.test(entry.path))
    .map((entry) => ({ name: `${name}!${entry.path}`, bytes: entry.data, resources }))
}

/**
 * Runs the import.
 *
 * Streaming data lives in sibling `.resS` and `.resource` files, which are
 * loaded once and shared: a texture's pixels usually sit in one of them rather
 * than inline in the asset file.
 */
export async function importFfgApp(options: ImportOptions): Promise<ImportResult> {
  const { fs, source, importPath, game } = options
  const names = await source.list()

  const resources = new Map<string, Uint8Array>()
  for (const name of names) {
    if (name.endsWith('.resS') || name.endsWith('.resource')) {
      resources.set(name, await source.read(name))
    }
  }

  const imgPath = combine(importPath, 'img')
  const audioPath = combine(importPath, 'audio')
  const textPath = combine(importPath, 'text')
  for (const path of [imgPath, audioPath, textPath]) await fs.createDirectory(path)

  const result: ImportResult = {
    textures: 0,
    audio: 0,
    text: 0,
    emptyTextures: 0,
    skipped: [],
    bytesWritten: 0,
  }

  const files = assetFiles(names)
  // Path ids repeat across files, so an object is identified by both.
  const seenObjects = new Set<string>()
  // Names repeat across the asset files — a dozen textures are called
  // "Image_2" — so a suffix is appended rather than letting one silently
  // overwrite another, which is what `GetAvailableFileName` does in the C#.
  const used = new Set<string>()
  const uniqueName = (name: string): string => {
    const base = sanitise(name)
    if (!used.has(base)) {
      used.add(base)
      return base
    }
    for (let i = 1; ; i++) {
      const candidate = `${base}_${String(i).padStart(6, '0')}`
      if (!used.has(candidate)) {
        used.add(candidate)
        return candidate
      }
    }
  }

  let done = 0
  for (const candidate of files) {
    options.signal?.throwIfAborted()

    const raw = await source.read(candidate)
    let expanded: AssetFile[]
    try {
      expanded = expand(candidate, raw, resources)
    } catch (error) {
      result.skipped.push({ name: candidate, reason: describe(error) })
      continue
    }

    for (const { name: file, bytes, resources: fileResources } of expanded) {
      let parsed
      try {
        parsed = readSerializedFile(bytes)
      } catch (error) {
        result.skipped.push({ name: file, reason: describe(error) })
        continue
      }

      for (const info of parsed.objects) {
        options.signal?.throwIfAborted()
        if (
          info.classId !== ClassID.Texture2D &&
          info.classId !== ClassID.AudioClip &&
          info.classId !== ClassID.TextAsset
        ) {
          continue
        }

        let asset
        try {
          asset = readObject(bytes, info, parsed.version)
        } catch (error) {
          result.skipped.push({ name: `${file}:${info.pathId}`, reason: describe(error) })
          continue
        }
        if (asset === null) continue

        // The same asset can appear in more than one bundle; write it once.
        const identity = `${asset.kind}:${asset.name}:${info.pathId}`
        if (seenObjects.has(identity)) continue
        seenObjects.add(identity)

        const payload =
          asset.kind === 'TextAsset'
            ? asset.data
            : asset.streamData !== null
              ? resolveStreamData(asset.streamData, fileResources)
              : asset.data

        try {
          if (asset.kind === 'Texture2D') {
            await writeTexture(asset, payload, uniqueName, imgPath, options, result)
          } else if (asset.kind === 'AudioClip') {
            await writeAudio(asset, payload, uniqueName, audioPath, options, result)
          } else {
            await writeText(asset, payload, uniqueName, textPath, game, options, result)
          }
        } catch (error) {
          result.skipped.push({ name: asset.name, reason: describe(error) })
        }

        done++
        options.onProgress?.(done, 0, asset.name)
      }
    }
  }

  return result
}

async function writeTexture(
  asset: TextureAsset,
  payload: Uint8Array,
  uniqueName: (name: string) => string,
  imgPath: string,
  options: ImportOptions,
  result: ImportResult,
): Promise<void> {
  if (asset.width === 0 || asset.height === 0 || payload.length === 0) {
    // Three textures in a real install are header-only. Counted, not written:
    // an empty image file would only fail later, further from the cause.
    result.emptyTextures++
    return
  }

  const rgba = decodeUnityTexture(asset.textureFormat, asset.width, asset.height, payload)
  const encoded = await options.encodeTexture(rgba, asset.width, asset.height, asset.textureFormat)
  const path = combine(imgPath, `${uniqueName(asset.name)}${encoded.extension}`)

  await options.fs.writeBytes(path, encoded.bytes)
  result.textures++
  result.bytesWritten += encoded.bytes.length
}

async function writeAudio(
  asset: AudioAsset,
  payload: Uint8Array,
  uniqueName: (name: string) => string,
  audioPath: string,
  options: ImportOptions,
  result: ImportResult,
): Promise<void> {
  if (payload.length === 0) return

  const encoder = options.encodeAudio === undefined ? defaultAudioEncoder : options.encodeAudio
  const encoded = encoder === null ? payload : await encoder(asset, payload)
  if (encoded === null) {
    // FSBExport writes a file anyway here, using a null setup header, and the
    // result does not decode — the user finds out when the sound is silent.
    // Reported instead.
    result.skipped.push({
      name: asset.name,
      reason: 'unsupported Vorbis setup header; no known header matches this stream',
    })
    return
  }

  const extension = encoder === null ? '.fsb' : '.ogg'
  const path = combine(audioPath, `${uniqueName(asset.name)}${extension}`)
  await options.fs.writeBytes(path, encoded)
  result.audio++
  result.bytesWritten += encoded.length
}

async function writeText(
  asset: TextAsset,
  payload: Uint8Array,
  uniqueName: (name: string) => string,
  textPath: string,
  game: GameId,
  options: ImportOptions,
  result: ImportResult,
): Promise<void> {
  const plain = deobfuscate(payload, OBFUSCATE_KEY[game])
  const path = combine(textPath, `${uniqueName(asset.name)}.txt`)

  await options.fs.writeBytes(path, plain)
  result.text++
  result.bytesWritten += plain.length
}

/** Rebuilds FSB5 Vorbis into a playable Ogg stream. */
const defaultAudioEncoder = async (
  _asset: AudioAsset,
  data: Uint8Array,
): Promise<Uint8Array | null> => fsbToOgg(data)

/** `GetAvailableFileName` strips what a filesystem will not take. */
function sanitise(name: string): string {
  const cleaned = name.replace(/[/\\?%*:|"<>]/g, '_').replace(/\s+/g, '_')
  return cleaned.length === 0 ? 'unnamed' : cleaned
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Quality for textures whose source was already block-compressed.
 *
 * Measured across 468 real Mansions of Madness textures. The rule is not
 * "lossless is safer": it depends on what the pixels came from.
 *
 * | source                  | count | as DDS  | lossless | q90     |
 * | ----------------------- | ----- | ------- | -------- | ------- |
 * | DXT1 / DXT5             |   398 | 68.4 MB |  51.5 MB | 15.5 MB |
 * | RGBA32 / RGB24 / Alpha8 |    70 | 64.3 MB |   6.3 MB |  3.2 MB |
 *
 * DXT is itself lossy, so encoding its output losslessly spends 3.3x the bytes
 * faithfully preserving block-compression artefacts. On the largest map tiles
 * lossless WebP comes out *larger than the source*. Those get q90.
 *
 * The uncompressed formats are pristine, and are UI art, icons and SDF font
 * atlases — flat colour that already compresses to under a tenth of source
 * losslessly. Introducing loss there would save around 3 MB and visibly damage
 * the SDF atlases, which is a bad trade. Those stay lossless.
 */
export const LOSSY_QUALITY = 0.9

/**
 * Encodes textures with the browser's own image encoder.
 *
 * WebP on measurement rather than habit, and lossy or lossless per source
 * format as above: together roughly 22 MB against 133 MB of source.
 */
export function canvasTextureEncoder(type = 'image/webp'): TextureEncoder {
  return async (rgba, width, height, sourceFormat) => {
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('No 2D context for texture encoding')

    // The buffer is copied because ImageData takes ownership of it.
    context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0)

    const lossy = isLossyFormat(sourceFormat)
    const blob = await canvas.convertToBlob({ type, quality: lossy ? LOSSY_QUALITY : 1 })
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      extension: blob.type === 'image/webp' ? '.webp' : '.png',
    }
  }
}
