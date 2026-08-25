/**
 * Port of `unity/Assets/Scripts/Audio.cs` onto Web Audio.
 *
 * Two independent channels — a music playlist and one-shot effects — each with
 * its own volume, matching the two `AudioSource` objects the C# creates.
 *
 * Three things Web Audio forces that Unity did not:
 *
 * - an `AudioContext` starts suspended until a user gesture, so playback
 *   requested before then has to be held rather than dropped;
 * - decoding is asynchronous, where `AudioClip` loading was a coroutine;
 * - volume is a gain node, not a property, so a fade is a scheduled ramp
 *   rather than a per-frame subtraction.
 */

import { parseFloatInvariant } from '@valkyrie/core'

import type { FileSystem } from './filesystem.js'

/** The slice of Web Audio this needs, declared structurally so it can be faked. */
export interface AudioContextLike {
  readonly state: 'suspended' | 'running' | 'closed'
  readonly currentTime: number
  readonly destination: AudioNodeLike
  resume(): Promise<void>
  close(): Promise<void>
  createGain(): GainNodeLike
  createBufferSource(): BufferSourceLike
  decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike>
}

export interface AudioNodeLike {
  connect(destination: AudioNodeLike): void
  disconnect(): void
}

export interface AudioParamLike {
  value: number
  cancelScheduledValues(when: number): void
  setValueAtTime(value: number, when: number): void
  linearRampToValueAtTime(value: number, when: number): void
}

export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike
}

export interface AudioBufferLike {
  readonly duration: number
}

export interface BufferSourceLike extends AudioNodeLike {
  buffer: AudioBufferLike | null
  onended: (() => void) | null
  start(when?: number): void
  stop(when?: number): void
}

/** How long `StopMusic` takes to fade out. */
export const FADE_SECONDS = 1

export interface AudioOptions {
  /** Reports a file that could not be read or decoded. Playback continues. */
  onError?: (file: string, error: unknown) => void
}

/**
 * Reads the two volumes out of the user config.
 *
 * DEVIATION: the C# uses `float.TryParse` with the machine culture, so on a
 * locale where the decimal separator is a comma, a stored `0.8` fails to parse
 * and `TryParse` leaves the value at **0** — the app comes up silent with the
 * slider showing 80%. The same bug as the one documented in
 * `ini-port-deviations.md`; parsing is invariant here.
 *
 * An unset value means 1, matching `if (vSet.Length == 0) volume = 1`.
 */
export function volumeFromConfig(value: string): number {
  if (value.length === 0) return 1
  return parseFloatInvariant(value) ?? 0
}

export class AudioEngine {
  private readonly musicGain: GainNodeLike
  private readonly effectGain: GainNodeLike

  private playlist: string[] = []
  private defaultQuestMusic: string[] | null = null
  private index = 0
  private current: BufferSourceLike | null = null
  /** Generation counter, so a superseded playlist cannot advance this one. */
  private generation = 0

  private readonly cache = new Map<string, AudioBufferLike>()
  private readonly onError: ((file: string, error: unknown) => void) | undefined

  constructor(
    private readonly context: AudioContextLike,
    private readonly fs: FileSystem,
    options: AudioOptions = {},
  ) {
    this.onError = options.onError
    this.musicGain = context.createGain()
    this.musicGain.connect(context.destination)
    this.effectGain = context.createGain()
    this.effectGain.connect(context.destination)
  }

  get musicVolume(): number {
    return this.musicGain.gain.value
  }

  set musicVolume(value: number) {
    this.musicGain.gain.value = clamp(value)
  }

  get effectVolume(): number {
    return this.effectGain.gain.value
  }

  set effectVolume(value: number) {
    this.effectGain.gain.value = clamp(value)
  }

  /** Whether the browser is still waiting for a user gesture. */
  get blocked(): boolean {
    return this.context.state === 'suspended'
  }

  /**
   * Starts the audio context. Call from a click or key handler.
   *
   * Playback requested while blocked is held rather than dropped, so a quest
   * that starts music during its opening event is not silent for the rest of
   * the session.
   */
  async unlock(): Promise<void> {
    if (this.context.state === 'suspended') await this.context.resume()
    if (this.current === null && this.playlist.length > 0) this.advance(this.generation)
  }

  /** `PlayMusic(fileNames)`: replaces the playlist and restarts from the top. */
  async playMusic(files: readonly string[]): Promise<void> {
    await this.setPlaylist(files, false)
  }

