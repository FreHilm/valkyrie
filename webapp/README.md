# Valkyrie web port

TypeScript port of Valkyrie, tracked in Ordna as tasks `T-001`–`T-022`.

This lives alongside the Unity project rather than in a fork, so the C#
implementation stays available as the reference while porting — and so the
differential harness below can compare against it directly.

## Status

| Task                  |                                                             |                                           |
| --------------------- | ----------------------------------------------------------- | ----------------------------------------- |
| T-004                 | Workspace, typecheck, tests, CI                             | done                                      |
| T-005                 | `IniRead` and `ConfigFile`                                  | done                                      |
| T-006                 | `StringKey`, `DictionaryI18n`, `Localization`               | done                                      |
| T-007                 | `ContentData`, `ContentTypes`, `ContentLoader`              | done                                      |
| T-008                 | `QuestData` components                                      | done                                      |
| T-009                 | `VarManager`, `VarTests`, puzzles                           | done                                      |
| T-010                 | `VersionManager`, conformance ledger                        | done                                      |
| T-011                 | Virtual filesystem (memory, OPFS, Node)                     | done                                      |
| T-012                 | Archive extraction, localised file resolution               | done                                      |
| T-013                 | Remote content packs, HTTP, downloads                       | done                                      |
| T-015                 | Save/load envelope, config persistence                      | done                                      |
| T-020                 | Audio, and the Ogg muxer that replaces 26.7k vendored lines | done                                      |
| T-022                 | Web release pipeline, versioning, size budget               | done                                      |
| T-001 · T-002 · T-014 | FFG asset import: extraction, decoding, pipeline            | done                                      |
| T-023                 | AssetBundles, LZ4, the downloaded content cache             | done                                      |
| T-003                 | Architecture decision record                                | needs a call on rendering and persistence |
| T-016                 | UI foundation: units, components, trait filtering           | done                                      |
| T-017                 | Board renderer: geometry, camera, Canvas2D                  | done                                      |
| T-021                 | PWA: service worker, updates, storage, persistence          | done                                      |
| T-018                 | Play engine and screens (loop not done)                     | partial                                   |
| T-019                 | Quest round-trip verified (editor UI not built)             | partial                                   |

`T-001`, `T-002` and `T-014` were verified against a real Mansions of Madness
2.1.6 install. **Nothing derived from it is in this repository** — extracted
assets go to a cache outside it, and the harnesses that use them skip cleanly
when no install is present, so CI runs offline and without licensed content.
A D2E install has still not been read.

## Layout

```
packages/core/      engine-free logic: parsing, content model, rules
packages/platform/  filesystem, archives, HTTP, remote content packs
packages/ui/        unit system, components, board renderer, screens
packages/app/       the shipped app: shell, service worker, storage
tools/differential/ compares the port against the real C# implementation
tools/conformance/  accounts for every C# test case
docs/               porting decisions and verified behaviour
```

`@valkyrie/core` compiles with `"lib": ["ES2022"]` and `"types": []`, so it has
no access to DOM or Node type declarations. A stray `document` or `fs`
reference fails the build rather than quietly coupling the core to a host. Keep
it that way: filesystem, network and rendering belong elsewhere.
`@valkyrie/platform` holds the host-facing half — it compiles with DOM and Node
types, and carries three interchangeable `FileSystem` implementations so the
same code runs in a browser, in Node and in tests.

## Commands

```bash
npm install
npm run dev               # the app shell, at http://localhost:5173
npm run build:site        # a production build in packages/app/dist-site
npm test                  # vitest
npm run typecheck         # tsc --build --force
npx vitest run --coverage # coverage, thresholds enforced
npm run lint              # eslint, type-aware
npm run format:check      # prettier

node tools/conformance/ledger.mjs ..   # C# test accounting
node tools/size/check.mjs              # bundle size budget (after npm run build)
npx tsx tools/version/print.mjs        # the version the build will carry
```

## Differential testing

The port's correctness bar is _behavioural equivalence with the C# code_, not
"looks right" — hundreds of published community scenarios depend on the current
parser's exact quirks, including the ones that look like bugs.

