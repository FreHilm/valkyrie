/**
 * Setting the table before a scenario runs.
 *
 * `Game.SelectQuest` puts the investigator grid up, `EndSelection` records the
 * party, and `HeroCanvas.EndSection` shows what they start with. Only when
 * that is confirmed does `QuestStartEvent` fire `EventStart` — which is where
 * the scenario's own opening plays. So the order is the game's: who is
 * playing, what they hold, then the story.
 *
 * Both steps are resolved here rather than in the shell because each needs
 * content the shell has no view of: the investigator roster, the item decks,
 * and the selection that decides which item a scenario's "a weapon" became.
 */

import {
  fameLevel,
  generateItemSelection,
  HeroData,
  ItemData,
  QItem,
  startingItems,
} from '@valkyrie/core'
import type { ContentData, Quest, QuestComponent, QuestSession } from '@valkyrie/core'
import { heroSelection, startingItemsScreen } from '@valkyrie/ui'
import type { Selectable, StartingItemView } from '@valkyrie/ui'

export interface PartySetupOptions {
  session: QuestSession
  content: ContentData
  components: ReadonlyMap<string, QuestComponent>
  resolveTexture: (name: string) => string | null
  quest: Quest
  /**
   * Turns a resolved art file into something an `<img>` can show.
   *
   * Awaited before a screen is shown rather than filled in afterwards: these
   * run before the board exists, so there is nothing to redraw when a late
   * image arrives, and a roster of portraits is small enough to wait for.
   */
  artUrl?: (path: string) => Promise<string | null>
  /** Puts a screen on the page and resolves when the player is finished. */
  present: (element: HTMLElement) => void
}

/** The investigator roster, as the selection grid shows it. */
export async function investigators(
  content: ContentData,
  art: (file: string) => Promise<string | null>,
): Promise<Selectable[]> {
  const roster = await Promise.all(
    content.getAll(HeroData).map(async ([id, hero]) => {
      const file = await art(hero.image)
      return { id, name: hero.name.translate(), ...(file === null ? {} : { image: file }) }
    }),
  )
  return roster.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * The deck a card belongs to, from its section name.
 *
 * `InvestigatorItems` finds the second capital letter and splits there, so
 * `ItemCommonLantern` groups under `ItemCommon`. Crude, and it is what
 * produces the grouping a player recognises from the box.
 *
 * DEVIATION: the C# groups by this but never shows it, so the list arrives in
 * deck order with nothing saying which deck. The `Item` prefix is dropped here
 * and the rest shown as a heading — "Common", "Unique", "Spell" are the names
 * on the actual card backs, and naming them is the whole use of the grouping
 * when someone is looking for the cards in a box.
 */
export function itemGroup(sectionName: string): string {
  let at = 5
  while (at < sectionName.length - 1) {
    if (sectionName[at] !== undefined && /[A-Z]/.test(sectionName[at] ?? '')) break
    at += 1
  }
  const prefix = sectionName.slice(0, at)
  const named = prefix.startsWith('Item') ? prefix.slice('Item'.length) : prefix
  // `ItemCommon18Derringer` splits at the `D`, because the rule only looks for
  // a capital and `18` is not one. Harmless where the C# uses this to sort,
  // and not where it is shown: trailing digits are part of the card's name
  // rather than of its deck's.
  return named.replace(/\d+$/, '')
}

/**
 * Runs both steps, then leaves the session ready for `start()`.
 *
 * Resolves when the player has confirmed the items — the caller fires the
 * quest's opening events after that, not before.
 */
export async function setUpParty(options: PartySetupOptions): Promise<void> {
  const { session, content, components, quest } = options
  const art = async (file: string): Promise<string | null> => {
    const resolved = options.resolveTexture(file)
    if (resolved === null || options.artUrl === undefined) return null
    return options.artUrl(resolved)
  }

  const roster = await investigators(content, art)
  const chosen = await new Promise<readonly string[]>((resolve) => {
    const screen = heroSelection({
      available: roster,
      // `maxHero` is what the grid counts up to; a scenario setting neither
      // takes the game type's default, which the parser has already applied.
      required: quest.minHero,
      title: rawTitle('Choose your investigators'),
      confirmLabel: rawTitle('Finished'),
      countLabel: (count, required) => `${String(count)} of ${String(required)} chosen`,
      onConfirm: resolve,
    })
    options.present(screen.element)
  })

  for (const heroName of chosen) {
    session.runtime.heroes.push({ heroName, activated: false })
  }
  // `EndSelection` sets morale from the count, and `HeroCanvas` sets `#heroes`.
  session.runtime.vars.setValue('#heroes', chosen.length)
  session.runtime.vars.setValue('$%morale', chosen.length)

  const items = content.getAll(ItemData)
  const itemsById = new Map(items.map(([id, data]) => [id, data]))

  // Selection runs after the party is known, because what they already hold
  // is one of the things it excludes.
  const selected = generateItemSelection(
    [...components.values()].filter((c): c is QItem => c instanceof QItem),
    {
      items: itemsById,
      fame: fameLevel((name) => session.runtime.vars.getValue(name)),
      held: session.runtime.items(),
      random: (count) => Math.floor(Math.random() * count),
      warn: (message) => {
        session.logWarning(message)
      },
    },
  )
  for (const [section, item] of selected) session.runtime.itemSelect.set(section, item)

  const start = startingItems({
    heroes: chosen.map((heroName) => ({
      heroName,
      item: content.tryGet(HeroData, heroName)?.item ?? '',
    })),
    questItems: [...components.values()]
      .filter((c): c is QItem => c instanceof QItem)
      .map((item) => ({
        sectionName: item.sectionName,
        itemName: item.itemName,
        traits: item.traits,
        traitpool: item.traitpool,
        starting: item.starting,
        passes: session.runtime.vars.test(item.tests),
        inspect: item.inspect,
      })),
    selected,
    items: itemsById,
  })

  for (const held of start.items) session.runtime.giveItem(held, start.inspect.get(held))

  const cards = await Promise.all(
    start.items.map(async (id): Promise<StartingItemView> => {
      const data = itemsById.get(id)
      const file = data === undefined ? null : await art(data.image)
      return {
        id,
        name: data?.name.translate() ?? id,
        group: itemGroup(id),
        ...(file === null ? {} : { image: file }),
      }
    }),
  )

  await new Promise<void>((resolve) => {
    const screen = startingItemsScreen({ onConfirm: resolve })
    screen.show(cards)
    options.present(screen.element)
  })
}

/** The screens take `Text`; these strings are the shell's, not content's. */
function rawTitle(value: string): { kind: 'raw'; value: string } {
  return { kind: 'raw', value }
}
