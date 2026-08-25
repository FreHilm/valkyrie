/**
 * Placement and colour for a scenario's own UI elements.
 *
 * A `[UI...]` component is not a board piece: it is a screen-space overlay —
 * the journal image a Mansions scenario opens with, the framed block of text
 * beside it, the button that dismisses both. `Quest.UI` in the C# builds it as
 * a Unity RectTransform under a canvas sized to the screen, which is why none
 * of this lives in the board renderer.
 *
 * The maths is `Quest.cs:2086-2140`, kept here so it can be tested without a
 * screen and reused by whatever draws it.
 */

/** The screen the elements are laid out against, in CSS pixels. */
export interface Viewport {
  width: number
  height: number
}

/** What placement needs to know about one element. */
export interface QuestUiPlacement {
  /** Fraction of the scaling edge; `location` in the ini. */
  x: number
  y: number
  /** Size along the scaling edge, as a fraction of it. */
  size: number
  /** -1 left, 0 centre, 1 right. */
  hAlign: number
  /** -1 top, 0 centre, 1 bottom. */
  vAlign: number
  /** Scale against the screen height rather than its width. */
  verticalUnits: boolean
}

/** An absolutely positioned rectangle, in CSS pixels from the top left. */
export interface UiRect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Places one element.
 *
 * `aspect` is the image's width over its height, or the component's own
 * `textaspect` when it carries text instead.
 *
 * One quirk is faithful rather than accidental: the C# overwrites `unitScale`
 * with the screen height before computing the offsets, so under `vunits` the
 * *horizontal* offset is scaled by the height too. Scenarios are positioned
 * against that behaviour, so correcting it would move their art.
 */
export function layoutQuestUi(
  element: QuestUiPlacement,
  viewport: Viewport,
  aspect: number,
): UiRect {
  let unitScale = viewport.width
  let width = element.size * unitScale
  let height = aspect === 0 ? 0 : width / aspect
  if (element.verticalUnits) {
    unitScale = viewport.height
    height = element.size * unitScale
    width = height * aspect
  }

  const hOffset = element.x * unitScale
  const vOffset = element.y * unitScale

  const left =
    element.hAlign < 0
      ? hOffset
      : element.hAlign > 0
        ? // An inset from the right edge, which is where the C# anchors it.
          viewport.width - hOffset - width
        : hOffset + (viewport.width - width) / 2

  const top =
    element.vAlign < 0
      ? vOffset
      : element.vAlign > 0
        ? viewport.height - vOffset - height
        : vOffset + (viewport.height - height) / 2

  return { left, top, width, height }
}

/** `ColorUtil.LookUp`. Names the C# knows, mapped as it maps them. */
const COLOUR_NAMES = new Map<string, string>([
  ['black', '#000000'],
  ['white', '#FFFFFF'],
  ['red', '#FF0000'],
  ['lime', '#00FF00'],
  ['blue', '#0000FF'],
  ['yellow', '#FFFF00'],
  ['aqua', '#00FFFF'],
  ['cyan', '#00FFFF'],
  ['magenta', '#FF00FF'],
  ['fuchsia', '#FF00FF'],
  ['silver', '#C0C0C0'],
  ['gray', '#808080'],
  ['maroon', '#800000'],
  ['olive', '#808000'],
  ['green', '#008000'],
  ['purple', '#800080'],
  ['teal', '#008080'],
  ['navy', '#000080'],
  ['transparent', '#00000000'],
])

/** `ColorUtil.FromName`: a known name, or the input unchanged. */
export function colourFromName(name: string): string {
  return COLOUR_NAMES.get(name.toLowerCase()) ?? name
}

/**
 * Whether a colour is one the C# would accept without logging a warning.
 *
 * `ColorUtil.ColorFromName` warns and then parses anyway, throwing on anything
 * that is not hex. Reporting it lets the caller warn and fall back instead.
 */
export function isColourValid(name: string): boolean {
  const value = colourFromName(name)
  return /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)
}
