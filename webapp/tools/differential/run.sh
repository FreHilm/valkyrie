#!/usr/bin/env bash
# Differential test: run the real C# IniRead.cs and the TypeScript port over the
# same corpora and diff the results structurally.
#
# Requires the dotnet SDK. The C# source is copied from the Unity tree
# unmodified — only ValkyrieDebug is stubbed, because the original pulls in
# UnityEngine.
#
# Usage: ./run.sh [fuzz-case-count]
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
WORK="$HERE/.work"
FUZZ_N="${1:-8000}"

mkdir -p "$WORK"
cp "$REPO/libraries/ValkyrieTools/IniRead.cs" "$HERE/cs/IniRead.cs"
for f in DictionaryI18n StringKey LocalizationRead; do
  cp "$REPO/unity/Assets/Scripts/Content/$f.cs" "$HERE/i18n/$f.cs"
done
for f in ContentTypes ContentData ContentLoader ContentPack FormatVersions IContent ITestable \
         StringKey DictionaryI18n LocalizationRead; do
  cp "$REPO/unity/Assets/Scripts/Content/$f.cs" "$HERE/content/$f.cs"
done
cp "$REPO/libraries/ValkyrieTools/IniRead.cs" "$HERE/content/IniRead.cs"
for f in QuestData QuestButtonData StringKey DictionaryI18n LocalizationRead ContentTypes \
         ContentData ContentLoader ContentPack FormatVersions IContent ITestable TextAlignment; do
  cp "$REPO/unity/Assets/Scripts/Content/$f.cs" "$HERE/quest/$f.cs"
done
cp "$REPO/unity/Assets/Scripts/Content/RemoteContentPack.cs" "$HERE/remote/RemoteContentPack.cs"
cp "$REPO/unity/Assets/Scripts/LinqUtil.cs" "$HERE/traits/LinqUtil.cs"
rm -rf "$HERE/ogg/oggencoder"
cp -r "$REPO/libraries/FFGAppImport/AssetImport/oggencoder" "$HERE/ogg/oggencoder"
cp "$REPO/unity/Assets/Scripts/Quest/VarTests.cs" "$HERE/quest/VarTests.cs"
cp "$REPO/libraries/ValkyrieTools/IniRead.cs" "$HERE/quest/IniRead.cs"
for f in VarManager VarTests PuzzleCode PuzzleImage PuzzleSlide PuzzleTower Puzzle; do
  cp "$REPO/unity/Assets/Scripts/Quest/$f.cs" "$HERE/rules/$f.cs"
done
cp "$REPO/libraries/ValkyrieTools/IniRead.cs" "$HERE/rules/IniRead.cs"
# Copied rather than tracked: an unmodified duplicate of an upstream source in
# this tree can only drift out of step with it.
cp "$REPO/unity/Assets/Scripts/VersionManager.cs" "$HERE/rules/VersionManager.cs"

echo "==> building C# harness"
dotnet build "$HERE/cs/harness.csproj" -v q --nologo >/dev/null
BIN="$(find "$HERE/cs/bin" -name harness -type f -perm -u+x | head -1)"

run_pair() {
  local label="$1" corpus="$2"
  "$BIN" "$corpus" > "$WORK/cs.json"
  (cd "$REPO/webapp" && npx --no-install tsx "$HERE/run-ts.mjs" "$corpus" "$WORK/ts.json") >/dev/null
  echo "==> $label"
  node "$HERE/classify.mjs" "$WORK/cs.json" "$WORK/ts.json" "$corpus"
}

echo "==> hand-written edge cases"
node -e "
import('$HERE/corpus.mjs').then(m =>
  require('fs').writeFileSync('$WORK/corpus.json', JSON.stringify(m.corpus)))
"
run_pair "edge cases" "$WORK/corpus.json"

echo
node "$HERE/fuzz.mjs" "$FUZZ_N" "$WORK/fuzz.json"
run_pair "fuzz ($FUZZ_N cases)" "$WORK/fuzz.json"

echo
echo "==> real shipped content"
node -e "
const fs=require('fs'), cp=require('child_process');
const files = cp.execSync('find \"$REPO/unity/Assets/StreamingAssets/content\" -name \"*.ini\"', {encoding:'utf8'}).trim().split('\n').filter(Boolean);
const corpus = [];
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  corpus.push({ name: f, kind: 'readFromString', input: text });
  corpus.push({ name: f + '#section', kind: 'readSection', lines: text.split(/\r\n|\r|\n/), section: 'Quest' });
}
fs.writeFileSync('$WORK/real.json', JSON.stringify(corpus));
console.log(files.length + ' files, ' + corpus.length + ' cases');
"
run_pair "real content" "$WORK/real.json"

