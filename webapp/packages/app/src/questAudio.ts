/**
 * Turning a quest's audio requests into files, and playing them.
 *
 * `EventManager.cs:187` resolves a name through the content `Audio` sections
 * and falls back to a file beside the quest; `Audio.PlayTrait` instead gathers
 * every sound carrying a trait and picks one. Both end at the same engine,
 * which is why the engine takes files and this takes names.
 *
 * Autoplay is the one thing with no counterpart in the C#. A browser will not
 * start an audio context without a gesture, and a quest asks for its opening
 * music before the player has made one — so requests made while blocked are
 * held by the engine and released on the first click.
 */

import type { AudioRequest, ContentData } from '@valkyrie/core'
import { AudioData } from '@valkyrie/core'
import type { AudioEngine } from '@valkyrie/platform'

export interface QuestAudioOptions {
  engine: AudioEngine
  content: ContentData
  /** Resolves a name to a file that exists, as the texture resolver does. */
  resolveFile: (name: string) => string | null
  /** Injected so a test can pin the draw. */
  random?: () => number
}

/**
 * `Quest.cs:750`: every `Audio` carrying the `quest` trait, which is what
 * plays when nothing else has set a playlist.
 */
export function defaultQuestMusic(
  content: ContentData,
  resolveFile: (name: string) => string | null,
): string[] {
  const files: string[] = []
  for (const [, audio] of content.getAll(AudioData)) {
    if (!audio.traits.includes('quest')) continue
    const file = resolveFile(audio.file)
    if (file !== null) files.push(file)
  }
  return files
}

/**
 * Handles one request.
 *
 * Every path returns quietly when nothing resolves. A scenario naming a sound
 * the player does not have should be silent, not broken — the C# passes the
 * unresolved name to `Play`, which ignores what it cannot load.
 */
export function questAudio(options: QuestAudioOptions): (request: AudioRequest) => void {
  const { engine, content, resolveFile } = options

  /** `TryGet(name)` first, then the name as a file beside the quest. */
  const fileFor = (name: string): string | null => {
    const declared = content.tryGet(AudioData, name)
    return resolveFile(declared?.file ?? name)
  }

  return (request) => {
    if (request.kind === 'effect') {
      const file = fileFor(request.name)
      if (file !== null) void engine.playEffect(file)
      return
    }

    if (request.kind === 'trait') {
      // `PlayTrait` walks every Audio section rather than an index; there are
      // a few hundred, and this runs once a round at most.
      const carrying: string[] = []
      for (const [, audio] of content.getAll(AudioData)) {
        if (!audio.traits.includes(request.trait)) continue
        const file = resolveFile(audio.file)
        if (file !== null) carrying.push(file)
      }
      void engine.playTrait(carrying, options.random)
      return
    }

    const files: string[] = []
    for (const name of request.names) {
      const file = fileFor(name)
      if (file !== null) files.push(file)
    }
    // An empty list would stop the music rather than leave it, and a scenario
    // naming tracks the player does not have meant to keep playing.
    if (files.length > 0) void engine.playMusic(files)
  }
}
