/**
 * Port of `unity/Assets/Scripts/Quest/VarTests.cs`.
 *
 * A quest condition is a flat list of components — variable comparisons,
 * AND/OR operators and parentheses — rather than a parsed tree. The editor
 * manipulates that list positionally, which is why the movement and removal
 * helpers are so particular about neighbours.
 *
 * Nominally T-009 work, but `QuestComponent` cannot be ported without it, so
 * it lands here. See docs/quest-port-deviations.md.
 */

import { log } from '../ini/logger.js'

export abstract class VarTestsComponent {
  abstract get componentType(): string
  abstract toString(): string
}

export class VarTestsLogicalOperator extends VarTestsComponent {
  static readonly TYPE = 'VarTestsLogicalOperator'

  op: string

  constructor(op = 'AND') {
    super()
    this.op = op
  }

  override get componentType(): string {
    return VarTestsLogicalOperator.TYPE
  }

  /** Flips AND to OR and anything else to AND. */
  nextLogicalOperator(): void {
    this.op = this.op === 'AND' ? 'OR' : 'AND'
  }

  override toString(): string {
    return this.op
  }
}

export class VarTestsParenthesis extends VarTestsComponent {
  static readonly TYPE = 'VarTestsParenthesis'

  /** Either "(" or ")". */
  parenthesis: string

  constructor(parenthesis = '') {
    super()
    this.parenthesis = parenthesis
  }

  override get componentType(): string {
    return VarTestsParenthesis.TYPE
  }

  override toString(): string {
    return this.parenthesis
  }
}

export class VarOperation extends VarTestsComponent {
  static readonly TYPE = 'VarOperation'

  var = ''
  operation = ''
  value = ''

  constructor(source?: string) {
    super()
    if (source === undefined) return

    const parts = source.split(',').filter((part) => part.length > 0)
    if (parts.length !== 3) {
      log(`Invalid var operation: ${source}`)
      // DEVIATION: the C# logs this and then indexes parts[0..2] regardless,
      // throwing IndexOutOfRangeException on anything shorter. The port keeps
      // whatever was supplied so one malformed line cannot abort a quest load.
      this.var = VarOperation.updateVarName(parts[0] ?? '')
      this.operation = parts[1] ?? ''
      this.value = VarOperation.updateVarName(parts[2] ?? '')
      return
    }

    this.var = VarOperation.updateVarName(parts[0]!)
    this.operation = parts[1]!
    this.value = VarOperation.updateVarName(parts[2]!)
  }

  /** Rewrites the format-3 internal variable names. */
  private static updateVarName(value: string): string {
    return value === '#fire' ? '$fire' : value
  }

  override get componentType(): string {
    return VarOperation.TYPE
  }

  override toString(): string {
    return `${this.var},${this.operation},${this.value}`
  }
}

export class VarTests {
  readonly varTestsComponents: VarTestsComponent[]

  constructor(components: VarTestsComponent[] = []) {
    this.varTestsComponents = components
  }

  /** Serialises to the `vartests=` form: `Type:value Type:value ...`. */
  toString(): string {
    let result = ''
    for (const component of this.varTestsComponents) {
      result += `${component.componentType}:${component.toString()} `
    }
    return result
  }

  /** Parses one `Type:value` token and appends the component it names. */
  addFromString(source: string): void {
    const parts = source.split(':')
    const kind = parts[0] ?? ''
    const value = parts[1] ?? ''

    // Not else-if in the C#, though the types are mutually exclusive.
    if (kind === VarTestsLogicalOperator.TYPE) {
      this.varTestsComponents.push(new VarTestsLogicalOperator(value))
    }
    if (kind === VarTestsParenthesis.TYPE) {
      this.varTestsComponents.push(new VarTestsParenthesis(value))
    }
    if (kind === VarOperation.TYPE) {
      this.varTestsComponents.push(new VarOperation(value))
    }
  }

  /** Appends a component — except a parenthesis, which goes to the front. */
  add(component: VarTestsComponent): void {
    if (component.componentType === VarTestsParenthesis.TYPE) {
      this.varTestsComponents.unshift(component)
    } else {
      this.varTestsComponents.push(component)
    }
  }

  /** Index of the ')' closing the '(' at `indexOpen`, or -1. */
  findClosingParenthesis(indexOpen: number): number {
    if (indexOpen < 0 || indexOpen >= this.varTestsComponents.length) return -1

    let count = 0
    for (let i = indexOpen; i < this.varTestsComponents.length; i++) {
      const component = this.varTestsComponents[i]!
      if (component.componentType !== VarTestsParenthesis.TYPE) continue

      const paren = component as VarTestsParenthesis
      if (paren.parenthesis === '(') count++
      else if (paren.parenthesis === ')') {
        count--
        if (count === 0) return i
      }
    }
    return -1
  }