`tools/differential/run.sh` compiles the unmodified C# sources straight out of
the Unity tree — stubbing only what pulls in UnityEngine — runs both
implementations over the same corpora, and diffs the results structurally:
section order, key order, every field of every component, and thrown
exceptions.

```bash
./tools/differential/run.sh 8000   # needs the dotnet SDK
```

Twenty harnesses run, most over three corpora — hand-written edge cases,
generated fuzz, and real shipped content:

- **`tools/differential/cs`** covers `IniRead.cs`, checked against all 236
  `.ini` files in `StreamingAssets/content`.
- **`tools/differential/i18n`** covers `DictionaryI18n.cs`, `StringKey.cs` and
  `LocalizationRead.cs`, checked against all 20 shipped `Localization.*.txt`
  files (7,119 keys) under four language/fallback configurations.
- **`tools/differential/content`** covers `ContentTypes.cs`, `ContentData.cs`,
  `ContentLoader.cs` and `ContentPack.cs`, checked against all 62 shipped
  content packs (~5,788 sections). It reaches the sources' private members by
  reflection rather than editing them, and dumps every public field and
  property reflectively, so a field the port forgot shows up as a difference.
- **`tools/differential/quest`** covers the `QuestData` component types,
  checked against 12 real `.valkyrie` packages (2,744 sections) downloaded
  from the community quest repositories.
- **`tools/differential/rules`** covers `VarManager.cs`, `VarTests.cs`, the
  puzzle types and `VersionManager.cs`.
- **`tools/differential/rounds`** covers `RoundController.cs` and
  `RoundControllerMoM.cs` — the round and activation loop. Neither C# file can
  run without a screen, so the port emits a request instead of building a
  dialog. The event engine is the same scripted stub on both sides, so a
  divergence can only come from the controller's own decisions. 18 mutations
  were introduced to check the harness bites; all 18 were caught.
- **`tools/differential/activation`** covers `Quest.ActivationInstance`, sliced
  out of `Quest.cs` and compiled with the extracted `OutputSymbolReplace` and
  the real `StringKey` — the three pieces that turn an activation's keys into
  what the player reads, checked working together.
- **`tools/differential/attacks`** covers `GetAttackTypes` and
  `GetRandomAttack`, sliced out of `ContentTypes.cs` and `QuestMonster.cs` —
  which attack buttons a monster offers and which text pressing one draws.
- **`tools/differential/monstertext`** compiles `InvestigatorEvade.cs` and
  `HorrorCheck.cs` unmodified against UI shims, covering which evade or horror
  entry a monster gets and how a custom monster falls back to the type it
  derives from.
- **`tools/differential/remote`** covers `RemoteContentPack.cs`, checked
  against both real manifests fetched from `valkyrie-store`. A companion
  `live-check.mjs` (opt-in, not run in CI) checks the real hosts for CORS and
  `Range` support, and proves resumption by cutting a real 13.8 MB download
  partway and comparing the result byte for byte.
- **`tools/differential/ogg`** compiles the vendored 26,669-line `.NET Ogg
Vorbis Encoder` unmodified and compares it against the port's ~200-line
  replacement **byte for byte**. Mutation-tested: four deliberate bugs were
  introduced and all four were caught at the right byte offset.
- **`tools/differential/unity`**, **`dds`**, **`fsb`** and **`bundle`** cover
  the FFG asset import against a real licensed install: 936 of 936 objects
  byte-identical to AssetStudio, 468 textures pixel-exact against Pillow, 173
  of 174 audio streams byte-identical to `FSBExport`, and a further 916 of 916
  objects out of LZ4-compressed AssetBundles. They skip when no install is
  present.
- **`tools/differential/symbols`** extracts `OutputSymbolReplace` from
  `EventManager.cs` — the code every line of quest text passes through — and
  checks the port against it.
- **`tools/differential/questwrite`** round-trips 103 quest files from twelve
  published scenarios, checking the line ending survives so saving does not
  rewrite every line of a file tracked in git.
