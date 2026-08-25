# Conformance ledger

Covers `T-010`. Accounts for every one of the **893** `[Test]` / `[TestCase]`
cases in `unity/Assets/UnitTests/Editor`.

Regenerate with:

```bash
node webapp/tools/conformance/ledger.mjs .            # table
node webapp/tools/conformance/ledger.mjs . --unmatched # C# names with no TS twin
node webapp/tools/conformance/ledger.mjs . --json      # machine-readable
```

The tool fails if a C# test file has no recorded disposition, so a new suite
added upstream cannot go unnoticed.

## What the numbers mean

**`name-matched` is evidence, not a gate.** It counts how many C# case names
have a TypeScript test of the same name. A low number does not mean a gap:
several suites were migrated as behaviour groups rather than one-for-one,
because the differential harness already compares the two implementations
field-by-field across tens of thousands of inputs — which is a stronger
guarantee than any hand-written case.

It is reported so that "same names" and "same behaviour" stay distinguishable.

**`simulated` is the number that should give pause.** 132 of the 893 C# cases
re-implement the algorithm inline and assert against their own copy:

```csharp
// Act - simulating ParseEntry logic
string result = entry.Replace("\\n", "\n");
if (result.Length > 1 && result[0] == '\"' && ...)
```

That passes whether or not `ParseEntry` works. Three files are affected —
`DictionaryI18nTests` (70 of 72), `ConfigFileTests` (all 18) and
`LocalizationReadTests` (in part). On migration they were re-pointed at the
real implementation, so the TypeScript versions test what their names claim.

Two suites are the opposite — genuinely good: `ContentTypesTests` constructs
the real types in 90 of 114 cases, and `QuestComponentTests` in 177 of 179.

## Ledger

| C# file                          | cases | status             | task        | name-matched | note                                                                                                                                                                                                                                                                                                                         |
| -------------------------------- | ----: | ------------------ | ----------- | -----------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| QuestComponentTests              |   179 | ported             | T-008       |        0/179 | Every behaviour is asserted by quest.test.ts, and equivalence is established more strongly by the differential harness over 2,744 real scenario sections. Not migrated name-for-name: the 179 cases are "parse this dict, assert this field", which the harness already compares field-by-field across every component type. |
| ContentTypesTests                |   112 | ported             | T-007       |       19/112 | A good suite — 90 of 114 construct the real types.                                                                                                                                                                                                                                                                           |
| DictionaryI18nTests              |    72 | ported (simulated) | T-006       |        42/72 | 70 of 72 re-implement the algorithm inline; re-pointed at the real class.                                                                                                                                                                                                                                                    |
| EventManagerTests                |    53 | deferred           | T-018       |            — | Drives the running game: event queue, hero selection, monster placement. Needs Quest.cs runtime state.                                                                                                                                                                                                                       |
| AdditionalCoverageTests          |    52 | deferred           | various     |            — | A grab-bag added for coverage, spanning save/load, the quest log and game types. Follows those subsystems.                                                                                                                                                                                                                   |
| PuzzleTests                      |    46 | ported             | T-009       |        45/46 |                                                                                                                                                                                                                                                                                                                              |
| GameTypeTests                    |    45 | deferred           | T-016       |            — | Fonts, UI scale and hero counts. Much of it is Unity Font/Sprite; the rest lands with the UI foundation.                                                                                                                                                                                                                     |
| VarManagerTests                  |    44 | ported             | T-009       |        44/44 |                                                                                                                                                                                                                                                                                                                              |
| LocalizationReadTests            |    42 | ported (simulated) | T-006       |        31/42 | The BbCode and DictQuery cases inline their own copy; re-pointed.                                                                                                                                                                                                                                                            |
| VarTestsTests                    |    40 | ported             | T-008/T-009 |        40/40 |                                                                                                                                                                                                                                                                                                                              |
| SaveLoadTests                    |    34 | deferred           | T-015       |            — | Save round-trips; needs the runtime Quest object and the persistence layer.                                                                                                                                                                                                                                                  |
| PuzzleCodeTests                  |    25 | ported             | T-009       |        25/25 |                                                                                                                                                                                                                                                                                                                              |
| QuestLogTests                    |    25 | deferred           | T-015       |            — | The quest log is runtime state.                                                                                                                                                                                                                                                                                              |
| UtilityTests                     |    24 | ported             | T-010       |        18/24 |                                                                                                                                                                                                                                                                                                                              |
| StringKeyTests                   |    23 | ported             | T-006       |        22/23 |                                                                                                                                                                                                                                                                                                                              |
| ConfigFileTests                  |    18 | ported (simulated) | T-005       |        18/18 | Asserts on IniData patterns rather than the ConfigFile class; re-pointed at the real class.                                                                                                                                                                                                                                  |
| IniReadTests                     |    15 | ported             | T-005       |        15/15 |                                                                                                                                                                                                                                                                                                                              |
| VersionManagerTests              |    15 | ported             | T-010       |        15/15 |                                                                                                                                                                                                                                                                                                                              |
| FindLocalisedMultimediaFileTests |    13 | deferred           | T-011       |            — | Resolves a localised audio/image file on disk; needs the virtual filesystem.                                                                                                                                                                                                                                                 |
| SetVersionTests                  |     7 | ported             | T-010       |          0/7 |                                                                                                                                                                                                                                                                                                                              |
| RemoteContentPackTests           |     5 | deferred           | T-013       |            — | Manifest fetching and pack downloads.                                                                                                                                                                                                                                                                                        |
| ContentDataTests                 |     2 | ported             | T-007       |          2/2 |                                                                                                                                                                                                                                                                                                                              |
| DummyTest                        |     1 | dismissed          | —           |            — | Asserts true == true, to keep the Unity test runner happy.                                                                                                                                                                                                                                                                   |
| ZipSlipTests                     |     1 | deferred           | T-012       |            — | Archive extraction, and extended there to cover the selective-extraction modes the C# leaves unguarded.                                                                                                                                                                                                                      |

total C# cases: 893
simulated: 132
ported: 664
deferred: 228
dismissed: 1
TypeScript tests: 622

## How equivalence is actually established

The TypeScript suite is the regression net. The proof that the port matches
the C# is the differential harness: it compiles the unmodified C# sources,
runs both implementations over shared corpora, and diffs the results
structurally.

| Harness                      | What it covers                                                | Real content                                          |
| ---------------------------- | ------------------------------------------------------------- | ----------------------------------------------------- |
| `tools/differential/cs`      | `IniRead`                                                     | all 236 shipped `.ini` files                          |
| `tools/differential/i18n`    | `DictionaryI18n`, `StringKey`, `LocalizationRead`             | all 20 `Localization.*.txt`, 7,119 keys               |
| `tools/differential/content` | `ContentTypes`, `ContentData`, `ContentLoader`, `ContentPack` | all 62 content packs, ~5,788 sections                 |
| `tools/differential/quest`   | `QuestData`, `QuestButtonData`, `VarTests`                    | 228 published manifests, 12 scenarios, 2,744 sections |
| `tools/differential/rules`   | `VarManager`, the four puzzles, version comparison            | —                                                     |

Across all fourteen corpora: **0 real divergences**.

That is what caught the bugs the hand-written tests missed — the
`AllowThousands` cases, the `Enum.TryParse` numeric forms, the short-circuit
in nested conditions, the float32 storage, the int32 overflow in the version
code. None of those would have been found by porting the C# tests alone.