# ---- i18n ---------------------------------------------------------------
I18N="$HERE/i18n"
IW="$I18N/.work"
mkdir -p "$IW"

echo
echo "==> building i18n harness"
dotnet build "$I18N/i18nharness.csproj" -v q --nologo >/dev/null
IBIN="$(find "$I18N/bin" -name i18nharness -type f -perm -u+x | head -1)"

run_i18n() {
  local label="$1" corpus="$2"
  "$IBIN" "$corpus" > "$IW/cs.json"
  (cd "$REPO/webapp" && npx --no-install tsx "$I18N/run-ts.mjs" "$corpus" "$IW/ts.json") >/dev/null
  echo "==> $label"
  node "$I18N/compare.mjs" "$IW/cs.json" "$IW/ts.json"
}

node -e "
import('$I18N/corpus.mjs').then(m =>
  require('fs').writeFileSync('$IW/corpus.json', JSON.stringify(m.corpus)))
"
run_i18n "i18n edge cases" "$IW/corpus.json"

echo
node "$I18N/fuzz.mjs" "$FUZZ_N" "$IW/fuzz.json"
run_i18n "i18n fuzz ($FUZZ_N cases)" "$IW/fuzz.json"

echo
node "$I18N/real-content.mjs" "$REPO" "$IW/real.json"
run_i18n "i18n real localization content" "$IW/real.json"

# ---- content ------------------------------------------------------------
CONTENT="$HERE/content"
CW="$CONTENT/.work"
mkdir -p "$CW"

echo
echo "==> building content harness"
dotnet build "$CONTENT/contentharness.csproj" -v q --nologo >/dev/null
CBIN="$(find "$CONTENT/bin" -name contentharness -type f -perm -u+x | head -1)"

run_content() {
  local label="$1" corpus="$2"
  "$CBIN" "$corpus" > "$CW/cs.json"
  (cd "$REPO/webapp" && npx --no-install tsx "$CONTENT/run-ts.mjs" "$corpus" "$CW/ts.json") >/dev/null
  echo "==> $label"
  node "$CONTENT/compare.mjs" "$CW/cs.json" "$CW/ts.json"
}

node -e "
import('$CONTENT/corpus.mjs').then(m =>
  require('fs').writeFileSync('$CW/corpus.json', JSON.stringify(m.corpus)))
"
run_content "content edge cases" "$CW/corpus.json"

echo
node "$CONTENT/fuzz.mjs" "$FUZZ_N" "$CW/fuzz.json"
run_content "content fuzz ($FUZZ_N cases)" "$CW/fuzz.json"

echo
node "$CONTENT/real-content.mjs" "$REPO" "$CW/real.json"
run_content "content real packs" "$CW/real.json"

# ---- quest --------------------------------------------------------------
QUEST="$HERE/quest"
QW="$QUEST/.work"
mkdir -p "$QW"

echo
echo "==> building quest harness"
dotnet build "$QUEST/questharness.csproj" -v q --nologo >/dev/null
QBIN="$(find "$QUEST/bin" -name questharness -type f -perm -u+x | head -1)"

run_quest() {
  local label="$1" corpus="$2"
  "$QBIN" "$corpus" > "$QW/cs.json" 2>/dev/null
  (cd "$REPO/webapp" && npx --no-install tsx "$QUEST/run-ts.mjs" "$corpus" "$QW/ts.json") >/dev/null
  echo "==> $label"
  node "$QUEST/compare.mjs" "$QW/cs.json" "$QW/ts.json"
}

node -e "
import('$QUEST/corpus.mjs').then(m =>
  require('fs').writeFileSync('$QW/corpus.json', JSON.stringify(m.corpus)))
"
run_quest "quest edge cases" "$QW/corpus.json"

echo
node "$QUEST/fuzz.mjs" "$FUZZ_N" "$QW/fuzz.json"
run_quest "quest fuzz ($FUZZ_N cases)" "$QW/fuzz.json"

# Real scenarios are downloaded, not shipped. If a local sample exists (see
# fetch-real.mjs) it is used; otherwise this corpus is simply empty.
echo
node "$QUEST/real-content.mjs" "${VALKYRIE_QUEST_SAMPLE:-$QUEST/.sample}" "$QW/real.json"
run_quest "quest real scenarios" "$QW/real.json"

