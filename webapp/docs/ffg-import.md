# FFG asset import — what the licensed install actually contains

Covers `T-001`, `T-002` and `T-014`. Replaces `libraries/FFGAppImport` — 110
files of AssetStudio plus a driver.

Everything here was measured against a real **Mansions of Madness 2.1.6**
install, built with **Unity 2022.3.62f2**. Nothing in this document is
extrapolated from reading the C#.

## Where the content goes, and where it does not

The install is licensed to its owner, not to us. So:

- extraction runs **on the user's device**, never on a server;
- extracted assets live in a cache **outside the repository** — during this
  work, `~/.cache/valkyrie-web-port/ffg/`;
- **nothing derived from the game is committed.** The repository holds only
  tooling: a probe, a generator, and the port itself.

The one derived artefact that _is_ committed is
`packages/platform/src/vorbisSetupHeaders.ts`, and it comes from Valkyrie's own
`OggVorbisHeader.cs`, not from FFG content.

## What is in there

| Class       | Count | Notes                                              |
| ----------- | ----: | -------------------------------------------------- |
| `Texture2D` |   733 | DXT5 355, DXT1 300, RGBA32 66, Alpha8 8, RGB24 4   |
| `AudioClip` |   174 | every one Vorbis, in FSB5 containers               |
| `TextAsset` |    29 | launcher and store strings — **not** the game text |

**No PVR.** The task notes and the ADR both expected DDS _and_ PVR. PVR is the
mobile build's format; a desktop install has none, so that path is not
implemented. It would be needed for an Android import.

## The finding that matters most: the content has moved out of the install

`GameSelectionScreen.loadLocalization` builds the `ffg` dictionary from
`{import}/text/Localization_*.txt`, which the importer writes from TextAssets
named `Localization_*`.

**MoM 2.1.6's install contains no such TextAsset.** Its 29 are `SSO-*`,
`Standard-*` and `CommunityHub-*` — XLIFF for the launcher, keyed by numeric
ids. Searching the whole app bundle for a display string such as
`Agnes Baker` returns nothing.

**The game content is downloaded on first run and cached outside the install.**
On macOS it lands in `~/Library/Caches/com.fantasyflightgames.mom` — 413 MB
across 38 UnityFS AssetBundles, holding scenarios, DLC, audio and, in
`Localization_*` TextAssets, the text:

```
Localization_en.txt   1,108,106 bytes   6,791 lines
  KEY,English
  INVESTIGATOR_AGNES_BAKER,Agnes Baker
  ATTACK_BLADED_VS_BEAST_01,"You throw the full force of your weight beh…
```

That is exactly the `KEY,English` CSV shape `DictionaryI18n` reads, under
exactly the filename pattern the importer looks for. All 14 shipped languages
are present.

### What this means

**The shipped Valkyrie importer is broken against current MoM builds** — it
looks only inside the install and cannot read AssetBundles, so it finds none of
this. That is a real break, and it predates the port.

**Both are now done** (`T-023`): the importer reads the cache alongside the
install, and reads the `UnityFS` container.

One measurement here was wrong first time and is worth recording. The archive
header says `flags 0xc0` — uncompressed — but that describes the _block list_,
not the block _data_. The storage blocks are **LZ4**: 5,373 of them against 770
uncompressed. So an LZ4 decompressor was needed after all. The port has one, in
`lz4.ts`, about fifty lines, verified over every block in the cache.

MoM base content references **3,725 distinct `{ffg:…}` keys**. After the fix,
**3,723 of them resolve.**

### A correction

An earlier version of this document said the localisation had moved into
MonoBehaviour ScriptableObjects and would need a type-tree database to
recover. That was wrong. The MonoBehaviour objects in `sharedassets0.assets`
hold _key names only_ — the object containing `INVESTIGATOR_AGNES_BAKER` is
112 bytes and carries no text. The strings were never in the install at all;
they are in the downloaded bundles.

The XOR deobfuscation is ported and tested regardless — older MoM builds use
it, and `looksObfuscated` correctly leaves the modern plain-text assets alone.

## T-001: texture storage, decided by measurement

The ADR recommended "PNG first". The measurement says otherwise, and the answer
turns out to depend on where the pixels came from:

| source                  | count |  as DDS | WebP lossless |    WebP q90 |
| ----------------------- | ----: | ------: | ------------: | ----------: |
| DXT1 / DXT5             |   398 | 68.4 MB |       51.5 MB | **15.5 MB** |
| RGBA32 / RGB24 / Alpha8 |    70 | 64.3 MB |    **6.3 MB** |      3.2 MB |

- **Block-compressed sources get lossy WebP (q90).** DXT is _itself_ lossy, so
  encoding its output losslessly spends 3.3x the bytes faithfully preserving
  block-compression artefacts. On the largest map tiles lossless WebP comes out
  **larger than the source**.
- **Uncompressed sources stay lossless.** They are UI art, icons and SDF font
  atlases — flat colour that already compresses to under a tenth of source.
  Going lossy would save about 3 MB and visibly damage the SDF atlases, which
  is a bad trade.

PNG was never competitive: 83.8 MB against WebP's combined 21.8 MB.

