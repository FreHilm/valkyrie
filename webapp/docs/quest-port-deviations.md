# Quest data port — verified behaviour and deviations

Covers `T-008`. The port targets `QuestData.cs` (2,513 lines),
`QuestButtonData.cs` and `VarTests.cs`.

This is the schema every published scenario is written against, and there is no
way to migrate content that lives in other people's GitHub repositories, so
fidelity matters more here than anywhere else in the port.

Reproduce with `webapp/tools/differential/run.sh`.

| Corpus                                                                      | Cases | Real divergences |
| --------------------------------------------------------------------------- | ----: | ---------------: |
| Hand-written edge cases                                                     |   118 |                0 |
| Fuzz                                                                        | 8,000 |                0 |
| **228 published quest manifests** (every D2E and MoM scenario in the store) |   228 |                0 |
| **12 downloaded scenarios, 2,744 real sections**                            |   133 |                0 |

## Real content had to be downloaded

No quest content ships with the repository — the app fetches it at runtime from
`valkyrie-store` (manifests) and `valkyrie-questdata` (`.valkyrie` packages).

`tools/differential/quest/fetch-real.mjs` pulls a sample into a local directory
outside the repo; `real-content.mjs` turns whatever is there into corpus cases,
and yields an empty corpus when the directory is absent, so the harness still
runs offline and in CI. Point it at a sample with `VALKYRIE_QUEST_SAMPLE`.

The 12 downloaded scenarios between them cover every component type: 1,695
Events, 408 Tokens, 146 Tiles, 119 Spawns, 112 QItems, 75 UIs, 49 MPlaces, 27
Activations, 23 CustomMonsters, 18 Puzzles, 18 Doors.

## VarTests came early

`VarTests.cs` is nominally T-009 work, but `QuestComponent` cannot be ported
without it — a genuine cycle in the task graph. It is ported here; T-009 keeps
`VarManager` and `EventManager`.

## Deviations from the C# behaviour

### 1. Parse failures throw instead of quitting the app

Three places call `Application.Quit()` from inside the parser — terminating the
process on bad input:

- a `Tile` with neither `side` nor `customImage`
- a duplicate section name
- an unreadable quest ini

The port throws instead, so a malformed community scenario can be reported.

### 2. A malformed `VarOperation` no longer throws

`new VarOperation("$a,>")` logs "Invalid var operation" and then indexes
`parts[0..2]` regardless, throwing `IndexOutOfRangeException` — which aborts
the whole quest load. The port keeps whatever was supplied, so one bad line
cannot take the scenario down with it.

This is the single most common divergence in the fuzz run (142 of 3,000),
because the fuzzer generates malformed operations freely. Real content does
not.

## Bugs the corpus found in the port

Recorded because they show what hand-written tests would have missed.

### `TextAlignment` is vertical, not horizontal

`textAlignment` parses into `TOP | CENTER | BOTTOM`. The port initially assumed
`LEFT | CENTER | RIGHT` — a reasonable guess from the field name, and wrong.
`left` and `right` are invalid and fall back to CENTER; horizontal alignment is
the separate `halign` field. Caught by a curated case.

### `Enum.TryParse` accepts numbers

`event1ConditionAction=1` means `DISABLE`, and `...=2` means `HIDE`, because
.NET's `Enum.TryParse` accepts the underlying integer as readily as the name.
It does not range-check either: `99` produces an enum value that prints as
"99". Verified against .NET:

| Input              | Result                                                   |
| ------------------ | -------------------------------------------------------- |
| `NONE` / `none`    | NONE                                                     |
| `0`, `1`, `2`      | NONE, DISABLE, HIDE                                      |
| `+1`, `" 1 "`      | DISABLE                                                  |
| `3`, `99`, `-1`    | accepted, prints as the number                           |
| `1.0`, `0x1`, `""` | rejected                                                 |
| `NONE,HIDE`        | HIDE (bitwise OR, even though the enum is not `[Flags]`) |
| `1,2`              | rejected                                                 |

Two fuzz cases out of 3,000 hit this. Real content would too, since `1` and `2`
are plausible things for an author to write.

### `maxHero` timing

The port initially set `maxHero` from the game context in the constructor. The
C# only does so _inside_ `Populate`, after the format check — so an invalid
quest keeps the declared default of 5 rather than the game's hero count.

## Behaviour worth knowing

- **A displayed event always gets a button.** `display=true` with no `buttons`
  key yields one button, so there is always a way out of the dialog.
- **A token carries no conditions.** `Token` sets `tests = null` after the base
  constructor has parsed them, discarding any `vartests` on the section.
- **`mincam` / `maxcam` clear the location.** A camera-relative event has no
  board position even if `xposition` was given.
- **A non-numeric `quota` names a variable.** The check is on the first
  character only.
- **`StartingItem...` sections load as `QItem...`.** The old spelling is
  rewritten on the way in.
- **Built-in monster names are never renamed.** `Spawn.changeReference` skips
  any `mTypes` entry starting with "Monster", so only quest-defined monsters
  follow a rename.
- **Format 8 and earlier get an implicit `$end,=,1`** on any section named
  `EventEnd...`.
- **`#fire` becomes `$fire`**, a format-3 compatibility rewrite in every
  `VarOperation`.
- **`attacks=melee:3` expands to three text keys**, `Attack_melee_1` through
  `_3`.
- **Pack shorthands expand**: `MoM1E` becomes `MoM1ET MoM1EI MoM1EM`, and the
  result is sorted because the C# collects into a `SortedSet`.
- **Old MoM scenarios get the conversion kit** added automatically when the
  format predates the base/kit split and the identifier is on the known list.
- **Language variants are matched with `Contains`, not `StartsWith`**, so a key
  containing `name.` anywhere is collected. Preserved.

## Scope

Not ported, and why:

| Left out                                                                                   | Why                                   | Task  |
| ------------------------------------------------------------------------------------------ | ------------------------------------- | ----- |
| `QuestData` file loading                                                                   | reads ini files from disk             | T-011 |
| Editor-only constructors (`new Tile("name")`)                                              | reach into a live `Game` for defaults | T-019 |
| `Quest.Load` / localization file loading                                                   | filesystem                            | T-011 |
| Download-manager fields (`package_url`, `downloaded`, `update_available`, `latest_update`) | not quest data                        | T-013 |

## Harness note

`QuestData`'s dispatch and `Quest.Populate` are private, and `QuestData`'s
constructor reads files, so the harness builds instances with
`FormatterServices.GetUninitializedObject` and drives them by reflection.

That skips field _and_ static initializers, which produced two false failures
before it was handled: `Quest.currentFormat` defaulted to 0 (making every
format check fail) until `RunClassConstructor` was called, and the `valid`
field stayed false because the constructor — not `Populate` — is what assigns
it. Both were harness bugs, not port bugs, but they looked identical from the
outside until traced.