# ---- rules --------------------------------------------------------------
RULES="$HERE/rules"
RW="$RULES/.work"
mkdir -p "$RW"

echo
echo "==> building rules harness"
dotnet build "$RULES/rulesharness.csproj" -v q --nologo >/dev/null
RBIN="$(find "$RULES/bin" -name rulesharness -type f -perm -u+x | head -1)"

run_rules() {
  local label="$1" corpus="$2"
  "$RBIN" "$corpus" > "$RW/cs.json" 2>/dev/null
  (cd "$REPO/webapp" && npx --no-install tsx "$RULES/run-ts.mjs" "$corpus" "$RW/ts.json") >/dev/null
  echo "==> $label"
  node "$RULES/compare.mjs" "$RW/cs.json" "$RW/ts.json"
}

node -e "
import('$RULES/corpus.mjs').then(m =>
  require('fs').writeFileSync('$RW/corpus.json', JSON.stringify(m.corpus)))
"
run_rules "rules edge cases" "$RW/corpus.json"

echo
node "$RULES/fuzz.mjs" "$FUZZ_N" "$RW/fuzz.json"
run_rules "rules fuzz ($FUZZ_N cases)" "$RW/fuzz.json"

# ---- rounds -------------------------------------------------------------
# The round and activation loop, compared against the unmodified
# RoundController.cs / RoundControllerMoM.cs. The event engine is the same
# scripted stub on both sides, so a divergence can only come from the
# controller's own decisions.
ROUNDS="$HERE/rounds"
ROW="$ROUNDS/.work"
mkdir -p "$ROW"
for f in RoundController RoundControllerMoM VarManager VarTests; do
  cp "$REPO/unity/Assets/Scripts/Quest/$f.cs" "$ROUNDS/$f.cs"
done
# MonsterDialogMoM.Defeated is engine behaviour wearing a dialog's clothes, so
# it is sliced out rather than transcribed into a shim.
node "$ROUNDS/extract.mjs" >/dev/null

echo
echo "==> building rounds harness"
dotnet build "$ROUNDS/roundsharness.csproj" -v q --nologo >/dev/null
ROBIN="$(find "$ROUNDS/bin" -name roundsharness -type f -perm -u+x | head -1)"

run_rounds() {
  local label="$1" corpus="$2"
  "$ROBIN" "$corpus" > "$ROW/cs.json" 2>/dev/null
  (cd "$REPO/webapp" && npx --no-install tsx "$ROUNDS/run-ts.mjs" "$corpus") > "$ROW/ts.json"
  echo "==> $label"
  node "$ROUNDS/compare.mjs" "$ROW/cs.json" "$ROW/ts.json"
}

node --input-type=module -e "
import { writeFileSync } from 'node:fs'
import { cases } from '$ROUNDS/corpus.mjs'
writeFileSync('$ROW/corpus.json', JSON.stringify(cases()))
"
run_rounds "rounds edge cases" "$ROW/corpus.json"

echo
node "$ROUNDS/fuzz.mjs" "$ROW/fuzz.json" "$FUZZ_N"
run_rounds "rounds fuzz ($FUZZ_N cases)" "$ROW/fuzz.json"

# The combined corpus is what mutate.mjs runs against: several mutations are
# caught by only a handful of random scenarios, so the curated cases have to be
# in the same file for a reseeded fuzzer not to turn them into escapes.
node --input-type=module -e "
import { writeFileSync, readFileSync } from 'node:fs'
import { cases } from '$ROUNDS/corpus.mjs'
const fuzz = JSON.parse(readFileSync('$ROW/fuzz.json', 'utf8'))
writeFileSync('$ROW/combined.json', JSON.stringify([...cases(), ...fuzz]))
"

# ---- activation text ------------------------------------------------------
# Quest.ActivationInstance, sliced out of Quest.cs and compiled with the
# extracted OutputSymbolReplace and the real StringKey. This is where an
# activation's text becomes what the player reads, and the order of the steps
# is the part that is easy to get wrong.
echo
echo "==> monster activation text"
(cd "$REPO/webapp" && npx --no-install tsx "$HERE/activation/compare.mjs" "$FUZZ_N")

# ---- evade and horror text ------------------------------------------------
# The selection halves of InvestigatorEvade.cs and HorrorCheck.cs, compiled
# unmodified against UI shims: which entry a monster gets, what the fallback to
# a derived type does, and when nothing is drawn at all.
MT="$HERE/monstertext"
for f in InvestigatorEvade HorrorCheck; do
  cp "$REPO/unity/Assets/Scripts/Quest/$f.cs" "$MT/$f.cs"
