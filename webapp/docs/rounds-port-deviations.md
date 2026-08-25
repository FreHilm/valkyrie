# Round controller port — verified behaviour and deviations

Covers the round and activation loop in `T-018`. The port targets
`unity/Assets/Scripts/Quest/RoundController.cs` and `RoundControllerMoM.cs`,
and lives in `packages/core/src/quest/RoundController.ts`.

## What was measured

Neither C# file has a test, and neither can have one as written: both build
dialogs (`new ActivateDialog(m, ...)`) from inside the decision logic, so
the controller cannot run without a screen. The port emits a `RoundRequest`
instead and the caller decides what to show.

The `rounds` differential harness compiles **both C# files unmodified** —
along with the real `VarManager.cs` and `VarTests.cs` — against shims for
everything they reach through `Game.Get()`, and runs the same scenarios
through the port.

The event engine is a scripted stub on _both_ sides. That is deliberate: what
is under test here is what the controller decides — which monster acts, which
triggers fire, when the round turns over — so the engine's answers are held
identical and a divergence can only come from the controller. The engine
itself is covered by its own tests.

Each scenario compares an ordered trace (every trigger, dialog, queue, audio
cue, save, random draw and diagnostic) and the end state (per-monster
activation flags and drawn activation, per-hero activation, every variable,
the quest log, the phase, and the event stack).

```
rounds edge cases          identical: 35/36      real divergences: 0
rounds fuzz (8000 cases)   identical: 6751/8000  real divergences: 0
```

Everything not identical is the `Application.Quit` deviation below: 1249 of
8000 random scenarios (16%) close the application in the C#. The fuzzer
generates broken activation lists on purpose, so that rate says nothing about
real scenarios — but the _reachability_ is the point.

View refreshes (`monsterCanvas.UpdateStatus`, `heroCanvas.UpdateStatus`,
`stageUI.Update`, `monsterCanvas.UpdateList`) are left out of the trace. They
carry no decision: the port's screens re-render from state.

### The harness was mutation-tested

24 plausible porting mistakes were introduced one at a time and every one was
caught (`tools/differential/rounds/mutate.mjs`):

```
caught  200  minion/master draw inverted
caught   23  masterFirst ignored
caught   23  minionFirst ignored
caught   92  single-half test uses AND
caught  119  single-half dialog shows the wrong half
caught   35  empty hero seats block the round
caught  168  partial activation flips the half
caught   17  round counter uses half-up rounding
caught  174  eliminatedprev set before the check
caught   64  MoM mythos falls through to monsters
caught  171  MoM horror does not wait for the player
caught    3  MoM event activation matched anywhere in the name
caught  112  MoM event activation does not mark the monster done
caught   10  activation not cleared between rounds
caught  107  hero activation not cleared between rounds
caught    9  minionStarted not cleared between rounds
caught    2  activationsFinished never reset
caught   12  StartRound fires without triggering
caught   26  defeat does not clear the open event
caught  629  defeat fires only the type trigger
caught  102  defeat does not drive the monster phase onward
caught  396  health ignores the scenario modifier
caught   91  health counts empty party seats
caught   48  health uses half-up rounding
```

Mutations run against the **curated cases and the fuzz together**. Several are
caught by only a handful of random scenarios — the `Event` prefix test by one —
so reseeding the fuzzer silently turned them into escapes twice before the two
corpora were combined. Anything caught by fewer than a few cases now has a
curated case of its own.

Two of these escaped on the first run and closed real gaps:

- `startsWith('Event')` → `includes('Event')` survived, because the fuzzer only
  ever named event activations `EventT0`. A quest activation named
  `TrapEventActs` must **not** be treated as an event activation; the fuzzer now
  generates those names and the mutation is caught.
- The clear-between-rounds mutations were not being applied at all — they live
  in `QuestRuntime.resetActivations`, not in the controller. The mutation
  script now targets both files.

The `eliminatedprev` mutation is worth naming: it is caught 174 times, and
writing the corresponding unit test surfaced a two-round handshake that is easy
to read past. `EndRound` promotes `#eliminated` into `#eliminatedprev`, and only
the _next_ round start sees `#eliminatedcomplete` still zero. Setting
`#eliminatedprev` directly makes `StartFinalRound` unreachable.

## Defeating a monster

`MonsterDialogMoM.Defeated` is engine behaviour wearing a dialog's clothes: it
removes the monster, keeps `#monsters` in step, fires `Defeated<Type>` and
`Defeated<SpawnName>`, and can drive the monster phase onward. It is **sliced
out of `MonsterDialogMoM.cs` and compiled**, not transcribed into a shim —
transcribing it would have meant comparing the port against a copy of itself.

Two orderings are preserved because scenarios depend on them:

- **The open event is cleared before the triggers fire.** The C# comments this
  as "fix #1112". A monster defeated from inside an event would otherwise leave
  that event open and the `Defeated` event unable to start.