- **`tools/differential/traits`** covers the selection list's trait filtering,
  extracting `TraitGroup` from a file that cannot otherwise leave Unity.
  Mutation-tested.
- **`tools/differential/multimedia`** covers
  `Quest.FindLocalisedMultimediaFile`. `Quest.cs` cannot be compiled outside
  Unity, so `extract.mjs` slices the one Unity-free overload out of the real
  source by brace-matching rather than copying it — and fails loudly if the
  signature moves.

It reports two classes of difference. `C# threw X, TS succeeded` is expected —
those are the documented deviations where the original crashes. `real
divergences` means both produced a result and disagreed, and must be zero. CI
fails the build if it is not.

Current state: **0 real divergences** across roughly 135,000 cases, plus the
FFG import checks below.

The harnesses import the packages' **source**, not their built `dist/`. That
matters: a mutation test of the Ogg harness found it reporting success while
comparing against a stale build. A harness that validates yesterday's output is
worse than no harness, because it looks healthy.

Deviations and findings are recorded per port:

- [docs/ini-port-deviations.md](docs/ini-port-deviations.md) — the INI parser,
  and the locale bug in the Unity build that `parse.ts` fixes.
- [docs/i18n-port-deviations.md](docs/i18n-port-deviations.md) — localization,
  including two preserved defects worth fixing in both implementations.
- [docs/content-port-deviations.md](docs/content-port-deviations.md) — the
  content model, including a token-parsing crash and two float parsers that
  disagree on the same input.
- [docs/quest-port-deviations.md](docs/quest-port-deviations.md) — the quest
  components, including `Enum.TryParse` accepting bare integers.
- [docs/rules-port-deviations.md](docs/rules-port-deviations.md) — variables,
  puzzles and versioning, including float32 storage and an int32 overflow.
- [docs/rounds-port-deviations.md](docs/rounds-port-deviations.md) — the round
  and activation loop, including the `Application.Quit()` a broken activation
  list reaches from inside the round.
- [docs/archive-port-deviations.md](docs/archive-port-deviations.md) — zip
  extraction, and the traversal guard the C# applies to only one of its four
  modes.
- [docs/multimedia-port-deviations.md](docs/multimedia-port-deviations.md) —
  localised file resolution, and two filesystem bugs it exposed in the port.
- [docs/remote-port-deviations.md](docs/remote-port-deviations.md) — content
  pack downloads, and a manifest date that lands four months apart depending on
  the reader's locale.
- [docs/audio-port-deviations.md](docs/audio-port-deviations.md) — audio, and
  the demonstration that 26,669 lines of vendored Ogg encoder are not needed.
- [docs/save-port-deviations.md](docs/save-port-deviations.md) — saves, the
  quest log, and config persistence. The one port so far with **no**
  differential harness; it says so up front and explains why.
- [docs/conformance-ledger.md](docs/conformance-ledger.md) — what happened to
  each of the 893 C# test cases.
- [docs/ffg-import.md](docs/ffg-import.md) — what a real licensed install
  actually contains, why WebP beats PNG by measurement, and the fact that the
  game's localisation has moved out of reach of the current importer.
- [docs/ui-foundation.md](docs/ui-foundation.md) — what was ported from the
  Unity UI and what was rewritten, and the accessibility the original lacks.
- [docs/release-pipeline.md](docs/release-pipeline.md) — how the web build is
  versioned, budgeted and published, and a hole this found in the existing CI.

## Adding a port

The loop that has worked for every port so far:

1. Read the C# and the existing NUnit tests for it.
2. Port the logic, marking any deliberate deviation in the source _and_ in
   `docs/`.
3. Migrate the NUnit cases 1:1, keeping their names so the suites can be diffed.
4. Extend the differential harness to cover the new surface, and run it against
   real shipped content — not just synthetic inputs.
5. Only then trust it.

Step 4 is the one that catches things. The hand-written tests for T-005 passed
on the first run; the fuzz corpus then found three genuine bugs in the port.
