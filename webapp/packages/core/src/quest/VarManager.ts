/**
 * Port of `unity/Assets/Scripts/Quest/VarManager.cs`.
 *
 * The quest variable store, its arithmetic, and the evaluator for the flat
 * condition lists that `VarTests` produces.
 *
 * Two host dependencies are injected rather than reached for: the quest log
 * (the C# writes a "Notice: Adding quest var" entry through
 * `Game.Get().CurrentQuest.log`) and the random source used by `#rand`.
 */

import { formatFloatInvariant, parseFloatStrict } from '../config/parse.js'
import { log } from '../ini/logger.js'
import type { VarOperation, VarTests, VarTestsComponent } from './VarTests.js'
import { VarTestsLogicalOperator, VarTestsParenthesis } from './VarTests.js'

/** Records the notices the C# appends to the quest log. */
export type QuestNotice = (message: string) => void

export interface VarManagerOptions {
  /** Receives the "Notice: ..." entries. */
  notice?: QuestNotice
  /** Inclusive-exclusive integer source, matching `UnityEngine.Random.Range`. */
  randomRange?: (minInclusive: number, maxExclusive: number) => number
}

const defaultRandomRange = (min: number, max: number): number =>
  min + Math.floor(Math.random() * (max - min))

export class VarManager {
  readonly vars = new Map<string, number>()

  private readonly notice: QuestNotice
  private readonly randomRange: (min: number, max: number) => number

  constructor(options: VarManagerOptions = {}) {
    this.notice = options.notice ?? (() => {})
    this.randomRange = options.randomRange ?? defaultRandomRange
  }

  /**
   * Restores from a saved `[Vars]` section.
   *
   * A leading backslash escapes a name starting with `#`, which would
   * otherwise be an ini comment.
   */
  static fromSaved(data: ReadonlyMap<string, string>, options: VarManagerOptions = {}): VarManager {
    const manager = new VarManager(options)
    for (const [key, raw] of data) {
      const value = parseFloatStrict(raw) ?? 0
      manager.vars.set(key.startsWith('\\') ? key.slice(1) : key, Math.fround(value))
    }
    return manager
  }

  /** Every variable whose name starts with `prefix`. */
  getPrefixVars(prefix: string): Map<string, number> {
    const result = new Map<string, number>()
    for (const [key, value] of this.vars) {
      if (key.startsWith(prefix)) result.set(key, value)
    }
    return result
  }

  /**
   * Drops everything except campaign variables, which survive between quests.
   *
   * DEVIATION: the C# calls `kv.Key.Substring(0, 2)` unguarded, so a
   * single-character variable name throws ArgumentOutOfRangeException. The
   * port checks the prefix safely.
   */
  trimQuest(): void {
    const kept = new Map<string, number>()
    for (const [key, value] of this.vars) {
      if (key.startsWith('%')) kept.set(key, value)
      if (key.startsWith('$%')) kept.set(key, value)
    }
    this.vars.clear()
    for (const [key, value] of kept) this.vars.set(key, value)
  }

  setValue(name: string, value: number): void {
    if (!this.vars.has(name)) this.notice(`Notice: Adding quest var: ${name}`)
    this.vars.set(name, Math.fround(value))
  }

  /** Reads a variable, treating an unknown one as 0 without creating it. */
  getValue(name: string): number {
    return this.vars.get(name) ?? 0
  }

  /**
   * Resolves the right-hand side of an operation: a literal, `#rand<n>`, or
   * another variable. Referencing an unknown variable creates it at 0.
   */
  getOpValue(op: VarOperation): number {
    if (!this.vars.has(op.var)) {
      this.notice(`Notice: Adding quest var: ${op.var}`)
      this.vars.set(op.var, 0)
    }

    if (op.value.length === 0) return 0

    const first = op.value[0]!
    if ((first >= '0' && first <= '9') || first === '-' || first === '.') {
      return parseFloatStrict(op.value) ?? 0
    }

    if (op.value.startsWith('#rand')) {
      const limit = Number.parseInt(op.value.slice(5), 10)
      const randLimit = Number.isNaN(limit) ? 0 : limit
      return this.randomRange(1, randLimit + 1)
    }

    if (!this.vars.has(op.value)) {
      this.notice(`Notice: Adding quest var: ${op.value}`)
      this.vars.set(op.value, 0)
    }
    return this.vars.get(op.value)!
  }

