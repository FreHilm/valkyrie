# Archive extraction port — verified behaviour and deviations

Covers `T-012`. The port targets `unity/Assets/Scripts/ZipManager.cs`.

These archives are `.valkyrie` packages and content packs downloaded from
other people's GitHub repositories, so the input is untrusted and the
path-traversal guard is the point of the module rather than an afterthought.

## What was measured

`ZipSlipTests.cs` covers one case: `EXTRACT_FULL` blocking `../evil.txt`. The
port passes it, and extends the guard to the three selective modes the C#
leaves unchecked.

To find out what actually happens today rather than infer it, the selective
extraction was run against real DotNetZip with an archive containing
`../../escaped-quest.ini`:

```
entry            : quest.ini
entry            : ../../escaped-quest.ini
selector matched : 2
  matched        : quest.ini
  matched        : ../../escaped-quest.ini     <-- reaches extraction
target contents  : /quest.ini
                   /escaped-quest.ini          <-- sanitised by the library
```

Two things follow, and they should not be conflated:

1. **`ZipManager` has no guard of its own in these modes.** The selector
   `name = *quest.ini` matches the traversing entry and hands it to
   extraction. That part is confirmed by execution, not by reading.
2. **DotNetZip 1.16.0 neutralises it**, stripping the `../../` and writing
   inside the target. So on that version the traversal does not escape.

The app's safety in these modes therefore rests entirely on the bundled
library's behaviour.

## Which library the app actually bundles

`unity/Assets/Plugins/Ionic.Zip.Unity.dll` reports **1.9.1.6** — far older
than the 1.16.0 tested above. NuGet flags 1.16.0 itself as carrying a
known high-severity advisory
([GHSA-xhg6-9j5j-w4vf](https://github.com/advisories/GHSA-xhg6-9j5j-w4vf)), so
the bundled build is inside the affected range too.

**This has not been demonstrated against the shipped build** — that would need
a harness around the Unity DLL, which was not built. What can be said
precisely:

- the selective modes contribute no protection of their own;
- the protection that exists comes from a bundled 1.9.x DotNetZip;
- that library line has a published zip-slip advisory covering versions up to
  and including 1.16.0.

Adding a destination check to `ZipManager`'s selective modes would remove the
dependency on library behaviour entirely, and is a small change.

## Deviations from the C# behaviour

### 1. The traversal guard covers every mode

The C# checks destinations only inside `ZIPMANAGER_EXTRACT_FULL`
(`ZipManager.cs:137-149`). `EXTRACT_INI_TXT`, `EXTRACT_INI_TXT_PIC` and
`EXTRACT_SAVE_INI_PIC` call `ExtractSelectedEntries` with no check.

The port refuses any entry whose resolved destination falls outside the
target, in all four modes, and reports the refusals rather than failing
silently. Tests cover parent traversal, absolute names, Windows separators and
the sibling-prefix trap (`../targetmalicious/`).

### 2. Resources are released on the error path

`ZipManager.cs:133` opens the archive and calls `zip.Dispose()` at the end of
the `try`. Any mid-extraction throw is swallowed by the outer `catch` and the
handle leaks — which on Windows also leaves the file locked. The port has no
handle to leak: `fflate` works on a byte array.

### 3. Extraction does not block the caller

`ZipManager` runs extraction on a background `Thread` and the callers poll.
The port is async throughout and reports progress, so it can drive a progress
bar without a polling loop.

The CPU-heavy part is already off the main thread: fflate's async `unzip`
spawns a real worker — a Blob-URL `Worker` in the browser, `worker_threads`
in Node — so inflate never runs on the UI thread. The module itself touches no
DOM API, so a caller that wants the writes off-thread too can run the whole
extraction inside its own worker.

### 4. Extraction can stream

`extract` needs the whole archive in memory, which is fine for a quest and not
for a content pack of several hundred megabytes on a phone. `extractStream`
consumes an async iterable of chunks — a `fetch` body, a `File.stream()` — and
writes each entry as it completes, so peak memory is one entry rather than the
archive. Entries the mode does not select are never decompressed.

Reading a zip forwards has one consequence worth stating: `INI_TXT_PIC` cannot
know which image it wants until it has seen `quest.ini`. Images encountered
before it are held until the name is known and then dropped, so the bound is
"images preceding quest.ini", not the archive. Tests cover both orderings and
assert that streaming and buffered extraction put the same files on disk.

### 5. A corrupt archive fails instead of importing as empty

fflate's streaming reader skips bytes it does not recognise, so a truncated or
corrupt download would extract nothing and report success — silently leaving
the user with an empty quest. `extractStream` validates the leading PKZIP
signature and throws. An empty-but-valid archive (a bare end-of-central-
directory record) is still accepted.

## Behaviour preserved

- **The four modes take exactly the same entries**, including the leading
  wildcards: `name = quest.ini` matches a root-level file while
  `name = *quest.ini` reaches into a subdirectory — the C# comment notes the
  latter is required on Android.
- **`INI_TXT_PIC` is a two-pass extraction**: `quest.ini` has to be written
  before the image it names can be read out of it.
- **Existing files are overwritten**, matching `OverwriteSilently`.
- **Directory entries are skipped**; the tree is created from file paths.

## Library choice

`fflate` — small, no dependencies, works in the browser and in Node, and
decodes from a byte array so nothing needs a filesystem handle. Extraction is
callback-based rather than synchronous, so a large import can run in a worker
without freezing the UI.
