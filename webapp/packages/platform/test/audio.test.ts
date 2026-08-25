/**
 * Tests for the Web Audio port (T-020).
 *
 * `Audio.cs` has no tests — it is a MonoBehaviour driven by FixedUpdate. What
 * is pinned here is the playlist behaviour, the volume handling including the
 * locale bug the C# has, and the autoplay gate Web Audio adds.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { AudioEngine, FADE_SECONDS, volumeFromConfig } from '../src/audio.js'
import { MemoryFileSystem } from '../src/filesystem.js'
import { FakeAudioContext } from './fakeAudio.js'

let fs: MemoryFileSystem

beforeEach(async () => {
  fs = new MemoryFileSystem()
  for (const [name, size] of [
    ['/audio/a.ogg', 10],
    ['/audio/b.ogg', 20],
    ['/audio/c.ogg', 30],
    ['/audio/effect.ogg', 40],
  ] as const) {
    await fs.writeBytes(name, new Uint8Array(size))
  }
})

async function running(
  undecodable = new Set<number>(),
): Promise<{ engine: AudioEngine; context: FakeAudioContext }> {
  const context = new FakeAudioContext(undecodable)
  const engine = new AudioEngine(context, fs)
  await engine.unlock()
  return { engine, context }
}

describe('volumeFromConfig', () => {
  it('reads an unset value as full volume', () => {
    expect(volumeFromConfig('')).toBe(1)
  })

  it.each([
    ['1', 1],
    ['0', 0],
    ['0.25', 0.25],
  ])('reads %s as %s', (input, expected) => {
    expect(volumeFromConfig(input)).toBe(expected)
  })

  // Volume is a C# `float`, so 0.8 really is 0.800000011920929 there too.
  // The port keeps float32 precision rather than quietly widening it.
  it('keeps float32 precision, as the C# float does', () => {
    expect(volumeFromConfig('0.8')).toBe(Math.fround(0.8))
    expect(volumeFromConfig('0.8')).toBeCloseTo(0.8, 6)
  })

  // float.TryParse with a comma locale fails on "0.8" and leaves 0, so the app
  // comes up silent with the slider showing 80%.
  it('parses invariantly, where the C# is locale-dependent (DEVIATION)', () => {
    expect(volumeFromConfig('0.8')).toBeGreaterThan(0)
  })

  it('reads an unparsable value as 0, as TryParse leaves it', () => {
    expect(volumeFromConfig('loud')).toBe(0)
  })
})

describe('the autoplay gate', () => {
  it('starts blocked, because a context begins suspended', () => {
    const engine = new AudioEngine(new FakeAudioContext(), fs)

    expect(engine.blocked).toBe(true)
  })

  it('holds music requested before the gesture rather than dropping it', async () => {
    const context = new FakeAudioContext()
    const engine = new AudioEngine(context, fs)

    await engine.playMusic(['/audio/a.ogg'])
    expect(context.musicSources()).toHaveLength(0)

    await engine.unlock()
    expect(context.musicSources()).toHaveLength(1)
    expect(engine.blocked).toBe(false)
  })

  it('does not restart music that is already playing when unlocked again', async () => {
    const { engine, context } = await running()
    await engine.playMusic(['/audio/a.ogg'])

    await engine.unlock()

    expect(context.musicSources()).toHaveLength(1)
  })
})

describe('music playlist', () => {
  it('plays the first track and advances when it ends', async () => {
    const { engine, context } = await running()
    await engine.playMusic(['/audio/a.ogg', '/audio/b.ogg'])

    expect(context.musicSources()).toHaveLength(1)
    context.musicSources()[0]?.finish()

    expect(context.musicSources()).toHaveLength(2)
  })

  it('wraps to the start of the playlist', async () => {
    const { engine, context } = await running()
    await engine.playMusic(['/audio/a.ogg'])

    context.musicSources()[0]?.finish()

    expect(context.musicSources()).toHaveLength(2)
  })

  // The C# swaps the list for defaultQuestMusic once the current one runs out.
  it('falls back to the default quest music after event music finishes', async () => {
    const { engine, context } = await running()
    await engine.playDefaultQuestMusic(['/audio/c.ogg'])
    await engine.playMusic(['/audio/a.ogg'])

    const eventTrack = context.musicSources().at(-1)
    eventTrack?.finish()

    // Sizes stand in for identity: c.ogg is 30 bytes.
    expect(context.musicSources().at(-1)?.buffer?.duration).toBe(30 / 1000)
  })

  it('skips a track that cannot be decoded instead of stopping', async () => {
    const { engine, context } = await running(new Set([10]))
    await engine.playMusic(['/audio/a.ogg', '/audio/b.ogg'])

    expect(context.musicSources()).toHaveLength(1)
    expect(context.musicSources()[0]?.buffer?.duration).toBe(20 / 1000)
  })

  it('reports a file it could not read', async () => {
    const context = new FakeAudioContext()
    const errors: string[] = []
    const engine = new AudioEngine(context, fs, { onError: (file) => errors.push(file) })
    await engine.unlock()

    await engine.playMusic(['/audio/missing.ogg'])

    expect(errors).toEqual(['/audio/missing.ogg'])
    expect(context.musicSources()).toHaveLength(0)
  })

  // A playlist where nothing is readable used to wrap forever and blow the
  // stack, taking the tab with it.
  it('gives up rather than looping when no track is playable', async () => {
    const { engine, context } = await running(new Set([10, 20]))

    await engine.playMusic(['/audio/a.ogg', '/audio/b.ogg'])

    expect(context.musicSources()).toHaveLength(0)
  })

  it('decodes each file once, however often it is played', async () => {
    const { engine, context } = await running()
    await engine.playMusic(['/audio/a.ogg'])
    await engine.playMusic(['/audio/a.ogg'])

    expect(context.decoded).toEqual([10])
  })

  it('does not let a replaced playlist advance the new one', async () => {
    const { engine, context } = await running()
    await engine.playMusic(['/audio/a.ogg', '/audio/b.ogg'])
    const stale = context.musicSources()[0]

    await engine.playMusic(['/audio/c.ogg'])
    const before = context.musicSources().length
    stale?.finish()

    expect(context.musicSources()).toHaveLength(before)
  })
})

describe('stopMusic', () => {
  it('fades out over a second rather than cutting', async () => {
    const { engine, context } = await running()
    await engine.playMusic(['/audio/a.ogg'])
    context.currentTime = 5

    engine.stopMusic()

    const musicGain = context.gains[0]
    expect(musicGain?.gain.ramps).toEqual([{ to: 0, when: 5 + FADE_SECONDS }])
    expect(context.musicSources()[0]?.stoppedAt).toBe(5 + FADE_SECONDS)
  })

  it('leaves nothing to advance to', async () => {
    const { engine, context } = await running()
    await engine.playMusic(['/audio/a.ogg'])
    const source = context.musicSources()[0]

    engine.stopMusic()
    source?.finish()

    expect(context.musicSources()).toHaveLength(1)
  })
})

describe('effects', () => {
  it('plays a one-shot on the effect channel', async () => {
    const { engine, context } = await running()
    await engine.playEffect('/audio/effect.ogg')

    expect(context.effectSources()).toHaveLength(1)
    expect(context.effectSources()[0]?.started).toBe(true)
  })

  it('ignores an empty file name, as the C# length check does', async () => {
    const { engine, context } = await running()
    await engine.playEffect('')

    expect(context.effectSources()).toHaveLength(0)
  })

  it('picks one file at random for a trait', async () => {
    const { engine, context } = await running()
    await engine.playTrait(['/audio/a.ogg', '/audio/b.ogg', '/audio/c.ogg'], () => 0.5)

    expect(context.effectSources()).toHaveLength(1)
    expect(context.effectSources()[0]?.buffer?.duration).toBe(20 / 1000)
  })

  it('does nothing when no file carries the trait', async () => {
    const { engine, context } = await running()
    await engine.playTrait([])

    expect(context.effectSources()).toHaveLength(0)
  })

  it('effects and music keep independent volumes', async () => {
    const { engine } = await running()
    engine.musicVolume = 0.25
    engine.effectVolume = 0.75

    expect(engine.musicVolume).toBe(0.25)
    expect(engine.effectVolume).toBe(0.75)
  })

  it.each([
    [-1, 0],
    [2, 1],
    [Number.NaN, 0],
  ])('clamps a volume of %s to %s', async (input, expected) => {
    const { engine } = await running()
    engine.musicVolume = input

    expect(engine.musicVolume).toBe(expected)
  })
})
