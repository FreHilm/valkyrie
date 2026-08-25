# ADR 0001 — Target architecture for the Valkyrie web port

- **Status**: proposed — two decisions need your sign-off (marked ❓)
- **Date**: 2026-08-25, updated the same day after a licensed Mansions of
  Madness install became available
- **Task**: `T-003`

## Context

Valkyrie is a ~41,000-line Unity 2019.4 application that builds for Windows,
macOS, Linux and Android. The port replaces it with one artifact served from a
URL.

This ADR was meant to be agreed **before T-004**. It was not — T-004 through
T-013, T-015, T-020 and T-022 are already done. That is worth stating plainly
rather than pretending the sequence held. In practice the completed work has
made this document better: most of what follows is now backed by measurement
rather than estimate, and the decisions that were genuinely load-bearing
(persistence, no server) were forced early and are already implemented. The
decisions still open are the ones that were never blocking.

## The hard constraint

Imported FFG content is copyrighted. It must never be served from our origin.
That is not a preference; it decides several axes on its own:

- assets are imported **on the user's device** from their own licensed install;
- they stay in **client-side storage** — hundreds of MB per user;
- **no thin client**, no asset streaming, no server-side asset cache;
- **no CDN** for content, only for the app shell.

Everything below is downstream of this.

---

## Decisions

### 1. Language and build tooling — **decided, implemented**

TypeScript, npm workspaces, `tsc` project references, vitest, ESLint (typed),
Prettier. Strict compiler settings including `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes`.

`@valkyrie/core` compiles with `"lib": ["ES2022"]` and `"types": []`, so a
stray `document` or `fs` reference fails the build rather than quietly coupling
the engine to a host. `@valkyrie/platform` is the host-facing half.

**Bundler**: none yet, because there is no app package yet. ❓ **Recommend
Vite** when `T-016` starts — it handles the worker and WASM cases the importer
will need, and its dev server matters for a UI rewrite of this size.

**Why this over the alternatives**: the port's correctness bar is behavioural
equivalence with the C#, and that is enforced by eight differential harnesses
that compile the original C# and diff it against the port over ~130,000 cases.
That approach needs a language that can express the original's exact semantics
— float32 arithmetic, int32 overflow, `.NET` number parsing. It is the reason
the port has found real bugs in the shipped app rather than merely
reimplementing it.

### 2. UI approach — **DOM/CSS, with the board on a canvas** ❓

Menus, dialogs, the quest log, and the whole editor in DOM and CSS. The board
on its own canvas layer.

The current UI is ~8,900 lines of `UIElement`/`UIScaler` code that reimplements
text layout, wrapping, scaling and hit-testing on top of Unity sprites.
`UIScaler` is a virtual-unit system — 30 rows of units, pixels-per-unit derived
from the viewport — which maps onto a CSS custom property almost exactly. The
browser already does the rest, accessibly and with text selection, keyboard
navigation and screen-reader support that the Unity build does not have.

The editor is another ~9,000 lines and is almost entirely forms. It should be
DOM without qualification.

### 3. Board rendering — **Canvas2D** ❓

**The premise in the task notes is wrong, and this is the most useful finding
in this document.** The notes say the board is a "tilted board canvas" needing
a perspective transform, and recommend CSS 3D on that basis.

Measured instead: `Game.unity` sets the camera to `orthographic: 0`, field of
view 60 — but with `m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}`, looking
straight down −Z at a flat plane, and `CameraController.cs` contains **no
rotation code at all**; it only pans in x/y and zooms in z.

A perspective camera pointed head-on at a plane is visually identical to an
orthographic one. **There is no tilt.** The board is a flat, pan-and-zoom 2D
scene of sprites.

That removes the reason to reach for CSS 3D or WebGL. Canvas2D draws sprites
with a pan/zoom transform natively, and the sprite counts here — tiles, tokens,
monsters — are in the hundreds, not the thousands.

