/**
 * Element construction helpers.
 *
 * `UIElement.cs` is 683 lines of imperative `GameObject` + `RectTransform`
 * assembly that exists because uGUI has no declarative layer. The DOM already
 * provides what it was approximating, so this is deliberately thin — a
 * `createElement` wrapper, not a framework.
 */

type Child = Node | string | null | undefined | false

export interface ElementOptions {
  class?: string | readonly string[]
  text?: string
  /**
   * Applied with `setAttribute`, so `aria-*` and `data-*` work as written.
   *
   * Booleans follow *HTML* semantics: `true` renders the bare attribute and
   * `false` omits it, which is what `disabled` and `hidden` need. ARIA state
   * attributes are not HTML booleans — `aria-pressed="false"` means something
   * different from an absent `aria-pressed` — so pass those as the strings
   * `'true'` and `'false'`.
   */
  attrs?: Record<string, string | number | boolean | undefined>
  style?: Partial<Record<string, string>>
  on?: Partial<Record<string, (event: Event) => void>>
  children?: readonly Child[]
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)

  if (options.class !== undefined) {
    const names = typeof options.class === 'string' ? [options.class] : options.class
    node.classList.add(...names.filter((name) => name.length > 0))
  }
  if (options.text !== undefined) node.textContent = options.text

  for (const [name, value] of Object.entries(options.attrs ?? {})) {
    if (value === undefined || value === false) continue
    node.setAttribute(name, value === true ? '' : String(value))
  }
  for (const [name, value] of Object.entries(options.style ?? {})) {
    if (value !== undefined) node.style.setProperty(name, value)
  }
  for (const [name, handler] of Object.entries(options.on ?? {})) {
    if (handler !== undefined) node.addEventListener(name, handler)
  }
  for (const child of options.children ?? []) {
    if (child === null || child === undefined || child === false) continue
    node.append(child)
  }
  return node
}

/** Empties an element. `replaceChildren` with a name that says why. */
export function clear(node: Element): void {
  node.replaceChildren()
}
