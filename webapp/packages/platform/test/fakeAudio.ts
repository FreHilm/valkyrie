/**
 * A fake Web Audio API, good enough to exercise `AudioEngine`.
 *
 * There is no `AudioContext` in Node, so without this the audio engine would
 * ship untested. This models the suspended/running gesture gate, gain values,
 * buffer sources with an `onended` hook the test can fire, and a decoder that
 * rejects anything not marked as valid.
 */

import type {
  AudioBufferLike,
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  BufferSourceLike,
  GainNodeLike,
} from '../src/audio.js'

class FakeParam implements AudioParamLike {
  value = 1
  readonly ramps: { to: number; when: number }[] = []

  cancelScheduledValues(): void {
    this.ramps.length = 0
  }

  setValueAtTime(value: number): void {
    this.value = value
  }

  linearRampToValueAtTime(value: number, when: number): void {
    this.ramps.push({ to: value, when })
  }
}

class FakeGain implements GainNodeLike {
  readonly gain = new FakeParam()
  connected: AudioNodeLike | null = null

  connect(destination: AudioNodeLike): void {
    this.connected = destination
  }

  disconnect(): void {
    this.connected = null
  }
}

export class FakeSource implements BufferSourceLike {
  buffer: AudioBufferLike | null = null
  onended: (() => void) | null = null
  started = false
  stoppedAt: number | null = null
  connected: AudioNodeLike | null = null

  connect(destination: AudioNodeLike): void {
    this.connected = destination
  }

  disconnect(): void {
    this.connected = null
  }

  start(): void {
    this.started = true
  }

  stop(when = 0): void {
    this.stoppedAt = when
  }

  /** Fires the ended hook, as the browser would when a track finishes. */
  finish(): void {
    this.onended?.()
  }
}

export class FakeAudioContext implements AudioContextLike {
  state: 'suspended' | 'running' | 'closed' = 'suspended'
  currentTime = 0
  readonly destination: AudioNodeLike = { connect: () => {}, disconnect: () => {} }
  readonly sources: FakeSource[] = []
  readonly gains: FakeGain[] = []
  readonly decoded: number[] = []

  /** Byte lengths this decoder refuses, so a decode failure can be tested. */
  constructor(private readonly undecodable: Set<number> = new Set()) {}

  async resume(): Promise<void> {
    this.state = 'running'
  }

  async close(): Promise<void> {
    this.state = 'closed'
  }

  createGain(): GainNodeLike {
    const gain = new FakeGain()
    this.gains.push(gain)
    return gain
  }

  createBufferSource(): BufferSourceLike {
    const source = new FakeSource()
    this.sources.push(source)
    return source
  }

  async decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike> {
    if (this.undecodable.has(data.byteLength)) throw new Error('EncodingError')
    this.decoded.push(data.byteLength)
    return { duration: data.byteLength / 1000 }
  }

  /** The sources connected to the music gain, in creation order. */
  musicSources(): FakeSource[] {
    const musicGain = this.gains[0]
    return this.sources.filter((source) => source.connected === musicGain)
  }

  effectSources(): FakeSource[] {
    const effectGain = this.gains[1]
    return this.sources.filter((source) => source.connected === effectGain)
  }
}