**Rejected**: WebGL, as unjustified complexity at this sprite count, and a
second shader-shaped thing to maintain. Revisit only if profiling on a low-end
Android tablet says otherwise. **Rejected**: DOM elements per tile, because
pan/zoom over hundreds of transformed images is where DOM stops being cheap.

### 4. Where the FFG importer runs — **client-side, in a worker** — **decided, implemented, verified**

Forced by the licensing constraint. The user points the app at their own
Descent or Mansions of Madness install; nothing leaves the device.

In a **Web Worker**, so decoding hundreds of megabytes of textures does not
freeze the tab. The precedent is already set: `fflate`'s async API spawns a
real worker for inflate, so archive extraction is already off the main thread.

**Now built and verified** against a real Mansions of Madness 2.1.6 install
(Unity 2022.3.62f2): 936 of 936 objects extracted byte-identical to AssetStudio,
468 textures decoded pixel-exact against Pillow, 173 of 174 audio streams
byte-identical to `FSBExport` and all of them decoding cleanly under ffmpeg. A
full import takes 43 seconds and produces 69.8 MB from a 702 MB install.

**What is still open is narrower than it was**: the extraction is proven, but
the _gesture that hands it the files_ is not. `showDirectoryPicker` exists in
Chromium and not in Firefox or Safari, and Android has no accessible install
directory. That is now purely a browser-matrix question — decision 3 — rather
than an unknown about the import itself.

**One finding changes what "done" means here.** MoM 2.1.6 downloads its game
content on first run and caches it _outside_ the install — on macOS,
`~/Library/Caches/com.fantasyflightgames.mom`, 413 MB of UnityFS AssetBundles
holding the scenarios and the `Localization_*` text. `FetchContent` looks only
inside the install and cannot read bundles, so **the shipped Unity importer is
already broken against current builds**, not just the port.

The fix is small: look in the cache directory, and read the `UnityFS`
container. All 38 bundles are uncompressed, so no decompressor is needed and
the inner file goes through the existing reader unchanged. See
`docs/ffg-import.md`.

### 5. Texture storage format — **decided by measurement: WebP, lossy or lossless by source**

**This ADR's earlier recommendation of "PNG first" was wrong, and the
measurement says so.** PNG is not competitive, and the right answer depends on
what the pixels came from.

Measured across 468 real textures:

| source                  | count |  as DDS | WebP lossless |    WebP q90 |
| ----------------------- | ----: | ------: | ------------: | ----------: |
| DXT1 / DXT5             |   398 | 68.4 MB |       51.5 MB | **15.5 MB** |
| RGBA32 / RGB24 / Alpha8 |    70 | 64.3 MB |    **6.3 MB** |      3.2 MB |

- **Block-compressed sources get lossy WebP (q90).** DXT is itself lossy, so
  encoding its output losslessly spends 3.3x the bytes preserving
  block-compression artefacts. On the largest map tiles lossless WebP is
  _larger than the source_.
- **Uncompressed sources stay lossless.** They are UI art, icons and SDF font
  atlases; going lossy would save ~3 MB and visibly damage the atlases.

PNG for everything would be 83.8 MB against a combined 21.8 MB. A full MoM
import is **69.8 MB** including audio.

**Also corrected: there is no PVR.** Both this ADR and the task notes assumed
DDS _and_ PVR. PVR is the mobile build's format; a desktop install has none.
An Android import would need it, and nothing here can verify that path.

### 6. Persistence — **OPFS primary, IndexedDB for small structured state** — **decided, implemented**

Built in `T-011` and in use since:

- **OPFS** for content packs, imported assets, quests and saves — files, often
  large, addressed by path. A `FileSystem` interface with three
  implementations: OPFS for the browser, an in-memory one for tests, and a
  sandboxed Node one for tooling. The same code runs in all three.
- **IndexedDB** for small structured records that want querying rather than
  paths. Not yet needed; `config.ini` is a file and stays one.
- **`localStorage` for nothing.** Synchronous, tiny, and string-only.

`requestPersistence()` is called before an import, because eviction under
storage pressure would silently destroy an hour of a user's setup.