  /**
   * `PlayDefaultQuestMusic`: the playlist a quest falls back to when whatever
   * an event started has run out.
   */
  async playDefaultQuestMusic(files: readonly string[]): Promise<void> {
    await this.setPlaylist(files, true)
  }

  /** `StopMusic()`: fades out and clears the playlist. */
  stopMusic(): void {
    this.generation++
    this.playlist = []
    this.index = 0
    this.fadeOutAndStop()
  }

  /** `Play(file)`: a one-shot effect. An empty name does nothing. */
  async playEffect(file: string): Promise<void> {
    if (file.length === 0) return

    const buffer = await this.load(file)
    if (buffer === null) return

    const source = this.context.createBufferSource()
    source.buffer = buffer
    source.connect(this.effectGain)
    source.start()
  }

  /** `PlayTrait`: one file chosen at random from those carrying the trait. */
  async playTrait(files: readonly string[], random: () => number = Math.random): Promise<void> {
    if (files.length === 0) return
    const chosen = files[Math.floor(random() * files.length)]
    if (chosen !== undefined) await this.playEffect(chosen)
  }

  /** `StopAudioEffect()`. Effects are one-shot nodes, so this stops the lot. */
  stopEffects(): void {
    this.effectGain.disconnect()
    this.effectGain.connect(this.context.destination)
  }

  async dispose(): Promise<void> {
    this.stopMusic()
    this.cache.clear()
    await this.context.close()
  }

  private async setPlaylist(files: readonly string[], isDefault: boolean): Promise<void> {
    const generation = ++this.generation
    this.playlist = [...files]
    if (isDefault) this.defaultQuestMusic = [...files]
    this.index = 0

    // Warm the cache before switching, so a track change does not gap.
    await Promise.all(this.playlist.map((file) => this.load(file)))
    if (generation !== this.generation) return

    this.fadeOutAndStop()
    if (!this.blocked) this.advance(generation)
  }

  /**
   * Plays the next track.
   *
   * `UpdateMusic` wraps at the end of the list, and swaps in the default quest
   * music if any is set — so event music plays once and then hands back.
   */
  private advance(generation: number, attempts = 0): void {
    if (generation !== this.generation || this.playlist.length === 0) return

    // Every track unreadable would otherwise wrap forever. One pass over the
    // list is enough to know there is nothing to play.
    if (attempts > this.playlist.length) return

    if (this.index >= this.playlist.length) {
      this.index = 0
      if (this.defaultQuestMusic !== null && this.defaultQuestMusic.length > 0) {
        this.playlist = [...this.defaultQuestMusic]
      }
    }

    const file = this.playlist[this.index]
    this.index++
    if (file === undefined) return

    const buffer = this.cache.get(file)
    if (buffer === undefined) {
      // Unreadable track: skip it rather than stopping the playlist.
      this.advance(generation, attempts + 1)
      return
    }

    this.musicGain.gain.cancelScheduledValues(this.context.currentTime)
    this.musicGain.gain.setValueAtTime(this.musicVolume, this.context.currentTime)

    const source = this.context.createBufferSource()
    source.buffer = buffer
    source.connect(this.musicGain)
    source.onended = () => {
      if (this.current === source) this.current = null
      this.advance(generation)
    }
    source.start()
    this.current = source
  }

  private fadeOutAndStop(): void {
    const source = this.current
    if (source === null) return
    this.current = null
    source.onended = null

    const now = this.context.currentTime
    const gain = this.musicGain.gain
    gain.cancelScheduledValues(now)
    gain.setValueAtTime(gain.value, now)
    gain.linearRampToValueAtTime(0, now + FADE_SECONDS)
    source.stop(now + FADE_SECONDS)
  }

  /** Reads and decodes a file, remembering both successes and failures. */
  private async load(file: string): Promise<AudioBufferLike | null> {
    const cached = this.cache.get(file)
    if (cached !== undefined) return cached

    try {
      const bytes = await this.fs.readBytes(file)
      const copy = new Uint8Array(bytes)
      const buffer = await this.context.decodeAudioData(copy.buffer)
      this.cache.set(file, buffer)
      return buffer
    } catch (error) {
      this.onError?.(file, error)
      return null
    }
  }
}

function clamp(value: number): number {
  if (Number.isNaN(value)) return 0
  return Math.min(Math.max(value, 0), 1)
}