**A full import of MoM produces 69.8 MB** — 55 MB of images, 14 MB of audio,
212 kB of text — from a 702 MB install, in 43 seconds.

## T-002: where the importer runs

Client-side, as the licensing constraint requires. The pieces:

- **`unityAssets.ts`** reads Unity `SerializedFile` archives. AssetStudio reads
  every Unity class there has ever been; the import needs three, so this is a
  few hundred lines instead of tens of thousands.
- **`dds.ts`** decodes DXT1, DXT5 and the uncompressed formats to RGBA.
- **`fsb.ts`** rebuilds FSB5 Vorbis into playable Ogg, using the muxer verified
  in T-020.
- **`ffgImport.ts`** drives it and writes the `{import}` layout.

**Still unverified: whether a browser can reach the install directory.**
`showDirectoryPicker` exists in Chromium but not Firefox or Safari, and Android
has no accessible install directory. That is a browser-matrix question and
belongs with the ADR's decision 3 — the extraction itself is now proven, but
the user gesture that hands it the files is not.

## How each piece was verified

Four harnesses, all against the real install, all skipping cleanly when no
install is present so CI stays offline:

| harness                       | ground truth   | result                                              |
| ----------------------------- | -------------- | --------------------------------------------------- |
| `differential/unity`          | AssetStudio    | **936 of 936 objects** byte-identical               |
| `differential/unity` (pixels) | the DDS path   | **459 textures** agree across two independent paths |
| `differential/dds`            | Pillow         | **468 textures** pixel-exact                        |
| `differential/fsb`            | `FSBExport.cs` | **173 of 174 streams** byte-identical               |

Every produced `.ogg` was then decoded end to end by ffmpeg: **173 of 173**
clean, not merely header-valid.

### Mutation testing, and two gaps it exposed

Deliberate bugs were introduced to check the harnesses actually bite. Most were
caught — a wrong stream-offset width broke 720 of 936 objects, a dropped 5-bit
expansion broke 398 of 468 textures. Two were **not**, and both were corpus
gaps rather than dead code:

- **The BC1 mode comparison** (`c0 > c1` vs `>=`). No texture in 468 pairs
  equal endpoints _with_ the punch-through index, so the branch never showed.
- **An alignment after `m_StreamingMipmaps`.** Every texture in the install
  happens to already sit on a boundary.

Both are now pinned by synthetic unit tests, which do fail when the mutation is
applied. Without the mutation pass, both would have looked verified.

## Defects found in the shipped Unity app

1. **`FSBExport` writes a corrupt, undecodable `.ogg`** when a stream's setup
   header CRC is not one of the three it knows. It does not report anything —
   `GetHeader` returns null and the file is written anyway. Confirmed with
   ffmpeg on the real `Barricade_02` stream: _"Header processing failed:
   Invalid data found."_ The user discovers it when the sound is silent. The
   port refuses and reports instead.
2. **The content-location gap** above: the importer looks only inside the
   install, so against a current MoM build it recovers no game text at all.
3. **`Deobfuscate` drops a trailing partial group.** When the payload length is
   not a multiple of four, the final group is never written and comes out as
   zeros. Reproduced deliberately — the shipped files are parsed on that basis.

## Deviation: no DDS round trip

`FetchContent.ExportTexture` writes a DDS file, and to satisfy DDS's BGRA
convention it **mutates the pixel data in place**, swapping R and B for RGB24,
RGBA32 and BGRA32. Unity then reads that file back.

The port decodes Unity's payload straight to RGBA, so both the swizzle and the
round trip disappear. `differential/unity` applies the same swizzle when
comparing, so the check stays byte-exact rather than being relaxed.

`decodeDds` is kept regardless: it reads the files the Unity build already
produced, so an existing import stays readable.

## Not done

- **PVR / ETC formats**, for an Android import. No desktop install contains
  them, so there is nothing here to verify against.
- **LZMA and LZHAM bundle compression.** No bundle measured uses either, so a
  decompressor would have nothing to verify it. Named in the error instead.
- **D2E**, which is not installed here. The code paths are shared and the
  version-branch and unobfuscated-text paths are covered by synthetic tests,
  but no D2E install has been read.

## The two keys that still do not resolve

`MONSTER_HUNTING_DEEP_ONE_ATTACK_2` and `MONSTER_HUNTING_DEEP_ONE_MOVE_2`, both
referenced by `content/MoM/base/activations.ini`.

They are absent from **every** language file in MoM 2.1.6, not just English —
so this is Valkyrie content that has drifted from the app, not an import
failure. The Unity build would render those two Deep One activation lines as
raw keys too, given a current install.

## What a full import produces now

Reading the install and the cache together:

```
1,146 textures    245 audio    350 text     289.2 MB     117s
```

against 726 / 173 / 29 and 69.8 MB from the install alone — the difference is
the downloaded scenario content.

**99 audio streams are skipped**, all with the same cause: their Vorbis setup
header is not one of the three `OggVorbisHeader.cs` carries. That is the same
limit the Unity build has, except it writes an undecodable file rather than
saying so. Most of them are scenario voice-over. Recovering them means either
finding more setup headers or reconstructing them from the codec parameters,
and neither is attempted here.
