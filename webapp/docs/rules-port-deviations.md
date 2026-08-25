# Rules engine port — verified behaviour and deviations

Covers `T-009`. The port targets `VarManager.cs` and the four puzzle types.

Reproduce with `webapp/tools/differential/run.sh`.

| Corpus                  | Cases | Real divergences |
| ----------------------- | ----: | ---------------: |
| Hand-written edge cases |    81 |                0 |
| Fuzz                    | 8,000 |                0 |

`VarTests.cs` was already ported with T-008, because `QuestComponent` could not
be built without it.

## What is deferred, and why

`EventManager.cs` is 1,006 lines, and almost all of it drives the _running_
game: `game.CurrentQuest`, hero selection, monster placement, dialog windows.
It cannot be ported or tested without `Quest.cs` (2,817 lines of runtime
state), which no task currently owns explicitly.

Ported here: the variable store, its arithmetic, condition evaluation, and all
four puzzles — everything that is pure logic.

**Moved to T-018** (the play loop, which is where the runtime Quest object has
to exist anyway):

- the event queue, triggers and chaining
- monster spawning, placement and activation selection
- `{rnd:hero}` and `{c:...}` text substitution, which reads live hero state

T-018's acceptance criteria should be extended to say so.

## Bugs the corpus found in the port

### The nested condition must short-circuit

The C# evaluates a parenthesised group as `result && Test(remaining)`. C#'s
`&&` short-circuits, so when `result` is already false the recursive call never
runs — and the variables that call would have created are never created.

The port initially hoisted the recursion into a variable:

```ts
const nested = this.test(remaining) // wrong: always evaluated
result = result && nested
```

That produced extra quest variables and consumed `#rand` draws the C# never
draws. 17 fuzz cases out of 3,000 caught it.

### Quest variables are 32-bit floats

`VarManager.vars` is `Dictionary<string, float>`. Storing results as JS
doubles drifts immediately: `7 / 6` prints as `1.1666666666666667` instead of
`1.1666666`. Every result is now narrowed with `Math.fround`, and rendered
with the shortest decimal that round-trips at _float_ precision.

### Negative zero prints with its sign

`.NET` renders `-0f` as `"-0"`; JS `String(-0)` gives `"0"`. Visible in the
quest log — "Dividing quest var: $x by: -3 result: -0".

## Deviations from the C# behaviour

### `TrimQuest` no longer throws on a short name

`kv.Key.Substring(0, 2)` is called unguarded on every variable, so a
single-character name throws `ArgumentOutOfRangeException` and takes the quest
transition with it. The port checks the prefix safely.

### A malformed `VarOperation` no longer throws

Carried over from T-008: `new VarOperation("$a,>")` throws
`IndexOutOfRangeException` in the C#. 240 of 3,000 fuzz cases hit it, because
the fuzzer generates malformed operations freely; real content does not.

## Preserved bugs

### The trailing-character chop eats the `=`

Several serialisers build a list by appending `item + separator` and then
chopping one character off the end:

```csharp
r += "guess=";
foreach (CodeGuess g in guess) r += g.ToString() + ",";
r = r.Substring(0, r.Length - 1) + nl;
```

With no guesses that chop removes the `=` instead of a separator, so the line
is written as `guess` rather than `guess=`. The same happens for an empty
tower (`1` instead of `1=`) and an empty image state.

Saved games in the wild contain these lines, so the port reproduces them —
`appendTrimmed` in `puzzles.ts` models the pattern in one place.

Note the related landmine: `CodeAnswer.ToString()` uses the same pattern with
no prefix, so an answer with **no** positions would call `Substring(0, -1)` and
throw. Not reachable from saved data, which always parses to at least one
position.

## Behaviour worth knowing

- **Conditions fold left to right, not by precedence.** `A OR B AND C` is
  `(A OR B) AND C`. Scenario authors relying on the other reading get a
  different answer, and always have.
- **An empty condition passes.**
- **Reading a variable through `GetValue` does not create it; using it in an
  operation does** — and logs a notice either way it is created.
- **Variables starting with `#` are read-only**: `Perform` returns before
  applying anything.
- **Division by zero yields Infinity**, and modulus by zero yields NaN. Neither
  throws, and both are then stored in the variable.
- **`#rand<n>` draws from `Random.Range(1, n + 1)`**, so `#rand6` is 1..6. A
  malformed limit parses as 0, giving `Range(1, 1)` — always 1.
- **`ToString` omits zero-valued variables**, so a variable set back to 0 is
  indistinguishable from one never set.
- **A `#`-prefixed name is escaped with a backslash on save**, because `#`
  starts a comment in ini.
- **`PuzzleTower.Solved` accepts any tower that is empty or holds all eight
  discs in order** — so a board split across two towers is unsolved even if
  each part is ordered.
- **`PuzzleImage` generation is not a uniform shuffle.** Pieces are inserted at
  a random index of a growing list, which biases the result. Preserved so a
  given seed reproduces the same board.