  /** Index of the '(' opening the ')' at `indexClose`, or -1. */
  findOpeningParenthesis(indexClose: number): number {
    if (indexClose < 0 || indexClose >= this.varTestsComponents.length) return -1

    let count = 0
    for (let i = indexClose; i >= 0; i--) {
      const component = this.varTestsComponents[i]!
      if (component.componentType !== VarTestsParenthesis.TYPE) continue

      const paren = component as VarTestsParenthesis
      if (paren.parenthesis === ')') count++
      else if (paren.parenthesis === '(') {
        count--
        if (count === 0) return i
      }
    }
    return -1
  }

  /**
   * Where the component at `index` may move to, or -1.
   *
   * `up` means earlier in the list. A '(' may only sit before a comparison and
   * a ')' only before a logical operator, which is what keeps the flat list
   * well-formed as the editor shuffles it.
   */
  findNextValidPosition(index: number, up: boolean): number {
    const current = this.varTestsComponents[index]
    if (current === undefined) return -1

    if (
      current.componentType !== VarTestsParenthesis.TYPE &&
      current.componentType !== VarOperation.TYPE
    ) {
      return -1
    }

    let i = up ? index - 1 : index + 1

    if (current.componentType === VarTestsParenthesis.TYPE) {
      const paren = current as VarTestsParenthesis
      while (i >= 0 && i <= this.varTestsComponents.length - 1) {
        const at = this.varTestsComponents[i]!
        const opensBeforeOperation =
          paren.parenthesis === '(' && at.componentType === VarOperation.TYPE
        const closesBeforeOperator =
          paren.parenthesis === ')' && at.componentType === VarTestsLogicalOperator.TYPE

        if (opensBeforeOperation || closesBeforeOperator) {
          if (up) return i
          // Going down, the first neighbour does not count as a move.
          if (i !== index + 1) return i - 1
        }
        i = up ? i - 1 : i + 1
      }

      if (i >= this.varTestsComponents.length && paren.parenthesis === ')') {
        return this.varTestsComponents.length - 1
      }
      if (i <= 0 && paren.parenthesis === '(') return 0
    } else {
      // A comparison swaps with another comparison.
      while (i >= 0 && i <= this.varTestsComponents.length - 1) {
        if (this.varTestsComponents[i]!.componentType === VarOperation.TYPE) return i
        i = up ? i - 1 : i + 1
      }
    }

    if (i < 0 || i >= this.varTestsComponents.length) return -1

    log('Invalid test position')
    return -1
  }

  /** Removes a component along with the operator or parenthesis pairing it. */
  remove(index: number): void {
    const target = this.varTestsComponents[index]
    if (target === undefined) return

    if (target.componentType === VarOperation.TYPE) {
      const before = this.varTestsComponents[index - 1]
      const after = this.varTestsComponents[index + 1]

      if (index > 0 && before?.componentType === VarTestsLogicalOperator.TYPE) {
        this.varTestsComponents.splice(index - 1, 2)
      } else if (
        index < this.varTestsComponents.length - 1 &&
        after?.componentType === VarTestsLogicalOperator.TYPE
      ) {
        this.varTestsComponents.splice(index, 2)
      } else if (this.varTestsComponents.length === 1) {
        this.varTestsComponents.splice(0, 1)
      } else {
        // No operator either side means the item sits inside parentheses:
        // drop those and retry.
        this.varTestsComponents.splice(index + 1, 1)
        this.varTestsComponents.splice(index - 1, 1)
        this.remove(index - 1)
      }
      return
    }

    if (target.componentType === VarTestsParenthesis.TYPE) {
      const paren = target as VarTestsParenthesis
      if (paren.parenthesis === '(') {
        const other = this.findClosingParenthesis(index)
        if (other !== -1) this.varTestsComponents.splice(other, 1)
        this.varTestsComponents.splice(index, 1)
      } else if (paren.parenthesis === ')') {
        const other = this.findOpeningParenthesis(index)
        this.varTestsComponents.splice(index, 1)
        if (other !== -1) this.varTestsComponents.splice(other, 1)
      }
    }
  }

  /** Moves a component to the next valid position, swapping along the way. */
  moveComponent(index: number, up: boolean): void {
    const next = this.findNextValidPosition(index, up)
    if (next === -1) return

    const swap = (at: number) => {
      const a = this.varTestsComponents[at]
      const b = this.varTestsComponents[at + 1]
      if (a === undefined || b === undefined) return
      this.varTestsComponents[at] = b
      this.varTestsComponents[at + 1] = a
    }

    if (up) {
      for (let i = index; i > next; i--) swap(i - 1)
      if (this.varTestsComponents[next]?.componentType === VarOperation.TYPE) {
        for (let i = next + 1; i < index; i++) swap(i)
      }
    } else {
      for (let i = index; i < next; i++) swap(i)
      if (this.varTestsComponents[next]?.componentType === VarOperation.TYPE) {
        for (let i = next - 1; i > index; i--) swap(i - 1)
      }
    }
  }
}
