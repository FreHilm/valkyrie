# Audio — verified behaviour and deviations

Covers `T-020`. Targets `unity/Assets/Scripts/Audio.cs`, and answers the
question the task notes raise about `FSBExport.cs` and the vendored Ogg Vorbis
encoder.

## The headline: 26,669 lines of vendored encoder are not needed

The task asked whether the `.NET Ogg Vorbis Encoder` under
`libraries/FFGAppImport/AssetImport/oggencoder/` (379 files, 26,669 lines) has
to be carried into the web port. It does not, and this is now demonstrated
rather than argued.

**`FSBExport` never encodes any audio.** FSB5 stores Vorbis packets with their
three headers stripped; the audio packets are copied through verbatim
(`stream.ReadBytes(packetSize)`). The encoder is used for exactly three things:

1. building the Vorbis identification header (`BuildInfoPacket`),
2. building the comment header (`BuildCommentsPacket`),
3. Ogg page framing (`OggStream`, `OggPacket`, `OggPage`).

The setup header is not built at all: `OggVorbisHeader.cs` holds **three fixed
blobs looked up by CRC** — 590 lines of data, not code — and the source
comments "Only support header CRC 3605052372 for now".

`packages/platform/src/ogg.ts` replaces all three functions in **~200 lines**.

### How that is established

`tools/differential/ogg` compiles the vendored encoder **unmodified** and drives
it exactly as `FSBExport.WriteFile` does, then compares the resulting bytes
against the port.

**0 divergences, byte for byte, across 5 seeds × 836 cases (4,180 total).**

A byte-identical pass on the first run is the kind of result worth distrusting,
so the harness was mutation-tested. Each of these was introduced into the port
and the harness caught every one, at exactly the right offset:

| mutation                                  | caught at byte | which is             |
| ----------------------------------------- | -------------- | -------------------- |
| CRC polynomial `0x04c11db7` → `…db6`      | 22             | the page checksum    |
| beginning-of-stream flag never set        | 5              | the header flags     |
| identification-page granule `0` → `1`     | 6              | the granule position |
| lacing `trunc(n/255 + 1)` → `ceil(n/255)` | 6459           | the segment table    |

The last one fired on only 1 of 86 cases — the packet that is an exact multiple
of 255 — which is why the corpus carries 254/255/256/510/765-byte packets
deliberately.

**This also found a real problem with the harnesses.** They imported
`@valkyrie/platform`, which resolves to the built `dist/`, so the first
mutation run reported no failures at all: it was testing yesterday's output.
The `ogg`, `multimedia` and `remote` harnesses now import source paths
directly. Without the negative control this would not have been noticed, and
the harnesses would have looked healthy while validating stale code.

### Deviation in the header builders

The C# writes `comment.Length` — a UTF-16 code-unit count — as the byte length
of a comment. For the ASCII `LOOP_START=…` tags `FSBExport` emits, the two
agree; for any non-ASCII comment the C# writes a wrong length and produces a
corrupt header. The port measures UTF-8 bytes.

### What is still unknown

Whether the produced files actually play. That needs real FFG assets to run
`FSBExport` end to end, which is `T-002`/`T-014` and blocked on the licensed
app files. What is settled is that the port's muxer and the original's produce
**the same bytes**, so whatever one yields the other will too.

## Audio.cs deviations

### 1. Volume is parsed invariantly

`Audio.Start` reads `UserConfig/music` and `UserConfig/effects` with
`float.TryParse` under the machine culture. On a locale where the decimal
separator is a comma, a stored `0.8` fails to parse and `TryParse` leaves the
value at **0** — the app comes up silent while the slider still shows 80%. The
same defect as the one in `ini-port-deviations.md`, in a second place.

Volume keeps float32 precision, because the C# field is a `float`: `0.8` really
is `0.800000011920929` on both sides.

### 2. Playback survives the autoplay policy

A browser `AudioContext` starts suspended until a user gesture. Music requested
before then is **held, not dropped**, so a quest that starts music during its
opening event is not silent for the rest of the session; `unlock()` starts it.
Unity had no equivalent constraint.

### 3. A playlist of unplayable files gives up

`UpdateMusic` wraps the playlist index at the end of the list. The port's first
version reproduced that, and a playlist where _no_ track could be decoded
wrapped forever — infinite recursion, taking the tab down. It now stops after
one pass. The C# does not have this failure because a failed
`UnityWebRequest` simply never adds the clip, leaving the list shorter.

### 4. The fade is a scheduled ramp

`FixedUpdate` subtracts `0.01` from the volume each tick, reaching zero after
50 ticks — one second at the default 0.02s step, but tied to the physics rate.
The port schedules a one-second linear ramp, which is both frame-rate
independent and off the main thread.

### 5. A superseded playlist cannot advance the current one

The C# guards concurrent `PlayMusic` calls with a `fetchingMusic` flag and a
`yield` loop. The port uses a generation counter, so a track that finishes
after its playlist was replaced cannot advance the new one. There is a test for
exactly that.

## Behaviour preserved

- **Two independent channels** with separate volumes, matching the two
  `AudioSource` objects.
- **The default-quest-music fallback**: when the current playlist runs out, it
  is replaced by the default quest music if any was set, so event music plays
  once and hands back.
- **`PlayTrait` picks one file at random** from those carrying the trait; the
  random source is injectable so it is testable.
- **An empty effect filename does nothing**, matching `if (file.Length > 0)`.
- **A missing or undecodable file logs and continues** rather than stopping
  playback.

## Not done — blocked

- **Imported FFG audio playing** cannot be verified without the licensed app
  files (`T-002`/`T-014`). The muxer half is done and verified; the FSB parsing
  half needs `AssetStudio` and real archives.
- **The Safari question** the notes raise stays open: Safari's Ogg Vorbis
  support depends on the OS version, and the target browser matrix is a `T-003`
  decision. If Safari has to be supported without native Vorbis, a WASM decoder
  is the fallback, and that belongs in the ADR rather than here.
