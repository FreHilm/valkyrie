# UI foundation — what was ported, what was rewritten

Covers `T-016`. Replaces `unity/Assets/Scripts/UI` — 37 files, of which 36 are
uGUI-bound.

## The split

The task notes are right that `UIElement` should not be transliterated: it is
an imperative wrapper over `GameObject` + `RectTransform` that exists because
uGUI has no declarative layer, and the DOM already provides what it
approximates. So this is mostly a rewrite. Two things were genuinely ported,
because their behaviour is load-bearing:

| Ported                                              | Why                                                                                                                              |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| The **unit system** (`UIScaler`)                    | Every position and size in the existing screens is expressed in units. Keeping it means ported screens can use the same numbers. |
| **Trait filtering** (`UIWindowSelectionListTraits`) | The semantics are subtle, and hundreds of published scenarios are browsed through it.                                            |

Everything else — panels, buttons, lists, dialogs, the search box — is new.

## The unit system

`UIScaler.cs` says it outright: _"The screen is always 30 'units' high. At 4:3
it is 40 across, at 16:9 it is 53.33. 1 unit is enough for 'small' text with a
border. 1.5 is medium text, 3 is big text."_ Those numbers are asserted
directly in the tests.

In the port `--u` is a CSS custom property, so sizing stays in the cascade
rather than being computed per element.

**Two deviations:**

1. **It follows the window.** The C# computes pixels-per-unit once and says so:
   `// We don't handle resizing after this`. Here a resize listener keeps it
   current.
2. **There is a floor of 14 px per unit.** The C# has none, because it targets
   a desktop window or a tablet in landscape. On a phone in portrait, 1/30th of
   the height is around 8 px, which would put small text near 5 px. The floor
   trades showing exactly 30 rows for text a person can read; below that the
   screen scrolls.

## Trait filtering — verified against the original

`tools/differential/traits` extracts the `SelectionItemTraits` and `TraitGroup`
classes from the uGUI-bound source by brace-matching, compiles them with the
project's own `LinqUtil` and a stub for the translated `SOURCE` string, and
compares them against the port.

**0 divergences across 4 seeds × 3,015 cases.** Mutation-tested, and all four
deliberate bugs were caught:

| mutation                                  | cases diverging |
| ----------------------------------------- | --------------- |
| strict mode ignores exclusion             | 62 / 135        |
| lenient mode drops the none-selected case | 38 / 135        |
| selected traits no longer required        | 41 / 135        |
| the Source group is never lenient         | 16 / 135        |

### What the filtering actually does

Two modes, and the second is easy to miss:

- **Strict** (the default): every selected trait must be present, and none of
  the item's traits may be excluded.
- **At-least-one-selected**: every selected trait must be present, and the item
  needs at least one non-excluded trait — so exclusion only bites when nothing
  is selected. The C# turns this on for **the group whose name matches the
  translated word for "Source"**, which means the filtering behaviour of that
  group depends on the user's language. Reproduced, including the trimmed,
  case-insensitive comparison; the translated word is passed in rather than
  read from a singleton.

An item carrying no trait in a group is _ungrouped for that group_ and is not
filtered by it — which is how an item with no expansion still shows while
expansion filters are active.

### One thing the harness surfaced

`TraitGroup.AddTraits` indexes `item.GetTraits()[_name]` unguarded and throws
`KeyNotFoundException` for an item with no trait in that group. It never fires
in the app, but only because of the order `Draw()` uses: `AddTraits` is called
only for a group matching one of the item's _own_ categories, and `AddItem`
(which does guard) is called for every pair afterwards. The harness reproduces
that exact sequence, and `groupsFrom` documents why it matters.

## Localization is enforced by the API, not by review

`.agent/rules/text-localization.md` forbids hardcoded UI strings. Rather than
rely on review, every component takes a `Text`, and there is no overload
accepting a bare string:

- `text(key)` — must be translated.
- `rawText(value)` — content that is data rather than interface copy: a quest
  name, an author, a filename. Named so that reaching for it to write a label
  stands out in review.

Writing an unlocalized label is now awkward, which is what makes the rule
self-enforcing.

## Accessibility, which the Unity UI does not have

The existing UI is sprites with click handlers: no keyboard operation, no focus
order, nothing for a screen reader. The port gets this from the platform by
using real elements, and the tests assert it:

- **Buttons** are `<button type="button">`, so keyboard activation and disabled
  semantics are free.
- **Selectable lists** are a `listbox` of `option`s with **roving tabindex** —
  one tab stop, arrow keys move focus, Enter and Space select, and focus stops
  at the ends rather than wrapping.
- **Dialogs** are `<dialog>` with `showModal()`, so focus trapping, the inert
  backdrop and Escape-to-close are the browser's. A dialog with no `onClose`
  refuses Escape too, rather than being dismissible by a route its own UI does
  not offer.
- **Panels** are labelled regions; the **search box** has a real `<label for>`;
  the result count is an `aria-live="polite"` region so a filter change reports
  its own outcome.
- **Touch targets** are `max(1.6 units, 44px)` — the unit floor alone can fall
  below a reliably hittable size on a phone.

## The trait control is three states, not two

The C# uses two separate click targets per trait and colour alone to say which
state it is in. The port uses one button cycling neutral → required → excluded:
fewer targets to hit on a phone, and `aria-pressed` plus a strikethrough mean
the state is readable without colour.

## Fonts — not shipped, imported

The Unity build renders `ColumbusMT.ttf`, `Gara_Scenario_Desc.ttf` and
`MADGaramondPro.ttf` through TextMeshPro. These are commercial faces and their
licences do not obviously cover web embedding, which the task notes flag.

They are **named in the CSS behind generic fallbacks, and none of them is in
this repository or in the build**. Confirm the licences before adding any
`@font-face` rule pointing at a bundled file. For the text faces this means the
UI renders in the fallback stack, which is a visual difference from the Unity
build and not a functional one.

### The icons are not a visual difference

Quest prose writes them as markers — `{action}`, `{shield}` — and
`outputSymbolReplace` rewrites each into a codepoint in `U+F200`–`F20F`. Only
`MADGaramondPro` fills that range in. Falling back does not make those icons
plainer, it makes them _absent_: "spend 1 {action}" arrives as "spend 1 ▯" and
loses the word that made it an instruction.

So the port gets the face the same way it gets the art and the audio — **from
the player's own install**, which embeds it. `ffgImport` extracts every `Font`
object it finds, keeps the one that actually covers the range, and writes it to
`<import>/fonts/`. `packages/app/src/symbolFont.ts` loads it from there into a
`FontFace` with a matching `unicode-range`, so the same file cannot become the
page's text font by accident.

Nothing licensed enters the repository or the bundle, and a player who has not
imported the game sees the named-chip fallback rather than a broken page.

## Not done here

The screens themselves — the main menu, quest selection, the play-mode dialogs
and the editor — are `T-017`–`T-019`. This is the foundation they build on, and
the selection list is the one complete screen component, because it is where
the ported filtering lives.