**Verified rather than assumed**: the differential harness for localised file
resolution found the in-memory filesystem disagreeing with a real one about
`./` segments and trailing separators — bugs that would have surfaced only in a
browser, on real scenario content.

### 7. Server component — **none** — **decided, verified**

The app is static files. Content comes straight from GitHub, as it already
does.

**Verified against the live hosts** rather than assumed (`T-013`): both game
manifests and all three real content packs answer with
`access-control-allow-origin: *` and `accept-ranges: bytes`. A 13.8 MB download
was cut partway and resumed via a `Range` request, byte-identical to the same
file fetched whole.

❓ **The risk that comes with it**: the port depends on GitHub continuing to
serve permissive CORS from `raw.githubusercontent.com`. A browser cannot work
around a missing CORS header. If that changes, the remedies are a proxy or a
mirror — both infrastructure decisions, neither a code change.
`tools/differential/remote/live-check.mjs` re-tests the assumption on demand so
it fails loudly rather than silently.

---

## Rejected alternatives

**Unity WebGL build.** The obvious "port" and the wrong one. It would ship a
~40 MB engine runtime before any content, keep every existing constraint
(`Application.Quit()` inside a parser, `Environment.NewLine` in the save
format, `float.TryParse` under the machine locale), and hand us no way to fix
them. It would not give text selection, keyboard navigation or screen-reader
support. And it would leave the C# codebase's real defects in place — the
differential work has already turned up a locale bug that silently mutes audio,
an unguarded zip traversal in three of four extract modes, an int32 overflow in
the Android version code, and a save that becomes unopenable if its timestamp
is malformed.

**A thin client streaming assets from a server.** Forbidden by the licensing
constraint.

**Rewriting in another language (Rust/WASM).** Would break the differential
method, which is the port's entire quality argument.

**Keeping the vendored Ogg Vorbis encoder.** 26,669 lines carried for header
construction and page framing it never uses for encoding. Replaced by ~200
lines, verified byte-identical against the original across 4,180 cases.

---

## Decisions that need you

Two. Two more were settled on 2026-08-25, and are recorded below.

1. ❓ **Browser matrix.** The only thing gating the importer, and the sharpest
   of these. It decides whether Safari needs a WASM Ogg Vorbis decoder, and —
   more importantly — whether Firefox and Safari users can reach their install
   directory at all, since `showDirectoryPicker` is Chromium-only. If they
   cannot, those browsers get community scenarios only.
   _Recommendation: Chromium first class; Firefox and Safari for community
   content; decided by your users' actual browsers rather than by principle._
2. ❓ **Board renderer: Canvas2D**, on the evidence in §3. Now built and
   working under `T-017`, so this is a confirmation rather than a choice.

### Settled 2026-08-25

**Saves do not interoperate with the Unity build.** The port serialises what is
correct rather than what is compatible: the defect at `Quest.cs:2699` — random
hero selection not surviving save/load or undo — is **fixed**, not reproduced,
and the save format is free to diverge from `Environment.NewLine` and the rest.

**Quest files remain compatible**, and that distinction is the point. A save is
one player's state; a quest is shared community content that lives in a git
repository and is opened by both editors. `T-019` verifies the round-trip over
103 real quest files, and that stays a requirement.

**This effectively answers "replace or ship alongside" in favour of replace.**
Without save interoperability a player cannot move between builds mid-campaign,
so the two are separate products from the day the port ships. Combined with a
parity editor (`T-019`), the intent is that the web port becomes the tool
rather than a second one. Worth being explicit, because it changes what
"finished" means: the port has to cover what the Unity build covers before it
can replace it.

## Consequences

- `T-017` is unblocked by decision 4.
- `T-001`, `T-002` and `T-014` are **done** and verified against a real
  install. Decision 3 still shapes who can _use_ the importer, and the
  MonoBehaviour localisation gap is outstanding work for both builds.
- If decision 1 comes back "replace", decision 2 stops mattering and the
  `Environment.NewLine` divergence can be resolved in the port's favour.
