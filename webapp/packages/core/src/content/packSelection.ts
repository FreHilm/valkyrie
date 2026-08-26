/**
 * Which content packs a player has, and what that means to a scenario.
 *
 * The game does not load everything it finds. `GameStateManager` loads the
 * base pack alone at startup, and `Game.SelectQuest` then loads whatever the
 * `<GameType>Packs` config section lists — the boxes the player told the
 * content screen they own. A pack can also name others it needs, and those
 * come with it.
 *
 * Scenarios test the result. `Quest.cs:237` sets `#<packId>` for every loaded
 * pack, and three older aliases besides, so a quest can say "this needs the
 * first edition tiles" and mean it. Loading everything regardless is not a
 * shortcut to the same place: it answers those tests with a yes the player
 * never gave.
 */

/** What pack selection needs to know about a pack. */
export interface SelectablePack {
  id: string
  /** `clone`: other packs this one needs, which come with it. */
  clone: readonly string[]
}

/**
 * The packs to load, given what the player selected.
 *
 * The base pack is always in, whatever the selection says — `Select` refuses
 * to deselect it and the game loads it before the menu is even drawn.
 *
 * A selection naming a pack that is not installed is ignored rather than
 * failing: the config outlives the content, and a player who removes an
 * expansion should still be able to start the game.
 */
export function packsToLoad(
  available: Iterable<SelectablePack>,
  selected: Iterable<string>,
  baseId: string,
): Set<string> {
  const byId = new Map<string, SelectablePack>()
  for (const pack of available) byId.set(pack.id, pack)

  const loaded = new Set<string>()
  const take = (id: string): void => {
    if (id.length === 0 || loaded.has(id)) return
    const pack = byId.get(id)
    if (pack === undefined) return
    loaded.add(id)
    // `ContentLoader.cs:123` loads a pack's clones after the pack itself, and
    // guards on `loadedPacks`, so a cycle terminates rather than recurring.
    for (const dependency of pack.clone) take(dependency)
  }

  take(baseId)
  for (const id of selected) take(id)
  return loaded
}

/**
 * Older aliases for a set of packs bought together.
 *
 * `Quest.cs:246` predates per-pack ids in quest formats below 6, and scenarios
 * still test these — the Mansions first-edition conversion kit is three packs
 * that were one product.
 */
const PACK_ALIASES: Record<string, readonly string[]> = {
  '#MoM1E': ['MoM1ET', 'MoM1EI', 'MoM1EM'],
  '#CotW': ['CotWT', 'CotWI', 'CotWM'],
  '#FA': ['FAT', 'FAI', 'FAM'],
}

/**
 * The variables a quest sees for the packs in play.
 *
 * `#<packId>` for each, plus an alias where every pack behind it is loaded.
 * The value is always 1; a scenario tests presence, not degree.
 */
export function packVariables(loaded: Iterable<string>): Map<string, number> {
  const ids = new Set(loaded)
  const vars = new Map<string, number>()
  // `if (s.Length > 0)`: an empty id would set a variable called `#`.
  for (const id of ids) if (id.length > 0) vars.set(`#${id}`, 1)

  for (const [alias, members] of Object.entries(PACK_ALIASES)) {
    if (members.every((id) => ids.has(id))) vars.set(alias, 1)
  }
  return vars
}