done
echo
echo "==> evade and horror text selection"
(cd "$REPO/webapp" && npx --no-install tsx "$MT/compare.mjs" "$FUZZ_N")

# ---- investigator attacks -------------------------------------------------
# GetAttackTypes and GetRandomAttack, sliced out of ContentTypes.cs and
# QuestMonster.cs. These two calls are all InvestigatorAttack.cs does: which
# buttons the dialog offers, and which line of text pressing one produces.
echo
echo "==> investigator attack selection"
(cd "$REPO/webapp" && npx --no-install tsx "$HERE/attacks/compare.mjs" "$FUZZ_N")

# ---- monster selection ----------------------------------------------------
# AttemptMonsterMatch and RuntimeMonsterSelection, sliced out of Quest.cs.
# Which monster a spawn places decides what a scenario throws at the players,
# and the rules are subtle enough to compile rather than to read.
echo
echo "==> monster selection for spawns"
(cd "$REPO/webapp" && npx --no-install tsx "$HERE/spawn/compare.mjs" "$FUZZ_N")

# ---- multimedia ---------------------------------------------------------
# Self-contained: compare.mjs extracts the method from Quest.cs, builds, and
# runs both sides itself.
echo
echo "==> multimedia (localised file resolution)"
(cd "$REPO/webapp" && npx --no-install tsx "$HERE/multimedia/compare.mjs" "$FUZZ_N")

# ---- remote -------------------------------------------------------------
# Self-contained: compare.mjs builds and runs both sides itself. Uses the real
# manifests when fetch-real.mjs has cached them, and works offline without.
echo
echo "==> remote content pack manifest"
(cd "$REPO/webapp" && npx --no-install tsx "$HERE/remote/compare.mjs" "$FUZZ_N")

# ---- ogg ----------------------------------------------------------------
# Compares the port's ~200-line Ogg muxer against the vendored 26,669-line
# .NET Ogg Vorbis Encoder, byte for byte. See docs/audio-port-deviations.md.
echo
echo "==> ogg muxing and vorbis headers"
(cd "$REPO/webapp" && npx --no-install tsx "$HERE/ogg/compare.mjs" "$FUZZ_N")

# ---- traits -------------------------------------------------------------
# Selection-list trait filtering. compare.mjs extracts TraitGroup from the
# uGUI-bound source and drives it through the same sequence Draw() uses.
echo
echo "==> selection list trait filtering"
(cd "$REPO/webapp" && npx --no-install tsx "$HERE/traits/compare.mjs" "$FUZZ_N")

# ---- FFG asset import ---------------------------------------------------
# These need a licensed FFG install and the cache built by tools/ffg/probe.
# Each skips cleanly when it is absent, so CI still runs offline and without
# any licensed content present.
echo
echo "==> Unity asset extraction (needs a licensed install)"
(cd "$REPO/webapp" && npx --no-install tsx "$HERE/unity/compare.mjs")
(cd "$REPO/webapp" && npx --no-install tsx "$HERE/unity/pixels.mjs")

echo
echo "==> DDS / DXT decoding (needs a licensed install)"
(cd "$REPO/webapp" && npx --no-install tsx "$HERE/dds/compare.mjs")

echo
echo "==> FSB5 to Ogg Vorbis (needs a licensed install)"
(cd "$REPO/webapp" && npx --no-install tsx "$HERE/fsb/compare.mjs")

echo
echo "==> AssetBundles and LZ4 (needs a downloaded content cache)"
(cd "$REPO/webapp" && npx --no-install tsx "$HERE/bundle/compare.mjs")

# ---- quest round trip ----------------------------------------------------
# Checks the editor's writer against real published scenarios: parse, write,
# re-parse, and confirm the line ending survives so saving does not rewrite
# every line of a file tracked in git.
echo
echo "==> quest editor round trip (needs downloaded scenarios)"
(cd "$REPO/webapp" && npx --no-install tsx "$HERE/questwrite/compare.mjs")

# ---- quest text symbols --------------------------------------------------
# Every line of text a quest shows goes through OutputSymbolReplace, so it is
# checked against the extracted C# rather than trusted.
echo
echo "==> quest text symbol replacement"
(cd "$REPO/webapp" && npx --no-install tsx "$HERE/symbols/compare.mjs" "$FUZZ_N")
