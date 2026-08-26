/**
 * Tests for turning a quest's audio requests into files.
 *
 * `Play(name)` and `PlayTrait(trait)` resolve differently — one names a sound,
 * the other gathers every sound carrying a category and picks one — and a name
 * that resolves to nothing has to stay silent rather than throw, because a
 * scenario may name audio the player does not have.
 */

import { describe, expect, it, vi } from 'vitest'

import { ContentData, ContentLoader, headlessContext, readFromString } from '@valkyrie/core'
import { defaultQuestMusic, questAudio } from '../src/questAudio.js'

const CONTENT = `[AudioDoorCreak1]
file="audio/DoorCreak_01.ogg"
traits=explore

[AudioDoorCreak2]
file="audio/DoorCreak_02.ogg"
traits=explore

[AudioTheme]
file="audio/Theme.ogg"
traits=quest

[AudioMissing]
file="audio/Absent.ogg"
traits=explore
`

function engine() {
  return {
    playEffect: vi.fn(async () => {}),
    playTrait: vi.fn(async () => {}),
    playMusic: vi.fn(async () => {}),
    playDefaultQuestMusic: vi.fn(async () => {}),
  }
}

function content(ini = CONTENT): ContentData {
  const context = headlessContext({ resolveTextureFile: () => null, tilePixelPerSquare: 100 })
  const data = new ContentData(context)
  new ContentLoader(data, context).loadIni(readFromString(ini), '/pack', 'pack')
  return data
}

/** Everything resolves but the one file that is deliberately absent. */
const resolveFile = (name: string): string | null =>
  name.includes('Absent') || name.length === 0 ? null : name

function handler(over: { random?: () => number } = {}) {
  const audio = engine()
  const play = questAudio({
    engine: audio as never,
    content: content(),
    resolveFile,
    ...(over.random === undefined ? {} : { random: over.random }),
  })
  return { audio, play }
}

describe('questAudio', () => {
  it('plays the file an Audio section names', () => {
    const { audio, play } = handler()

    play({ kind: 'effect', name: 'AudioDoorCreak1' })

    expect(audio.playEffect).toHaveBeenCalledWith('/pack/audio/DoorCreak_01.ogg')
  })

  it('falls back to the name as a file when no section matches', () => {
    // `EventManager.cs:191` treats an unmatched name as a file beside the
    // quest, which is how a scenario ships a sound of its own.
    const { audio, play } = handler()

    play({ kind: 'effect', name: 'audio/OwnSound.ogg' })

    expect(audio.playEffect).toHaveBeenCalledWith('audio/OwnSound.ogg')
  })

  it('stays silent for a sound the player does not have', () => {
    const { audio, play } = handler()

    play({ kind: 'effect', name: 'AudioMissing' })

    expect(audio.playEffect).not.toHaveBeenCalled()
  })

  it('gathers every sound carrying a trait and lets the engine choose', () => {
    const { audio, play } = handler()

    play({ kind: 'trait', trait: 'explore' })

    // The absent one is left out; the two that resolve are offered.
    expect(audio.playTrait).toHaveBeenCalledWith(
      ['/pack/audio/DoorCreak_01.ogg', '/pack/audio/DoorCreak_02.ogg'],
      undefined,
    )
  })

  it('offers nothing for a trait no sound carries', () => {
    const { audio, play } = handler()

    play({ kind: 'trait', trait: 'nothing' })

    expect(audio.playTrait).toHaveBeenCalledWith([], undefined)
  })

  it('sets a playlist from the names an event gave', () => {
    const { audio, play } = handler()

    play({ kind: 'music', names: ['AudioTheme', 'AudioDoorCreak1'] })

    expect(audio.playMusic).toHaveBeenCalledWith([
      '/pack/audio/Theme.ogg',
      '/pack/audio/DoorCreak_01.ogg',
    ])
  })

  it('leaves the music alone when none of the tracks resolve', () => {
    // Replacing the playlist with nothing would stop the music, and a
    // scenario naming tracks the player lacks meant it to keep playing.
    const { audio, play } = handler()

    play({ kind: 'music', names: ['AudioMissing'] })

    expect(audio.playMusic).not.toHaveBeenCalled()
  })
})

describe('defaultQuestMusic', () => {
  it('is every sound carrying the quest trait', () => {
    expect(defaultQuestMusic(content(), resolveFile)).toEqual(['/pack/audio/Theme.ogg'])
  })
})
