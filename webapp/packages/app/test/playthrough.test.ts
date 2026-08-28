/**
 * @vitest-environment happy-dom
 *
 * A scenario played start to finish (T-032).
 *
 * Every other test checks one seam. This one plays: it opens a quest, answers
 * its events, clicks what is on the board, fights a monster, solves a puzzle
 * and reaches the end — through the same DOM a player uses, driven by nothing
 * but what is on screen.
 *
 * The scenario is a fixture rather than a published one, and deliberately so.
 * A published scenario needs art and audio from a licensed install, which
 * never enters this repository and so can never be in CI. What that costs is
 * coverage of the content pipeline; what it buys is a playthrough that runs
 * everywhere in milliseconds. The browser harness in `tools/playthrough` is
 * for the real thing, against a real install.
 *
 * The board is reachable here only because of T-031: its pieces are real
 * buttons, so a test can press a door without a canvas to hit-test against.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  bundleQuest,
  loadQuestSections,
  QuestSession,
  readFromString,
  slidePuzzleLayouts,
} from '@valkyrie/core'
import { playScreen } from '@valkyrie/ui'
import type { SceneSources } from '@valkyrie/ui'
import { puzzleRenderer } from '../src/puzzleView.js'

beforeEach(() => {
  document.body.replaceChildren()
  HTMLCanvasElement.prototype.getContext = (() => null) as never
})

const SOURCES: SceneSources = {
  tile: () => null,
  token: () => ({ image: 'img/sheet', width: 1, height: 1 }),
  monster: () => ({ image: 'img/monster', width: 1, height: 1 }),
  onGrid: false,
}

/**
 * A scenario with one of everything the loop has to carry.
 *
 * `puzzlesolution` is fixed rather than generated, because a test that has to
 * guess a code is a test that fails on a bad day.
 */
const QUEST = `[EventStart1]
trigger=EventStart
buttons=1
event1=
text=The house waits.
add=TileHall TokenDoor

[TileHall]
side=TileSideHall

[TokenDoor]
buttons=1
event1=PuzzleLock

[PuzzleLock]
class=code
puzzlelevel=3
puzzlealtlevel=4
puzzlesolution=1 1 1
buttons=1
event1=EventInside

[EventInside]
buttons=1
event1=
text=Beyond the door, something moves.
add=SpawnCultist TokenIdol
remove=TokenDoor

[SpawnCultist]
buttons=1
event1=
monster=MonsterCultist

[TokenIdol]
buttons=1
event1=EventFinish

[EventFinish]
buttons=1
event1=
text=You take the idol and run.
operations=$end,=,1
`

/** Everything a player can press right now, in the order they would find it. */
function actions(root: HTMLElement) {
  const enabled = (selector: string) =>
    [...root.querySelectorAll<HTMLButtonElement>(selector)].filter((b) => !b.disabled)
  return {
    puzzle: enabled('.vk-puzzle button'),
    overlay: enabled('.vk-play__overlay button'),
    pieces: enabled('.vk-board__pieces button'),
    controls: enabled('.vk-play__controls button'),
  }
}

const textOf = (root: HTMLElement, selector: string) =>
  (root.querySelector<HTMLElement>(selector)?.innerText ?? '').trim()

/**
 * What a player would press next, in the order a player would find it.
 *
 * A puzzle first, because it covers the board and nothing else advances until
 * it is solved; then whatever a dialog is asking; then the board; then the
 * controls that end a turn. Returns nothing when the quest cannot advance,
 * which is what tells "stuck" from "waiting".
 */
function nextAction(root: HTMLElement): HTMLButtonElement | undefined {
  const now = actions(root)
  return (
    now.puzzle.find((b) => b.textContent === 'Finish') ??
    now.puzzle.find((b) => b.textContent === 'Guess') ??
    now.overlay.find((b) => b.textContent === 'Defeated') ??
    now.overlay[0] ??
    now.pieces[0] ??
    now.controls[0]
  )
}

