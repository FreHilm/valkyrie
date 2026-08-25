# Remote content packs — verified behaviour and deviations

Covers `T-013`. The port targets `RemoteContentPack.cs`,
`RemoteContentPackManager.cs`, `HTTPManager.cs` and the download half of
`QuestAndContentPackDownload.cs`.

## What was measured

`RemoteContentPack.cs` compiles outside Unity with three small shims, so
`tools/differential/remote` runs the unmodified source against the port over
curated cases, generated fuzz, and the **two real manifests** fetched from
`valkyrie-store`.

**0 real divergences across 4 seeds × 3,033 cases.** One case is classified
separately, below.

The network half cannot be settled by a harness, so
`tools/differential/remote/live-check.mjs` checks the real hosts. It is opt-in
— CI stays offline. Last run, all checks passed:

```
D2E / MoM manifests    reachable, access-control-allow-origin: *
DooM  13,821,056 bytes  ACAO *, accept-ranges: bytes
D1ED  11,627,873 bytes  ACAO *, accept-ranges: bytes
SOTP   1,215,096 bytes  ACAO *, accept-ranges: bytes
DooM resumes after a dropped connection   13821056 vs 13821056 bytes
```

The last line is the one worth having: a real 13.8 MB download was cut partway
and resumed through a `Range` request, and the result was byte-identical to the
same file fetched whole.

End to end, against the live host: manifest → download → extract → the T-007
content parser reads the result. The real SOTP pack yields 34 files and parses
as `Sands of the Past Content Pack` / `D2ECustom` with 6 ini files.

## CORS — the risk the task asked to confirm first

Confirmed, and it holds today on both hosts, for manifests and packages alike.
It is worth being precise about what that means: **the port depends on GitHub
continuing to serve `access-control-allow-origin: *` from
`raw.githubusercontent.com`**, and there is no fallback if that changes. A
browser cannot work around a missing CORS header; the only remedies are a proxy
or a mirror, both of which are infrastructure decisions rather than code ones.
`live-check.mjs` exists so the assumption is re-testable rather than assumed,
and this belongs in the ADR (`T-003`).

## Deviations

### 1. `latest_update` is read as UTC, and ambiguous dates are refused

The C# calls `DateTime.TryParse` with the **current culture** and no styles.
`culture-probe.mjs` measures what that does to the same manifest value:

| value                  | en-US / UTC | de-DE / UTC    | en-US / New York  | de-DE / Berlin    |
| ---------------------- | ----------- | -------------- | ----------------- | ----------------- |
| `07/03/2026`           | 2026-07-03  | **2026-03-07** | 2026-07-03T04:00Z | 2026-03-06T23:00Z |
| `2026-03-07`           | 2026-03-07  | 2026-03-07     | 2026-03-07T05:00Z | 2026-03-06T23:00Z |
| `2026-03-07T05:32:25Z` | same        | same           | same              | same              |

A slash date lands **four months apart** depending on the reader's machine, and
a zone-less date shifts by the machine's offset. There is no single C#
behaviour to match, so the port picks a defined one: ISO 8601 shapes are read
as UTC, and anything ambiguous leaves the field unset, exactly as a failed
`TryParse` does.

In practice both real manifests use the `Z` form throughout — the only shape
that is stable across all of the setups above — so the shipped app is
consistent today by the manifest authors' good luck rather than by design.

### 2. Installed content stays listed when the manifest cannot be fetched

`RemoteContentPackDownload_callback` sets an error mode and leaves
`remote_RemoteContentPack_data` empty, so a user with no network sees an empty
list even for packs already on disk. The port falls back to the local manifest
and reports `LOCAL`, keeping installed content listed and playable.
`ERROR_DOWNLOAD` is now reserved for "offline _and_ nothing installed".

### 3. The local manifest is written field by field

`SetContentPackAvailability` serialises the pack with `ToString()` and re-parses
that text to get a section. `RemoteContentPack.ToString()` has two defects:

- it writes `type=` **twice**, the second time with the game type rather than
  the pack type, so the parsed section keeps whichever wins;
- it reads `image.Length` unguarded, which throws `NullReferenceException` for
  any pack whose manifest entry has no `image` key.

The port writes the fields directly and omits `image` when there is none.

### 4. Downloads stream, resume and can be cancelled

`QuestAndContentPackDownload` buffers the whole response in a
`UnityWebRequest`, writes it with a `BinaryWriter`, and cannot be cancelled or
resumed. The port streams the response straight into the extractor, reports
progress, takes an `AbortSignal`, and resumes a dropped transfer with a `Range`
request.

One correctness point that the tests pin: when a server **ignores** the range
and resends the whole body, the already-delivered prefix is skipped rather than
re-emitted. Yielding it again would silently duplicate those bytes in the
caller's output — the first implementation did exactly that, and the test that
caught it also covers the case where the repeat is chunked differently, so the
boundary falls inside a chunk.

### 5. Errors keep the network/HTTP split

`UnityWebRequest` distinguishes `isNetworkError` from `isHttpError` and the UI
says different things for each. `NetworkError` and `HttpError` preserve that;
`HttpError` carries the status code, which the C# only ever stringified.

## Behaviour preserved

- **The default-language guard.** `Populate` only fills `languages_name` if
  `name.English` is present, so a pack translated into German but not English
  ends up with _no_ names and an empty title. It looks like a bug and it is
  reproduced, because the manifests are authored against it. The same guard
  applies independently to descriptions.
- **`GetTitle` / `GetDescription` order**: user language, then the default,
  then whatever came first, then `""`.
- **The `image` backslash rewrite**, and `image` staying null when absent.
- **`type`, `version` and `url` defaulting to `""`**, and `valid` always true —
  `Populate` returns `true` unconditionally.
- **Package URL composition**: `url` + identifier + `.valkyrieContentPack`.
  The manifest's `url` is a directory, not a file.
- **Update detection** compares the manifest `version` string against the one
  recorded locally, with no version ordering — any difference counts.

## Not ported

`RemoteContentPackManager.GetList(sortOrder)` reads eight `SortedList` fields
that are only ever populated by `SortRemoteContentPacks`, which is **entirely
commented out** (`RemoteContentPackManager.cs:370-...`). Every one of them is
permanently null, so `GetList` throws `NullReferenceException` for any sort
order. The sorting it describes depends on `game.stats`, which is a separate
subsystem. The port exposes `installed()` and `updatable()`; ordering for the
selection screen belongs with the UI work in `T-016`–`T-018`, against a
`stats` port that does not exist yet.
