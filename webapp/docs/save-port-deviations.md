# Save/load and config persistence — verified behaviour and deviations

Covers `T-015`. Targets `SaveManager.cs`, `QuestLog.cs`, the `LogEntry` class
in `Quest.cs:2754`, and the file I/O half of `ConfigFile.cs`.

## Assurance level — read this first

Unlike every prior task, **this port has no differential harness.**
`SaveManager.cs` cannot be compiled outside Unity: it reaches `Game.Get()`,
`Screen`, `Texture2D`, `Destroyer` and the whole UI stack from inside its save
and load methods, and the logic is inline in those methods rather than in
extractable functions. Nothing here was settled by running the C#.

What that means in practice:

- `LogEntry` and `QuestLog` are **fully covered by the migrated C# suite** —
  all 25 `QuestLogTests` and all 34 `SaveLoadTests` cases match by name.
- The save _envelope_ handling — path rewriting, pack expansion, version
  gating — is **transcribed from the source and covered by new tests**, but not
  verified against the original by execution. Treat it as the weakest link in
  the port so far, and re-check it against real `.vSave` files when any are
  available.

No real save files ship in the repository, so the round-trip tests build their
own archives.

## The save-format decision, and what was assumed

The task says T-003 should have settled whether web and Unity saves
interoperate, and to escalate rather than pick silently. T-003 is not written,
so this is the assumption made, stated loudly rather than buried:

> **The port preserves the existing save format**: a zip holding `save.ini`,
> `image.png`, and the quest content, with the same keys and the same four
> slots.

That is the conservative choice — it costs nothing, since the port already
reads and writes ini through the same parser, and it keeps interoperability
open rather than foreclosing it. Deviating would have been the choice needing
justification. **It is still the user's call**, and one thing does already
diverge: line endings (below).

## Deviations

### 1. Line endings are always `\n`

`LogEntry.ToString` appends `Environment.NewLine`, so a log line written on
Windows differs byte for byte from one written elsewhere. `IniData.ToString`
has the same problem, already documented in the T-005 deviations.

Worth noting: **`QuestLogTests.cs` asserts `"quest5=Test message\r\n"`
literally**, so those cases only pass on Windows. They are migrated asserting
`\n`, which is what the port writes on every platform.

This is the one place the format differs from a Windows-written Unity save.
Parsers on both sides tolerate either, so it does not break interoperability —
but a byte-for-byte comparison of two saves will show it.

### 2. Valkyrie log entries need an explicit flag

`LogEntry.GetEntry` hides Valkyrie diagnostics unless `Application.isEditor`.
There is no Unity editor here, so it takes a `developmentBuild` argument. It
defaults to **false** — the shipped-build behaviour — whereas the C# suite runs
under the Unity test runner where it is implicitly true.

### 3. Legacy pack ids are not also loaded under their old id

`SaveManager.Load` expands three legacy 1.2-era pack ids. The chain is
`if (FA) … if (CotW) … if (MoM1E) … else …`, so the `else` binds only to the
`MoM1E` test. A save naming `FA` therefore loads `FAI`/`FAM`/`FAT` **and** then
falls through to `LoadContentID("FA")`, which is not a pack that exists. The
port emits only the three real ids.

### 4. Failures are reported, not fatal

The C# ends several failure paths in `Application.Quit()` or a bounce to the
main menu from inside the loader:

| Situation                      | C#                                                                       | Port                                 |
| ------------------------------ | ------------------------------------------------------------------------ | ------------------------------------ |
| save from a newer version      | log, main menu                                                           | `SaveError('future-version')`        |
| save below the minimum version | log, main menu                                                           | `SaveError('unsupported-version')`   |
| unreadable save file           | log, `Application.Quit()`                                                | `SaveError('unreadable')`            |
| unparsable save time           | throws, caught as "unable to open" — **discards an otherwise good save** | `saveTime` is null, save stays valid |
| config write fails             | warning logged, settings silently lost                                   | throws, `StorageFullError` surfaced  |

The last two matter most. `DateTime.Parse` throwing on a malformed `time` makes
the whole save unopenable in the C#. And a browser reaching its storage quota
is a normal condition, not an exceptional one, so silently discarding the
user's settings is not acceptable there.

### 5. Save times are read as UTC

Same locale bug as the content manifest, and measured there:
`DateTime.Parse` uses the machine culture. See
`remote-port-deviations.md` for the measurements. Saves are written with an ISO
8601 `Z` timestamp and read as UTC.

### 6. Listing four slots does not touch the disk

`SaveManager.SaveData` extracts each save into a shared `Preload` directory to
read its name and thumbnail, and leaves the directory behind. The port reads
the archive in memory, so listing the save screen writes nothing.

## New: export and import

Not a port — there is nothing to port. On the desktop a user could copy
`saveAuto.vSave` out of the app data directory to move it between machines. The
origin-private filesystem a browser gives us is not reachable that way, so the
capability has to be built:

- `exportSave` returns the bytes and a filename derived from the quest name,
  sanitised — a quest called `../../etc/passwd` yields `.._.._etc_passwd-1.vSave`.
- `importSave` reads and version-gates the archive **before writing anything**,
  so a wrong or hostile file cannot destroy the save already in that slot.
  There is a test for exactly that.

## Behaviour preserved

- **Four slots, slot 0 named `Auto`**: `save/saveAuto.vSave`, `save1.vSave`, …
- **`minValkyieVersion` is `0.7.3`**, and both version gates apply identically
  in the metadata read and the load path — extracted into `checkSaveVersion` so
  they cannot drift apart, which they easily could in the C# (the two copies
  are separate code).
- **The quest-path rewrite**: a save written the first time records the quest's
  original path, and on load the content is under the temp load directory, so
  the recorded prefix is rewritten.
- **The load directory is deleted before extracting**, so a previous load
  cannot leak into the next.
- **`LogEntry` type strings are prefix-matched** (`IndexOf(...) == 0`), so
  `editorial` is an editor entry and an unrecognised type is a quest entry.

## Not ported

**The runtime quest state itself.** `save.ini` is written by
`Quest.ToString()`, which serialises the live `Quest` object — board items,
monsters, heroes, the undo history, shops, item selections. That object is the
runtime half of `Quest.cs` and depends on `Monster`, `Hero`, `BoardComponent`
and the event engine, none of which are ported. This task delivers the
envelope: reading, writing, listing, gating, exporting and importing a save,
plus the log inside it.

Two consequences to carry forward:

- **The undo history** rides on the same serialisation, so it lands with the
  quest runtime rather than here.
- **The known defect at `Quest.cs:2699`** — random hero selection is not
  preserved across save/load or undo — is untouched, and the decision about
  whether to fix or reproduce it belongs with that work. Fixing it changes what
  `save.ini` contains, which is exactly the interoperability question above.
