# Localised multimedia resolution — verified behaviour

Covers the second half of `T-012`. The port targets
`Quest.FindLocalisedMultimediaFile` (`unity/Assets/Scripts/Quest/Quest.cs:150`)
and lives in `@valkyrie/platform` rather than `@valkyrie/core`, because
resolving a file means asking a filesystem.

This was left behind by T-011: the conformance ledger listed its 13 cases as
`deferred` against a task that had already closed. It is ported now, and all 13
migrate by name.

## How it was verified

`Quest.cs` cannot be compiled outside Unity — it pulls in most of UnityEngine.
But the testable five-argument overload touches nothing beyond `System.IO`, so
`tools/differential/multimedia/extract.mjs` slices that one method out of the
real source by brace-matching and wraps it in a compilable class. The code
under test is therefore byte-identical to what ships, and the extractor fails
loudly if the signature ever moves.

Both sides run the same corpus: 24 curated layouts plus generated fuzz, where
each case creates a set of files, then resolves a name under a language
context. The C# side builds each layout in a real temp directory; the port
builds it in `MemoryFileSystem`.

**Result: 0 divergences across 5 seeds × 4,024 cases (20,120 total).**

## Two real bugs this found — in the port's filesystem, not the resolver

The resolver itself matched immediately. The first run diverged on two cases,
and both were the virtual filesystem being more forgiving than a real one:

| Case              | C# on a real filesystem                                           | The port, before                                |
| ----------------- | ----------------------------------------------------------------- | ----------------------------------------------- |
| name `./Tile.png` | finds `German/./Tile.png`                                         | missed it, fell through to the unlocalised path |
| name `Tile.png/`  | `File.Exists` is false — a trailing separator demands a directory | found the file, returned the localised path     |

Both changed which path the resolver returned, so neither is cosmetic. Quest
inis are hand-written by scenario authors and do contain `./` prefixes.

The fixes are in the filesystem layer, where the bug was, and are now asserted
across all three implementations by the shared `describe.each` suite:

- lookups resolve `.` and `..` before matching (`MemoryFileSystem`,
  `OpfsFileSystem`);
- a trailing separator restricts a lookup to directories (all three;
  `NodeFileSystem` had to have the separator put _back_ after `resolve()`
  stripped it, so the OS could apply its own rule).

`OpfsFileSystem` was wrong in the same two ways and had no test that would have
caught it — it would have failed only in a browser, on scenarios that happen to
use `./`.

## Behaviour preserved

- **Four candidates, in order**: `<source>/<lang>/<name>`, then
  `<source>/<dir>/<lang>/<file>`, then the same two for the fallback language,
  then the unlocalised `<source>/<name>`. The root-level language folder wins
  over one nested in the asset's own subfolder — an ordering the C# suite never
  pins down, now covered by the harness.
- **Edit mode skips every localised candidate**, so the editor addresses the
  originals.
- **The fallback pass is skipped** when the fallback language is null, empty,
  or equal to the current one.
- **A path always comes back**, existing or not: the last step composes
  `<source>/<name>` unconditionally and callers report the missing file
  themselves.

## Deviation

Only one, and it is a signature change rather than a behavioural one: the C#
has a two-argument overload that reads `Game.game.currentLang`,
`fallbackLang` and `editMode` off a global. The port takes a
`LocalisationContext` instead. The five-argument overload — the one the C#
tests already use — maps across exactly.
