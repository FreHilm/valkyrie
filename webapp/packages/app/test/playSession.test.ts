/**
 * @vitest-environment happy-dom
 *
 * The play screen driven by a real QuestSession (T-018).
 *
 * Everything below this is unit-tested and everything above is DOM-tested, but
 * nothing else runs the two together — and the seams are where this port keeps
 * finding bugs. A quest is parsed from ini here, not faked.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { bundleQuest, loadQuestSections, QuestSession, readFromString } from '@valkyrie/core'
import { playScreen } from '@valkyrie/ui'
import type { SceneSources } from '@valkyrie/ui'

beforeEach(() => {
  document.body.replaceChildren()
  HTMLCanvasElement.prototype.getContext = (() => null) as never
})

const SOURCES: SceneSources = {
  tile: () => null,
  token: () => ({ image: 'img/sheet', width: 1, height: 1 }),
  monster: () => null,
  onGrid: false,
}

const QUEST = `[EventStart1]
trigger=EventStart
display=false
buttons=1
event1=EventIntro
[EventIntro]
buttons=2
event1=EventOpen
event2=
add=TileHall TokenDoor
[EventOpen]
buttons=1
event1=
add=TokenInner
remove=TokenDoor
[TokenDoor]
buttons=1
event1=EventOpen
[TokenInner]
[TileHall]
side=TileSideHall
`

function start() {
  const components = loadQuestSections(readFromString(QUEST), 'test.ini', {})
  const session = new QuestSession({
    bundle: bundleQuest(components),
    components,
    random: () => 0,
  })
  session.runtime.heroes.push({ heroName: 'HeroAshcanPete', activated: false })
  session.start()
  const screen = playScreen({ session, sources: SOURCES })
  document.body.append(screen.element)
  return { session, screen }
}

/**
 * The buttons a dialog or the controls offer — not the board's own.
 *
 * The board mirrors its pieces into an off-screen list of real buttons so a
 * keyboard can reach a door. Anything asking about dialogs has to say it means
 * those, or it counts the board as well.
 */
const buttons = (root: HTMLElement): HTMLButtonElement[] =>
  [...root.querySelectorAll<HTMLButtonElement>('button')].filter(
    (b) => b.closest('.vk-board__pieces') === null,
  )
const press = (root: HTMLElement, name: string): void => {
  const target = buttons(root).find((b) => b.textContent?.includes(name))
  if (target === undefined) throw new Error(`no button matching ${name}`)
  target.click()
}

describe('the play screen driving a real session', () => {
  it('runs the invisible opening event and shows the first real one', () => {
    // EventStart1 is display=false glue; the player should never see it.
    const { screen } = start()

    // The event's own buttons, not the phase bar's arrow beside them.
    expect(screen.element.querySelectorAll('.vk-play__overlay button')).toHaveLength(2)
  })

  it('falls back to the raw key when no translation is registered', () => {
    // Worth pinning: a quest loaded without its Localization.*.txt shows
    // {qst:...} keys to the player rather than failing, which is what the C#
    // does too — and is how a missing translation is meant to be visible.
    const { screen } = start()

    expect(buttons(screen.element)[0]?.textContent).toBe('{qst:EventIntro.button1}')
  })

  it('applies an event’s board changes when the event runs, not when it is answered', () => {
    // EventManager.cs:219 performs operations and adds components as the event
    // is presented. The player sees the board already changed behind the text.
    const { session, screen } = start()

    expect(session.runtime.boardItems().map((i) => i.name)).toEqual(['TileHall', 'TokenDoor'])

    // The first button chains to EventOpen, which swaps the door for the room.
    buttons(screen.element)[0]?.click()

    expect(session.runtime.boardItems().map((i) => i.name)).toEqual(['TileHall', 'TokenInner'])
  })

  it('returns to the board once the events run out', () => {
    const { screen } = start()
    buttons(screen.element)[0]?.click()
    buttons(screen.element)[0]?.click()

    // One arrow, as `NextStageButton` draws it, with the phase named beside it.
    expect(buttons(screen.element).map((b) => b.textContent)).toEqual(['➤'])
    expect(screen.element.querySelector('.vk-play__phase-name')?.textContent).toBe(
      'Investigator Phase',
    )
  })

  it('fires a token’s event when the player clicks it on the board', () => {
    const { session, screen } = start()
    // Answer the intro with the button that ends the chain, leaving the door.
    buttons(screen.element)[1]?.click()

    expect(session.runtime.boardItems().map((i) => i.name)).toEqual(['TileHall', 'TokenDoor'])

    // Clicking it is what the board's onSelect does: it opens the token's own
    // event, which the player then answers. The board does not change until
    // they do.
    session.activate('TokenDoor')
    screen.refresh()
    expect(session.runtime.boardItems().map((i) => i.name)).toEqual(['TileHall', 'TokenDoor'])

    buttons(screen.element)[0]?.click()

    expect(session.runtime.boardItems().map((i) => i.name)).toEqual(['TileHall', 'TokenInner'])
  })

  it('moves into the mythos phase when the turn ends', () => {
    const { session, screen } = start()
    buttons(screen.element)[0]?.click()
    buttons(screen.element)[0]?.click()
    const before = session.runtime.vars.getValue('#round')
    press(screen.element, '➤')

    // This scenario's mythos has nothing to add, so the round turns over
    // rather than resting there — `HeroActivated` ends by asking for a new
    // round, and the C# says so where it does it.
    expect(session.runtime.vars.getValue('#round')).toBe(before + 1)
    expect(session.rounds.phase).toBe('investigator')
  })

  it('writes what happened into the quest log', () => {
    const { session, screen } = start()
    buttons(screen.element)[0]?.click()
    buttons(screen.element)[0]?.click()
    // One arrow carries the whole round: investigators to mythos, mythos on
    // through the monster step, and horror turns the round over. A phase
    // transition puts a dialog up in between, which is answered as it comes.
    // One arrow carries the whole round. With no mythos events and no
    // monsters it turns straight over, which is what `ROUND` records.
    press(screen.element, '➤')

    expect(session.runtime.vars.getValue('#round')).toBe(1)
    expect(session.runtime.log.toArray().some((e) => e.entry.includes('ROUND'))).toBe(true)
  })
})
