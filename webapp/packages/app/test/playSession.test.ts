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
add=TokenDoor
[EventOpen]
buttons=1
event1=
add=TokenInner
remove=TokenDoor
[TokenDoor]
buttons=1
event1=EventOpen
[TokenInner]
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

const buttons = (root: HTMLElement): HTMLButtonElement[] => [...root.querySelectorAll('button')]
const press = (root: HTMLElement, name: string): void => {
  const target = buttons(root).find((b) => b.textContent?.includes(name))
  if (target === undefined) throw new Error(`no button matching ${name}`)
  target.click()
}

describe('the play screen driving a real session', () => {
  it('runs the invisible opening event and shows the first real one', () => {
    // EventStart1 is display=false glue; the player should never see it.
    const { screen } = start()

    expect(buttons(screen.element)).toHaveLength(2)
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

    expect(session.runtime.boardItems().map((i) => i.name)).toEqual(['TokenDoor'])

    // The first button chains to EventOpen, which swaps the door for the room.
    buttons(screen.element)[0]?.click()

    expect(session.runtime.boardItems().map((i) => i.name)).toEqual(['TokenInner'])
  })

  it('returns to the board once the events run out', () => {
    const { screen } = start()
    buttons(screen.element)[0]?.click()
    buttons(screen.element)[0]?.click()

    expect(buttons(screen.element).map((b) => b.textContent)).toEqual([
      'End investigator turn',
      'Finish the phase',
    ])
  })

  it('fires a token’s event when the player clicks it on the board', () => {
    const { session, screen } = start()
    // Answer the intro with the button that ends the chain, leaving the door.
    buttons(screen.element)[1]?.click()

    expect(session.runtime.boardItems().map((i) => i.name)).toEqual(['TokenDoor'])

    // Clicking it is what the board's onSelect does: it opens the token's own
    // event, which the player then answers. The board does not change until
    // they do.
    session.activate('TokenDoor')
    screen.refresh()
    expect(session.runtime.boardItems().map((i) => i.name)).toEqual(['TokenDoor'])

    buttons(screen.element)[0]?.click()

    expect(session.runtime.boardItems().map((i) => i.name)).toEqual(['TokenInner'])
  })

  it('moves into the mythos phase when the turn ends', () => {
    const { session, screen } = start()
    buttons(screen.element)[0]?.click()
    buttons(screen.element)[0]?.click()
    press(screen.element, 'End investigator turn')

    expect(session.rounds.phase).toBe('mythos')
    expect(screen.element.textContent).toContain('mythos')
  })

  it('writes what happened into the quest log', () => {
    const { session, screen } = start()
    buttons(screen.element)[0]?.click()
    buttons(screen.element)[0]?.click()
    press(screen.element, 'End investigator turn')
    press(screen.element, 'Continue')
    // Mythos with no monsters goes to horror; the round turns over on the
    // second finish, which is the horror phase waiting for the players.
    press(screen.element, 'Finish the phase')
    press(screen.element, 'Finish the phase')

    expect(session.runtime.vars.getValue('#round')).toBe(1)
    expect(session.runtime.log.toArray().some((e) => e.entry.includes('ROUND'))).toBe(true)
  })
})
