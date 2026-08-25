# Localization port — verified behaviour and deviations

Covers `T-006`. The port targets `DictionaryI18n.cs` (680 lines), `StringKey.cs`
and `LocalizationRead.cs`.

Verified the same way as the INI port: the unmodified C# sources are compiled
against small shims (`UnityEngine.Debug`, `Game`, `ValkyrieConstants`,
`ValkyrieDebug` — no ported logic in any of them) and diffed against the
TypeScript over shared corpora.

Reproduce with `webapp/tools/differential/run.sh`.

| Corpus                                                               | Cases | Real divergences |
| -------------------------------------------------------------------- | ----: | ---------------: |
| Hand-written edge cases                                              |    97 |                0 |
| Fuzz (split, ParseEntry, addData, StringKey)                         | 4,000 |                0 |
| **Every shipped `Localization.*.txt`** — 20 files, 7,119 keys        |    20 |                0 |
| **Cross-language resolution** — all UI languages, 4 fallback configs |    24 |                0 |

The real-content rows are the important ones: each loads a complete shipped
localization file, round-trips it through `addData` + `serializeMultiple`, and
resolves every key it declares. The cross-language rows load _all_ UI languages
into one dictionary and resolve every English key under German, Italian with a
German fallback, an absent language with a French fallback, and Japanese.

## Deviations from the C# behaviour

All three are cases where the C# throws.

### 1. `{dict:}` with no key no longer crashes

`StringKey`'s parsing constructor splits `{val:}` into `["val"]` and then
indexes `parts[1]` unguarded, throwing `IndexOutOfRangeException`. The port
treats the input as a literal instead.

### 2. An unterminated `{dict:` no longer crashes

`DictLookup` and `CheckLookup` walk forward looking for the closing brace with
`output[lookupEnd]` and no bounds check, so `{val:KEY` with no `}` reads past
the end of the string. The port stops at the end of the input.

### 3. A language header with no comma throws a typed error

`AddData` reads the language from `languageData[0].Split(',')[1]`, which throws
`IndexOutOfRangeException` on a header like `English` with no comma. The port
throws `RangeError` with a message naming the bad header.

## Behaviour deliberately preserved

Two of these are real defects. They are kept because scenario text in the wild
is written against them, but they are worth fixing in both implementations
together rather than silently diverging here.

### Unclosed markup tags come out improperly nested

`DictLookup` closes unbalanced tags with two independent loops — all `</b>`
first, then all `</i>` — regardless of the order the tags were opened:

```
[b]bold [i]italic   ->   <b>bold <i>italic</b></i>
```

The `<i>` opened last but is closed last too, so the tags interleave. Unity's
rich-text renderer tolerates it; a browser will not necessarily. **Worth
revisiting when T-016 picks a text renderer** — but changing it is a rendering
change for existing content, not a port decision.

### A parameter value containing `:` is silently truncated

Parameters are a flat `find:replace:find:replace` list split on top-level
colons, so a value that itself contains a colon has its tail orphaned and
dropped:

```
{val:PARAM:{0}:a:b}  with  PARAM = "value {0}"   ->   "value a"
```

There is no escape mechanism. Any scenario text substituting a time (`12:30`),
a ratio, or a namespaced id loses everything after the first colon. Verified
against the C#.

### Other quirks kept as-is

- **A parameterised full key does not round-trip.** `StringKey.parse` requires
  the first `}` to be the last character, and `{0}` inside the parameters
  breaks that, so `{val:KEY:{0}:x}` parses back as a literal.
- **First occurrence of a key wins**, per language.
- **A language is only searched once it is required.** Merging a dictionary
  whose language is not current, default or fallback leaves its keys
  unresolvable until one of those changes. Adding a required language discards
  the whole parsed cache so it rebuilds.
- **An empty value resolves to `""`, not to the key.** Every language check
  skips blank values, but the trailing "any match" loop returns it anyway.
- **`[u]` renders as bold**, because Unity has no underline.
- **The recursion limit is 20 expansions**, after which the remaining `{...}`
  text is returned unexpanded.
- **The unterminated tail of a malformed file** is joined with a literal
  `\n` rather than a real newline, unlike every complete entry.

## The CRLF trap, and what the port does about it

`.agent/rules/text-localization.md` warns at length that
`DictionaryI18n.AddDataFromFile` splits on `\r` only when the file contains any
`\r`, so a single `\n`-only line ending merges a key into the previous value —
silently, with the new key vanishing and the previous value gaining garbage.

The port does not reproduce that, because **it does not read files at all**:
`addData` takes already-split lines, and file reading belongs to the platform
layer (T-011).

**Recommendation for that layer:** split on `\r\n | \r | \n` uniformly. That
keeps every existing file readable byte-for-byte — the differential run above
confirms all 20 shipped files parse identically — while removing the failure
mode entirely. The on-disk format does not need to change, and neither does
any content pack.

This is recorded here rather than decided unilaterally, because it is the
`fallbackLanguage`-style question the ADR (T-003) may want to rule on.

## Scope and API notes

`AddDataFromFile` is not ported (platform layer, as above).

`LocalizationRead` is a static class in C#. The port makes it an instance,
`Localization`, with a module-level `defaultLocalization` standing in for the
global so `new StringKey('val', 'KEY').translate()` still works unchanged.
Tests and content-pack loading can use an isolated instance rather than
resetting global state between cases — the C# tests need `Setup`/`TearDown` to
clear `LocalizationRead.dicts` precisely because they cannot.

`StringKey`'s six C# constructors cannot all be expressed as TypeScript
overloads — `(string, string, bool)` and `(string, string, string)` are
ambiguous at the call site. The extra ones became named factories:

| C#                                                     | here                                        |
| ------------------------------------------------------ | ------------------------------------------- |
| `new StringKey(unknownKey)`                            | `StringKey.parse(unknownKey, localization)` |
| `new StringKey(dict, key, doLookup)`                   | unchanged                                   |
| `new StringKey(dict, key, string \| int \| StringKey)` | `StringKey.withParam(...)`                  |
| `new StringKey(template, p1, p2)`                      | `StringKey.fromTemplate(...)`               |

The common call site, `new StringKey('val', 'KEY')`, is unchanged, so the
localization rule in `.agent/rules/text-localization.md` still reads correctly.

## One .NET semantic worth knowing

`Split(char[], count, RemoveEmptyEntries)` drops empty segments **before** the
count applies, and the final element is the raw remainder measured from the
start of the count-th non-empty segment:

| Input (split on `:`, count 3) | Result               |
| ----------------------------- | -------------------- |
| `a::b::c`                     | `["a", "b", "c"]`    |
| `a::b::c::d`                  | `["a", "b", "c::d"]` |
| `:::a:::b:::c`                | `["a", "b", "c"]`    |
| `::`                          | `[]`                 |

The obvious implementation — skip empties while scanning, take the rest on
reaching the limit — gets `a::b::c` right and `a::b::c::d` wrong (`":c::d"`).
The fuzz corpus caught it; the hand-written cases had not.