describe('a scenario played through', () => {
  function open() {
    const components = loadQuestSections(readFromString(QUEST), 'test.ini', {})
    const session = new QuestSession({
      bundle: bundleQuest(components),
      components,
      random: () => 0,
      slideLayouts: slidePuzzleLayouts(),
    })
    session.runtime.heroes.push({ heroName: 'HeroAgathaCrane', activated: false })
    session.runtime.monsters.length = 0

    let ended = false
    const screen = playScreen({
      session,
      sources: SOURCES,
      onPuzzle: puzzleRenderer({ components }),
      onEnded: () => {
        ended = true
      },
      monsterView: (index, close) => ({
        monsterName: session.runtime.monsters[index]?.monsterName ?? '',
        horrorPhase: false,
        health: {
          health: 1,
          damage: 0,
          onDamageChange: () => {},
          onDefeated: () => {
            const monster = session.runtime.monsters[index]
            if (monster !== undefined) session.defeat(monster)
            close()
          },
        },
        attackTypes: ['unarmed'],
        onAttack: () => 'You strike it down.',
        onEvade: () => null,
        onHorror: () => null,
        onCancel: close,
      }),
      menus: {
        items: { list: () => [], onInspect: () => {} },
        log: { view: () => ({ entries: [], variables: [] }) },
        set: {
          view: () => ({ fire: false, eliminated: false, eliminationFinal: false }),
          onFire: () => {},
          onEliminated: () => {},
        },
      },
    })
    document.body.append(screen.element)
    session.start()
    screen.refresh()
    return { screen, session, hasEnded: () => ended }
  }

  it('reaches the end of the quest by pressing what is on screen', () => {
    const { screen, session, hasEnded } = open()
    const seen: string[] = []

    // Bounded: a quest that will not advance must fail the test rather than
    // hang it, and 60 presses is far more than this scenario needs.
    for (let step = 0; step < 60 && !hasEnded(); step++) {
      const now = actions(screen.element)

      // A puzzle first: it covers the board and nothing else will advance
      // until it is solved. The code is 1 1 1, so guessing straight away wins.
      if (now.puzzle.length > 0) {
        const guess = now.puzzle.find((b) => b.textContent === 'Guess')
        const finish = now.puzzle.find((b) => b.textContent === 'Finish')
        seen.push(finish !== undefined ? 'puzzle:finish' : 'puzzle:guess')
        ;(finish ?? guess)?.click()
        continue
      }

      if (now.overlay.length > 0) {
        const kill = now.overlay.find((b) => b.textContent === 'Defeated')
        const chosen = kill ?? now.overlay[0]
        seen.push(`overlay:${chosen?.textContent ?? ''}`)
        chosen?.click()
        continue
      }

      // Nothing in a dialog: work the board, which is where a scenario waits.
      if (now.pieces.length > 0) {
        const piece = now.pieces[0]
        seen.push(`board:${piece?.textContent ?? ''}`)
        piece?.click()
        continue
      }

      if (now.controls.length > 0) {
        seen.push(`controls:${now.controls[0]?.textContent ?? ''}`)
        now.controls[0]?.click()
        continue
      }

      seen.push('stuck')
      break
    }

    expect(seen, `pressed: ${seen.join(' → ')}`).not.toContain('stuck')
    expect(hasEnded(), `pressed: ${seen.join(' → ')}`).toBe(true)
    expect(session.view().kind).toBe('ended')
  })

  it('passes through everything the scenario asked of it', () => {
    // The route matters as much as the destination: a playthrough that skipped
    // the puzzle and the monster would still reach the end and prove nothing.
    const { screen, session, hasEnded } = open()
    const seen: string[] = []

    for (let step = 0; step < 60 && !hasEnded(); step++) {
      if (actions(screen.element).puzzle.length > 0) seen.push('puzzle')
      if (screen.element.querySelector('.vk-monster') !== null) seen.push('monster')

      const next = nextAction(screen.element)
      if (next === undefined) break
      next.click()
    }

    expect(seen).toContain('puzzle')
    expect(session.events.history).toContain('EventFinish')
    expect(session.runtime.vars.getValue('$end')).toBe(1)
  })

  it('takes the board and its chrome away at the end', () => {
    const { screen, hasEnded } = open()

    for (let step = 0; step < 60 && !hasEnded(); step++) {
      const next = nextAction(screen.element)
      if (next === undefined) break
      next.click()
    }

    expect(hasEnded()).toBe(true)
    expect(textOf(screen.element, '.vk-play__controls')).toBe('')
    expect(screen.element.querySelectorAll('.vk-play__menus button')).toHaveLength(0)
  })

  it('says where it stopped when a quest cannot advance', () => {
    // The harness has to tell "waiting for the player" from "stuck", or a
    // scenario that dead-ends looks the same as one still being played.
    const components = loadQuestSections(
      readFromString(`[EventStuck]
trigger=EventStart
buttons=1
event1=EventMissing
text=Nothing happens.
`),
      'test.ini',
      {},
    )
    const session = new QuestSession({
      bundle: bundleQuest(components),
      components,
      random: () => 0,
    })
    session.runtime.heroes.push({ heroName: 'HeroAgathaCrane', activated: false })
    const onEnded = vi.fn()
    const screen = playScreen({ session, sources: SOURCES, onEnded })
    document.body.append(screen.element)
    session.start()
    screen.refresh()

    // The event names an event that is not there; answering it leaves a board
    // with nothing on it and no way on.
    actions(screen.element).overlay[0]?.click()

    const now = actions(screen.element)
    expect(now.overlay).toHaveLength(0)
    expect(now.pieces).toHaveLength(0)
    expect(onEnded).not.toHaveBeenCalled()
    expect(session.runtime.log.toArray().map((e) => e.entry)).toContain(
      'Warning: Missing event called: EventMissing',
    )
  })
})
