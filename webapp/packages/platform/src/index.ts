export {
  SEPARATOR,
  normalise,
  combine,
  dirname,
  basename,
  extname,
  basenameWithoutExtension,
  segments,
  isInside,
  resolve,
} from './path.js'

export {
  MemoryFileSystem,
  StorageFullError,
  NotFoundError,
  StoragePaths,
  defaultLayout,
  cleanTemp,
  findFiles,
  splitLines,
} from './filesystem.js'
export type {
  FileSystem,
  FileStat,
  ListOptions,
  StorageEstimate,
  StorageLayout,
} from './filesystem.js'

export { OpfsFileSystem, opfsAvailable } from './opfs.js'
export type {
  DirectoryHandleLike,
  FileHandleLike,
  WritableLike,
  StorageManagerLike,
} from './opfs.js'

export {
  ExtractMode,
  extract,
  extractEntries,
  readArchive,
  readArchiveSync,
  destinationInside,
  questImageFromIni,
} from './archive.js'
export type { ArchiveEntry, ExtractResult, ExtractOptions } from './archive.js'

export { findLocalisedMultimediaFile, questFileResolver } from './multimedia.js'
export type { LocalisationContext } from './multimedia.js'
export { extractStream } from './archive.js'

export { FetchHttpClient, HttpError, NetworkError } from './http.js'
export type { HttpClient, RequestOptions } from './http.js'
export {
  RemoteContentPackManager,
  ListMode,
  manifestUrl,
  CONTENT_PACK_EXTENSION,
  SCENARIO_EXTENSION,
  LOCAL_MANIFEST_NAME,
} from './remote.js'
export type { GameType, RemoteManagerOptions } from './remote.js'

export {
  MIN_VALKYRIE_VERSION,
  SAVE_SLOTS,
  SAVE_INI,
  SAVE_IMAGE,
  SaveError,
  saveFilePath,
  writeSave,
  checkSaveVersion,
  readSaveMetadata,
  listSaves,
  loadSave,
  resolveQuestPath,
  expandPacks,
  parseSaveTime,
  exportSave,
  exportFilename,
  importSave,
  deleteSave,
  saveExists,
} from './save.js'
export type {
  SaveContext,
  SaveMetadata,
  WriteSaveOptions,
  SaveRejection,
  LoadedSave,
  ExportedSave,
} from './save.js'
export { loadConfig, saveConfig, autoSaveConfig } from './configStore.js'

export { AudioEngine, FADE_SECONDS, volumeFromConfig } from './audio.js'
export type {
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  GainNodeLike,
  AudioBufferLike,
  BufferSourceLike,
  AudioOptions,
} from './audio.js'
export { OggStream, buildInfoPacket, buildCommentPacket, VENDOR_STRING } from './ogg.js'
export type { OggPage, OggPacketIn, VorbisInfo } from './ogg.js'

export {
  decodeDds,
  decodeDxt1,
  decodeDxt5,
  decodeUnityTexture,
  flipRows,
  DdsError,
  TextureFormat,
} from './dds.js'
export type { DdsImage } from './dds.js'
export {
  ClassID,
  OBFUSCATE_KEY,
  UnityAssetError,
  deobfuscate,
  looksObfuscated,
  parseUnityVersion,
  readObject,
  readSerializedFile,
  resolveStreamData,
  resourceKey,
} from './unityAssets.js'
export type {
  ObjectInfo,
  SerializedFileInfo,
  StreamingInfo,
  UnityAsset,
  TextureAsset,
  AudioAsset,
  TextAsset,
} from './unityAssets.js'
export {
  importFfgApp,
  CONTENT_CACHE,
  canvasTextureEncoder,
  isLossyFormat,
  LOSSY_QUALITY,
  DATA_DIRECTORY,
} from './ffgImport.js'
export type {
  AssetSource,
  ImportOptions,
  ImportResult,
  TextureEncoder,
  GameId,
} from './ffgImport.js'
export { readFsb, fsbToOgg, fsbSampleToOgg, FsbError, FsbFormat } from './fsb.js'
export type { FsbFile, FsbSample } from './fsb.js'
export {
  isUnityBundle,
  readBundle,
  readBundleHeader,
  UnityBundleError,
  Compression,
} from './unityBundle.js'
export type { BundleHeader, BundleEntry } from './unityBundle.js'
export { decompressLz4Block, Lz4Error } from './lz4.js'

export { TextureCache } from './textures.js'
export type { Crop, Texture, TextureCacheOptions, TextureReader } from './textures.js'

export { loadContent, loadQuest, textureResolver } from './questLoading.js'
export type { ContentOptions, LoadedContent, LoadedQuest } from './questLoading.js'

export {
  CompositeAssetSource,
  PickedDirectorySource,
  canPickDirectory,
  isUnityAsset,
} from './pickedDirectory.js'
export type {
  PickedDirectory,
  PickedEntry,
  PickedFile,
  PickedSourceOptions,
} from './pickedDirectory.js'