  /** Applies one operation. Names starting with `#` are read-only. */
  perform(op: VarOperation): void {
    const value = this.getOpValue(op)

    if (op.var.startsWith('#')) return

    const current = this.vars.get(op.var) ?? 0
    // Quest variables are `float` in the C#, so every result is narrowed to
    // 32-bit precision. Without this, division and multiplication drift.
    const store = (result: number) => this.vars.set(op.var, Math.fround(result))
    const shown = () => formatFloatInvariant(this.vars.get(op.var)!)

    switch (op.operation) {
      case '+':
        store(current + value)
        this.notice(
          `Notice: Adding: ${formatFloatInvariant(value)} to quest var: ${op.var} result: ${shown()}`,
        )
        break
      case '-':
        store(current - value)
        this.notice(
          `Notice: Subtracting: ${formatFloatInvariant(value)} from quest var: ${op.var} result: ${shown()}`,
        )
        break
      case '*':
        store(current * value)
        this.notice(
          `Notice: Multiplying: ${formatFloatInvariant(value)} with quest var: ${op.var} result: ${shown()}`,
        )
        break
      case '/':
        // Float division: by zero yields Infinity rather than throwing.
        store(current / value)
        this.notice(
          `Notice: Dividing quest var: ${op.var} by: ${formatFloatInvariant(value)} result: ${shown()}`,
        )
        break
      case '%':
        store(current % value)
        this.notice(
          `Notice: Modulus quest var: ${op.var} by: ${formatFloatInvariant(value)} result: ${shown()}`,
        )
        break
      case '=':
        store(value)
        this.notice(`Notice: Setting: ${op.var} to: ${formatFloatInvariant(value)}`)
        break
      default:
        // An unknown operation is a no-op, as in the C#'s if-chain.
        break
    }
  }

  performAll(ops: readonly VarOperation[]): void {
    for (const op of ops) this.perform(op)
  }

  /**
   * Evaluates a condition list.
   *
   * Note this is *not* precedence-aware: components are folded left to right,
   * and an opening parenthesis recurses over everything that follows, with the
   * closing parenthesis returning from that recursion. An empty list is true.
   */
  test(tests: VarTests | null | undefined): boolean {
    if (tests === null || tests === undefined) return true
    const components = tests.varTestsComponents
    if (components.length === 0) return true

    let result = true
    let currentOperator = 'AND'
    let ignoreInsideParenthesis = 0

    for (let index = 0; index < components.length; index++) {
      const component = components[index]!

      // The recursion above already evaluated this span.
      if (ignoreInsideParenthesis > 0) {
        if (component instanceof VarTestsParenthesis) {
          if (component.parenthesis === '(') ignoreInsideParenthesis++
          else if (component.parenthesis === ')') ignoreInsideParenthesis--
        }
        continue
      }

      if (isVarOperation(component)) {
        if (currentOperator === 'AND') result = result && this.testOperation(component)
        else if (currentOperator === 'OR') result = result || this.testOperation(component)
      } else if (component instanceof VarTestsLogicalOperator) {
        currentOperator = component.op
      } else if (component instanceof VarTestsParenthesis) {
        if (component.parenthesis === '(') {
          const remaining = components.slice(index + 1)
          // The recursion must stay inside the && / || so it short-circuits:
          // hoisting it into a variable evaluates the nested tests even when
          // the result is already decided, which creates variables the C#
          // never touches.
          if (currentOperator === 'AND') {
            result = result && this.test({ varTestsComponents: remaining } as VarTests)
          } else if (currentOperator === 'OR') {
            result = result || this.test({ varTestsComponents: remaining } as VarTests)
          }
          ignoreInsideParenthesis = 1
        } else if (component.parenthesis === ')') {
          return result
        }
      }
    }

    if (ignoreInsideParenthesis > 0) {
      log(`Invalid Test :${tests.toString()}\n returns ${result}`)
    }

    return result
  }

  /** Evaluates one comparison. An unknown operator fails. */
  testOperation(op: VarOperation): boolean {
    const value = this.getOpValue(op)
    const current = this.vars.get(op.var) ?? 0

    switch (op.operation) {
      case '==':
        return current === value
      case '!=':
        return current !== value
      case '>=':
        return current >= value
      case '<=':
        return current <= value
      case '>':
        return current > value
      case '<':
        return current < value
      default:
        return false
    }
  }

  /** Serialises to a `[Vars]` section. Zero-valued variables are omitted. */
  toString(): string {
    let result = '[Vars]\n'
    for (const [key, value] of this.vars) {
      if (value === 0) continue
      // '#' starts a comment in ini, so such names are escaped.
      const shown = formatFloatInvariant(value)
      result += key.startsWith('#') ? `\\${key}=${shown}\n` : `${key}=${shown}\n`
    }
    return `${result}\n`
  }
}

/** `component is VarOperation` without importing the class for a type guard. */
function isVarOperation(component: VarTestsComponent): component is VarOperation {
  return component.componentType === 'VarOperation'
}
