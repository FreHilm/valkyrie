# INI and config port — verified behaviour and deviations

Covers `T-005`. The port targets `libraries/ValkyrieTools/IniRead.cs` and
`unity/Assets/Scripts/ConfigFile.cs`.

Hundreds of published community scenarios are written against the C# parser's
exact behaviour, including the parts that look like bugs, so this port was
verified by **differential testing against the real C# code** rather than by
reading it and hoping.

## How it was verified

A harness compiles the unmodified `IniRead.cs` (with a 20-line `ValkyrieDebug`
stub in place of the Unity dependency) and runs it over a shared corpus, then
the same corpus goes through the TypeScript port and the outputs are diffed
structurally — section order, key order, values, and thrown exceptions.

Reproduce with `webapp/tools/differential/run.sh` (needs the `dotnet` SDK).

| Corpus                                                                         |  Cases | Real divergences |
| ------------------------------------------------------------------------------ | -----: | ---------------: |
| Hand-written edge cases                                                        |     59 |                0 |
| Fuzz, random INI-ish documents                                                 |  4,000 |                0 |
| Fuzz, whitespace-only lines suppressed                                         |  8,000 |                0 |
| **Every `.ini` file shipped in `StreamingAssets/content`** (236 files, 719 KB) |    472 |                0 |
| Number parsing, hand-written                                                   |     73 |                0 |
| Number parsing, fuzz                                                           | 31,000 |                0 |

"Real divergence" means the two implementations both produced a result and
disagreed. The only differences found were the two deviations below, in which
the C# throws and the port does not.

The fuzz run had to be repeated with whitespace-only lines suppressed: a C#
crash aborts the whole document, so those cases were comparing nothing beyond
the first bad line.

## Deviations from the C# behaviour

### 1. Whitespace-only lines no longer crash the parser

`IniRead.cs` evaluates `l.Trim()[0]` guarded only by `l.Length > 0`. A line
that is non-empty but blank once trimmed — `"   "`, a lone tab — makes
`l.Trim()` return `""` and the indexer throws `IndexOutOfRangeException`.

`ReadFromString` splits with `RemoveEmptyEntries`, which drops zero-length
lines but not whitespace-only ones, so the crash is reachable from ordinary
content. **A single line containing only spaces aborts the load of that file.**

The port skips such lines. No existing content can depend on the old behaviour,
because the old behaviour was an unhandled exception.

None of the 236 shipped `.ini` files trigger this today.

### 2. Duplicate valueless keys no longer throw in the section reader

The three-argument `ReadFromStringArray(lines, path, section)` overload — used
by `QuestData.cs:2164`, `QuestData.cs:2181` and `ZipManager.cs:165` to read the
`[Quest]` and `[QuestText]` sections — calls `entryData.Add(...)` unguarded for
keys with no `=`. A repeated valueless key throws `ArgumentException`.

Every other duplicate in this parser is resolved first-wins with a warning, so
the port does that here too.

### 3. `IniData.toString()` always emits `\n`

The C# used `System.Environment.NewLine`, making output platform-dependent. A
single web artifact serving every platform cannot be.

## Behaviour deliberately preserved

These all look like bugs and are all kept, because content depends on them:

- **First occurrence wins** for duplicate sections and duplicate keys.
- **Data before the first section header is parsed, then silently dropped.**
- **Section names are trimmed of all leading and trailing brackets**, so
  `[[Nested]]` is `Nested` and the unterminated `[Unterminated` is accepted.
- **Values are trimmed of whitespace, then of quotes, with no second whitespace
  pass** — so `key=  " padded "` keeps its inner spaces.
- **Quote stripping is greedy and independent per end**: `""doubled""` yields
  `doubled`, and `"unbalanced` yields `unbalanced`.
- **Only the first `=` splits** a line, so values may contain `=`.
- In the section reader, **a header only ends the section if its `[` is at
  column 0** — an indented `[X]` is treated as data.

## The locale bug this port fixes

Not a parser issue, but it is why `parse.ts` exists.

The Unity code reads floats with the **current culture**:

```csharp
float.TryParse(vSet, out musicVolume);   // Audio.cs:25, Audio.cs:37
float.TryParse(vSet, out mVolume);       // OptionsScreen.cs:228, :286
float.TryParse(vSet, out editorTransparency); // Game.cs:218
```

and writes them the same way, via `musicSlide.value.ToString()`
(`OptionsScreen.cs:454`, `:463`, `:472`, `:480`).

Measured against .NET:

| Culture | `float.TryParse("0.5")` | `(0.5f).ToString()` |
| ------- | ----------------------- | ------------------- |
| en-US   | `true`, `0.5`           | `"0.5"`             |
| de-DE   | `true`, **`5`**         | `"0,5"`             |
| sv-SE   | **`false`, `0`**        | `"0,5"`             |
| fr-FR   | **`false`, `0`**        | `"0,5"`             |

Consequences in the shipped app:

- A `config.ini` written on an English machine and read on a **Swedish or
  French** one fails to parse, leaving the volume at `0`. The
  `if (vSet.Length == 0) musicVolume = 1` fallback does not fire, because the
  string is not empty. The result is **silently muted audio with the slider
  showing zero**.
- On **German**, `"0.5"` parses as `5` — the `.` is read as a group separator —
  so the volume is 10× the intended value.
- Config files are not portable between locales, in either direction.

The port parses and formats invariantly. `formatFloatInvariant` is what should
be used on the write side.

## Two whitespace sets, verified not assumed

.NET uses **different whitespace rules** for numbers and for booleans, and
neither matches JavaScript's `String.prototype.trim()`:

| Input                                               | .NET `int`/`float`         | .NET `bool`  | JS `.trim()` strips it? |
| --------------------------------------------------- | -------------------------- | ------------ | ----------------------- |
| `"5\t"`, `"5\n"`, `"5\r"`, `"5\v"`, `"5\f"`, `"5 "` | accepted                   | —            | yes                     |
| `"5 "` (NBSP)                                       | **rejected**               | —            | **yes**                 |
| `"true "`                                           | —                          | **accepted** | yes                     |
| `"NaN "`                                            | **accepted** (symbol path) | —            | yes                     |

So trimming with `.trim()` before parsing a number would wrongly accept
`"5 "`. `parse.ts` keeps the two trims deliberately separate.

`NumberStyles.AllowThousands` is also looser than its name suggests, and this
was pinned by probing rather than guessed:

| Input           | Result                                       |
| --------------- | -------------------------------------------- |
| `"1,000.5"`     | `1000.5`                                     |
| `"1,2,3"`       | `123`                                        |
| `"5,"`, `"5,,"` | `5`                                          |
| `"5,00,"`       | `500`                                        |
| `",5"`, `",,5"` | rejected                                     |
| `"0.5,"`        | rejected (separator after the decimal point) |
| `"1,.5"`        | `1.5`                                        |
| `"1e,3"`        | rejected (separator in the exponent)         |

Separators are allowed only in the integer part, which must itself start with a
digit; placement within it is not validated.

## Scope note

The file-reading entry points (`IniRead.ReadFromIni`) are **not** ported. They
belong to the platform layer, and `@valkyrie/core` compiles with `"lib": ["ES2022"]`
and `"types": []` so that a stray `fs` or `document` reference fails the build.

`ConfigFile` likewise does not read or write `config.ini`. The C# version does
both in its constructor and in `Save()`; the web storage layer (T-011) is
asynchronous, and inventing a synchronous file contract now would prejudge that
decision. The class owns the data and reports changes; the host persists.