- **The monster phase is driven onward only when nothing opened** ("fix #982 and
  #1352"). The monster that was mid-activation is gone, so without this nothing
  calls back in and the phase stalls.

Descent has no counterpart — its defeat path lives in `MonsterDialog.cs`, which
is not ported yet — so the harness only issues the command for Mansions
scenarios rather than pretending to cover both.

`Quest.Monster.GetHealth` comes with it: `healthBase + heroes × healthPerHero`,
banker's-rounded, plus the scenario's `healthMod`. Empty party seats are
excluded, so a three-seat party with two investigators scales as two.

## Activation text

`Quest.ActivationInstance` (`Quest.cs:2679`) turns an activation's raw keys into
what the player reads: translate, substitute `{0}`, replace symbols, unescape
newlines — in that order. The `activation` harness slices the class out of
`Quest.cs` and compiles it with the extracted `OutputSymbolReplace` and the real
`StringKey`, so all three ported pieces are checked working together.

```
activation: 4038 cases, 0 real divergences
```

11 mutations, all caught, and the 48 curated cases catch the five that matter
without relying on the fuzz. Two things that only mutation testing showed:

- **The trailing newline unescape is nearly dead code.** Both a literal key and
  a dictionary value are already unescaped by the time `Translate` returns, so
  the `Replace("\\n", "\n")` after symbol replacement can only ever fire on
  text arriving through a substituted monster or hero name. The corpus now
  covers that path; before it did, the step could be deleted with no divergence.
- **Replacing symbols early as well as late is idempotent**, so "wrong order"
  was invisible by construction and was not a real mutation. Dropping the late
  pass is the observable defect, and that is what is tested.

Markers are game-specific — `{heart}` maps only in Descent, `{will}` only in
Mansions — so a corpus that uses one marker for both game types silently covers
half of what it appears to.

### Deviation: Descent leaves `move` null

The C# only assigns `move` on the Mansions branch, so a Descent activation
carries a null. Nothing reads it — the move text belongs to `ActivateDialogMoM`
— but it is a null waiting for the first Descent dialog that ever does. The port
uses an empty string. The harness counts these separately rather than hiding
them: 1,984 of 4,038 cases.

### Deviation: the random hero is resolved once

`Quest.cs:2700` carries a `FIXME`: the hero named in a Descent ability is drawn
at activation time and never stored, so a save or an undo re-draws a different
one and the ability text changes under the player. The port resolves it once and
the resolved text is what a save carries — which is one of the reasons saves do
not interoperate with the Unity build.

## Evade and horror text

`InvestigatorEvade.cs` and `HorrorCheck.cs` are dialogs, but the part worth
porting is the selection: which entry a monster gets, what the fallback to a
derived type does, and when nothing is shown at all. Both files are **compiled
unmodified** against UI shims.

```
monstertext: 4032 cases, 0 real divergences
```

8 mutations, all caught. Two candidate mutations were dropped as invalid rather
than covered, because they are unobservable by construction:

- `IsNullOrWhiteSpace` on the derived type has no effect — a blank name can
  never equal `Monster` + anything. Kept for faithfulness, marked as untestable.
- An empty event name needs no guard, because no quest component is named `""`.
  The port originally had one; it was removed, since the C# has none.

**A weaker harness than the others, and worth saying so.** The C# side runs the
real files, but the TypeScript side's trace is mirrored inside `compare.mjs`
rather than produced by the port — only `pickMonsterText` and
`customMonsterEvent` are genuinely under test. The dialog ordering it asserts
(evade logs before drawing, horror draws before logging; the Finished button
greys out at full damage) is read from the C# but not yet executed by ported
code, because those dialogs are not ported.

### Preserved: nothing is shown when nothing matches

A monster with no matching `Evade` or `Horror` entry draws no dialog at all —
the player presses Evade and sees nothing happen. That is what the C# does, and
substituting another monster's text would be worse than the silence.

## Investigator attacks

`GetAttackTypes` and `GetRandomAttack` are all `InvestigatorAttack.cs` does:
which buttons the dialog offers, and which line of text pressing one produces.
Both are **sliced out of `ContentTypes.cs`**, along with the `QuestMonster`
override from `QuestMonster.cs`, and compiled.

```
attacks: 4016 cases, 0 real divergences
```

11 mutations, all caught. One candidate was rewritten rather than kept: making
an empty quest override "fall through" needed to actually change control flow,
not just re-return null, before it tested anything.

### Deviation: an empty attack list no longer kills the application

`GetRandomAttack` ends with `validAttacks[Random.Range(0, validAttacks.Count)]`
and never checks the list is non-empty, so an empty one throws
`ArgumentOutOfRangeException` out of a button handler and the app dies.

A scenario reaches it by writing `attacks=heavy:0` in a `CustomMonster`, which
registers the type with no text behind it. The port returns null and the dialog
says there is no text for this monster.

3,010 of 4,016 fuzz cases hit the crash, but that number is about the fuzzer,
not about real content: it generates monster/type combinations freely, where the
dialog only ever passes back a type `GetAttackTypes` produced. The genuinely
reachable path is the `:0` override.

### A scenario-authoring trap, preserved

`GetAttackTypes` is **not** overridden by `QuestMonster`, so the buttons come
from content attacks matching the monster's traits — while `GetRandomAttack`
_is_ overridden and reads the quest's own text. A `CustomMonster` that defines
`attacks=fire:2` but has no trait any content `fire` attack targets never gets a
Fire button, so its own attack text is unreachable. Preserved, because changing
it would change which buttons published scenarios show.

## The end-of-quest screen sends nothing

`EndGameScreen.cs` asks whether the party won, for a rating out of ten, and for
comments — then posts all of it, plus the scenario and quest name, the language,
the investigator list, **the complete event trace** and **every non-zero quest
variable**, to a Google Form owned by the upstream maintainer
(`StatsManager.cs:211`).

The port shows the screen and sends nothing. `onSubmit` is optional and the
application leaves it unset, so the feedback form is not even built — a fork
must not quietly feed someone else's spreadsheet, and collecting free-text
comments from players is a decision to make on purpose rather than inherit.

Wiring it to an endpoint of your own is one callback. Note that a browser
cannot read the response from Google Forms cross-origin, so a naive port would
fail silently either way.

## Options: two settings dropped

Resolution and fullscreen are not in the port. Resolution belongs to the browser
window, and the C# enumerates Unity display modes that need a restart to apply.
Fullscreen is left to the browser's own control, where users already look for it.

Language, fallback language and the two volumes are all present, written through
as they change — matching the C#, which saves on every slider move rather than
on a confirm.

## Deviations from the C# behaviour

### 1. A monster with no activation data no longer closes the application

`RoundController.cs:198` logs an error and calls `Application.Quit()` — from
inside the round loop, mid-activation, because a community scenario named a
monster whose type defines no activation. The player loses the session with no
save and no explanation.

The port logs the same diagnostic, adds a quest-log entry so the scenario
author can see it, marks the monster activated and carries on to the next one.
This is the single largest behavioural difference in the file, and the harness
reports it as a class of its own rather than hiding it.

### 2. Morale is clamped where the C# only clamps its display

`Quest.cs:1102 AdjustMorale` writes the unclamped value to `$%morale` and
_then_ assigns `0` to a local variable:

```csharp
float morale = vars.GetValue("$%morale") + m;
vars.SetValue("$%morale", morale);   // negative value already stored
if (morale < 0)
{
    morale = 0;                      // dead store: never written back
    ...
}
```

The variable keeps going negative while the display shows zero, so a scenario
testing `$%morale` sees a value the player never sees. The port writes the
clamp through.

Descent-only: Mansions has no morale track, and the MoM controller never calls
this with a non-zero delta.

### 3. `#round` uses banker's rounding explicitly

`Mathf.RoundToInt` is banker's rounding — `2.5` becomes `2`, not `3` — while
JavaScript's `Math.round` is half-up. Reachable, because a scenario can add a
fraction to `#round` with a var operation. `roundToInt` implements the C#
behaviour and is tested directly; the mutation to `Math.round` is caught 17
times.

### 4. Var notices reach the quest log

`VarManager.SetValue` adds a `Notice: Adding quest var: …` editor entry when a
variable is created. The port's `VarManager` had the hook but `QuestRuntime`
never wired it, so those entries were being dropped. Found by this harness,
now routed. Editor entries are hidden from players either way.

## Behaviour preserved, including the parts that look like mistakes

- **The activation list is rebuilt on every activation**, even when one has
  already been drawn for the round. It is only used when
  `currentActivation == null`, so the rebuild looks redundant — but it is where
  the missing-activation warnings come from, so a monster with a broken list
  warns once per activation rather than once per round. Matching this was the
  difference between 18 divergences and zero.
- **The two missing-activation warnings reach different audiences.** The
  quest-specific branch writes to the quest log; the content branch writes to
  the console only (`ValkyrieDebug.Log`). The port keeps the split.
- **A quest activation whose tests fail still warns** when content has no
  fallback for the same name. The port originally warned only when the
  component was absent entirely; the fuzz found it.
- **`ParticalActivationComplete`** keeps its spelling, so the C# remains
  greppable from the port.
- **MoM marks a monster activated on `minionStarted || masterStarted`**, where
  Descent requires both. That is not a typo in either file: Mansions shows one
  dialog for the whole activation.
- **The horror phase waits for the player.** Without the `endRoundRequested`
  guard a random event flips the game back to the investigator phase before the
  horror test can be taken.
- **An empty party seat never holds the round open** (`heroData == null`).
