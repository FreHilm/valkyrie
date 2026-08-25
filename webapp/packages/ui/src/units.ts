/**
 * The layout unit system, replacing `unity/Assets/Scripts/UI/UIScaler.cs`.
 *
 * The Unity UI is laid out in "units": the screen is always 30 units high, so
 * one unit is a line of small text with its border, 1.5 is medium text and 3
 * is a heading. Every position and size in the existing UI is expressed in
 * those units, and keeping the same system means the ported screens can use
 * the same numbers the C# does.
 *
 * The C# computes pixels-per-unit once and does not handle resizing
 * (`// We don't handle resizing after this`). Here it is a CSS custom property
 * derived from viewport height, so it simply follows the window — and on a
 * phone in portrait, where 30 rows of a 16:9 screen would leave text
 * unreadably small, a floor keeps it legible.
 */

/** `UIScaler.rowsOfUnits`. The screen is always this many units high. */
export const ROWS_OF_UNITS = 30

/**
 * Smallest a unit may get, in CSS pixels.
 *
 * DEVIATION: the C# has no floor, because it targets a desktop window or a
 * tablet held in landscape. On a phone in portrait, 1/30th of the height is
 * around 8px, which would put small text at roughly 5px. A floor trades
 * showing exactly 30 rows for text a person can read; below this width the
 * screen scrolls instead.
 */
export const MIN_UNIT_PX = 14

/** Text sizes named as the C# comment names them. */
export const TEXT_UNITS = {
  small: 1,
  medium: 1.5,
  large: 3,
} as const

export type TextSize = keyof typeof TEXT_UNITS

export interface Viewport {
  widthPx: number
  heightPx: number
}

/** `UIScaler.GetPixelsPerUnit()`, with the readability floor applied. */
export function pixelsPerUnit(viewport: Viewport): number {
  return Math.max(viewport.heightPx / ROWS_OF_UNITS, MIN_UNIT_PX)
}

/** `UIScaler.GetHeightUnits()`. 30, unless the floor is in play. */
export function heightUnits(viewport: Viewport): number {
  return viewport.heightPx / pixelsPerUnit(viewport)
}

/**
 * `UIScaler.GetWidthUnits()`. 40 at 4:3, 53.33 at 16:9 — the C# comment's own
 * numbers, and a good check that the port agrees.
 */
export function widthUnits(viewport: Viewport): number {
  return viewport.widthPx / pixelsPerUnit(viewport)
}

/** `UIScaler.Location(x, y)`: unit coordinates to pixels. */
export function location(viewport: Viewport, x: number, y: number): { x: number; y: number } {
  const perUnit = pixelsPerUnit(viewport)
  return { x: x * perUnit, y: y * perUnit }
}

/** A CSS length in units, for use in a stylesheet or an inline style. */
export function units(value: number): string {
  return `calc(var(--u) * ${value})`
}

/**
 * Installs the unit system on an element, usually the document root.
 *
 * Sets `--u` (one unit) and `--width-units`, then keeps them current as the
 * viewport changes — which is the resize case the C# explicitly gives up on.
 * Returns a function that stops observing.
 */
export function installUnits(
  root: HTMLElement,
  view: {
    innerWidth: number
    innerHeight: number
    addEventListener: Window['addEventListener']
    removeEventListener: Window['removeEventListener']
  },
): () => void {
  const apply = (): void => {
    const viewport = { widthPx: view.innerWidth, heightPx: view.innerHeight }
    const perUnit = pixelsPerUnit(viewport)
    root.style.setProperty('--u', `${perUnit}px`)
    root.style.setProperty('--width-units', widthUnits(viewport).toFixed(3))
    root.style.setProperty('--height-units', heightUnits(viewport).toFixed(3))
  }

  apply()
  view.addEventListener('resize', apply)
  return () => {
    view.removeEventListener('resize', apply)
  }
}
