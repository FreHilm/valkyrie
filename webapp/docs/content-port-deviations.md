# Content model port — verified behaviour and deviations

Covers `T-007`. The port targets `ContentTypes.cs` (666 lines), `ContentData.cs`
(the data-model half of 808), `ContentLoader.cs`, `ContentPack.cs` and
`FormatVersions.cs`.

Verified the same way as the earlier ports, but with a twist: the real C#
sources are compiled unmodified against shims, and the harness reaches their
private members **by reflection** rather than editing them to be testable. The
dumper walks public fields and properties reflectively instead of listing them
by hand, so a field the port forgot shows up as a difference rather than being
silently skipped.

Reproduce with `webapp/tools/differential/run.sh`.

| Corpus                                                     | Cases | Real divergences |
| ---------------------------------------------------------- | ----: | ---------------: |
| Hand-written edge cases                                    |    74 |                0 |
| Fuzz                                                       | 3,000 |                0 |
| **Every shipped content pack** — 62 packs, ~5,788 sections |   124 |                0 |

The real-content row loads each pack exactly as `ContentLoader` does — every
ini it declares, section by section, into one registry — so priority
resolution and set merging are exercised against real data.

## What is in scope

Not everything in `ContentData.cs` is ported. Left for later tasks:

| Left out                                                           | Why                       | Task  |
| ------------------------------------------------------------------ | ------------------------- | ----- |
| Pack discovery (`GetBuildInContentPacks`, `GetCustomContentPacks`) | directory scanning        | T-013 |
| Archive extraction (`PopulatePackListByPath`)                      | zip handling              | T-012 |
| Texture decoding (`FileToTexture`, `DdsToTexture`, `PvrToTexture`) | renderer                  | T-001 |
| Path helpers (`ContentPath`, `TempPath`, ...)                      | filesystem                | T-011 |
| `PerilData`                                                        | extends `QuestData.Event` | T-008 |

`ContentLoader` takes its loader list as a **parameter** rather than holding it
in a static field, precisely because `PerilDataLoader` cannot exist yet. A
fixed list would either be wrong now or need editing later.

## The host dependencies, and where they went

Parsing a content pack in the C# needs a live `Game` and a real filesystem:
`GenericData`'s image loop calls `File.Exists` through
`ContentData.ResolveTextureFile`, `TileSideData` reads
`Game.Get().gameType.TilePixelPerSquare()`, `TokenData` checks
`Application.platform == RuntimePlatform.Android`, and `ImportPath()` reads
`Game.AppData()`.

All four are collected into a `ContentContext` the caller supplies, which is
what keeps the content model host-free and testable. `makeTextureResolver`
builds the resolver over any existence predicate.

## Deviations from the C# behaviour

### 1. Parse failures throw instead of quitting the app

`GetContentPack` calls `Application.Quit()` when the ini is unreadable or has
no `name` — it terminates the process from inside a parser. The port throws, so
a malformed community pack can be reported instead of closing the app.

### 2. A `LanguageData` entry with no space throws a typed error

The C# does `s.Substring(0, s.IndexOf(' '))`, which is `Substring(0, -1)` and
throws `ArgumentOutOfRangeException` when the entry has no space. The port
throws `RangeError` naming the bad entry.

### 3. Paths always use `/`

The C# uses `Path.DirectorySeparatorChar`, so a pack parsed on Windows stores
`\`-separated paths and the same pack parsed on Linux stores `/`. A single web
artifact serving every platform cannot do that.

Note that the C# builds paths **two different ways**, and the difference is
observable, so the port models both rather than collapsing them:

- `Path.Combine(a, b)` — used by `GenericData`'s image loop. An empty `b`
  leaves `a` unchanged.
- `a + Path.DirectorySeparatorChar + b` — used by the content pack fields,
  `imageplace` and `file`. A separator is **always** inserted, so a pack with
  no `image` key stores a path ending in a slash.

Collapsing these into one helper produced six differences on the first
differential run.

## Preserved bugs

### A token declaring `height` without `width` crashes the load

```csharp
if (content.ContainsKey("height")) { int.TryParse(content["height"], out height); }
if (content.ContainsKey("height")) { int.TryParse(content["width"],  out width);  }
```

The second guard tests `height` but reads `width`. So:

- `height` without `width` → `content["width"]` throws `KeyNotFoundException`,
  aborting the pack load.
- `width` without `height` → the width is never read and stays 0.

No shipped content triggers either case — every token section declares both or
neither — but community content could. The port raises a `RangeError` naming
the offending section rather than a bare key error, and is covered by a test.

### `float` fields reject a comma, but other numbers accept it

`ContentTypes.cs` parses floats with the **explicit** overload
`float.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out v)`.
`NumberStyles.Float` is
`AllowLeadingWhite | AllowTrailingWhite | AllowLeadingSign | AllowDecimalPoint | AllowExponent`
— it does **not** include `AllowThousands`.

So `health=0,5` parses as **0** here, where the bare `float.TryParse(s, out v)`
used in `Audio.cs` and `OptionsScreen.cs` would read the same text as **5**.
Two parsers, two answers, same input. The port has `parseFloatStrict` for the
first and `parseFloatInvariant` for the second.

This was caught by the corpus, not by reading the code.

## Behaviour worth knowing

- **`Image` sections survive without an image; `Token` sections do not.** Only
  `TokenDataLoader` drops entries whose image fails to resolve, even though
  `ImageData` extends `TokenData` — the guard lives in the loader, not the type.
- **Equal priority merges rather than replaces.** The entry already stored wins
  and the incoming `sets` are appended to it, which is how one piece of content
  ends up attributed to several packs. Higher priority replaces outright.
- **`traits` keeps empty segments; `items` does not.** `traits` uses
  `Split(' ')` and `items` uses `Split(' ', RemoveEmptyEntries)`, so
  `traits=a  b` yields three entries and `items=a  b` yields two.
- **The image loop settles on the last declared variant when none resolve.**
  `image`, `image2`, `image3` are tried in order and the first that resolves
  wins; if none do, the field ends as `""`.
- **A `pps` value starting with `*` is a multiplier** of the game type's tile
  scale rather than an absolute pixel count.
- **Registry buckets are keyed by exact type.** `TokenData` and `ImageData` are
  separate buckets even though one extends the other, matching the C#'s
  `Dictionary<Type, ...>` keying.
- **`icon` is null, not `""`, when a pack declares none** — the C# field is
  simply never assigned.

## API notes

The C#'s generic methods (`Get<T>`, `Values<T>`, `AddContent<T>`) rely on
reified generics that TypeScript does not have, so the content class is passed
explicitly as a type token: `cd.get(HeroData, 'HeroFoo')`. That keeps the same
type safety and the same bucket-per-type semantics.
