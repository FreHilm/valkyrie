/**
 * Port of `unity/Assets/Scripts/Content/QuestButtonData.ts`.
 *
 * A button on an event dialog: a label, the events it leads to, and an
 * optional condition governing whether it is usable.
 */

import { StringKey } from '../i18n/StringKey.js'
import type { Localization } from '../i18n/Localization.js'
import { VarOperation, VarTests } from './VarTests.js'
import type { ContentFields } from '../content/types.js'

export const QuestButtonAction = {
  NONE: 'NONE',
  DISABLE: 'DISABLE',
  HIDE: 'HIDE',
} as const

/**
 * The named actions, or the decimal form of any other integer.
 *
 * `Enum.TryParse` accepts numbers as well as names and does not range-check
 * them, so `event1ConditionAction=99` yields an enum value that prints as
 * "99". Content should never do that, but the port models it rather than
 * silently substituting a default.
 */
export type QuestButtonAction = string

export const DEFAULT_BUTTON_COLOR = 'white'

export class QuestButtonData {
  label: StringKey
  readonly eventNames: string[]
  condition: VarTests
  color = DEFAULT_BUTTON_COLOR

  /** Explicit action; null means "derive from whether a condition exists". */
  rawConditionFailedAction: QuestButtonAction | null

  /** Always empty — present so buttons satisfy the same shape as components. */
  readonly operations: VarOperation[] = []

  constructor(
    label: StringKey,
    eventNames: string[] = [],
    condition: VarTests | null = null,
    rawConditionFailedAction: QuestButtonAction | null = null,
  ) {
    this.label = label
    this.eventNames = eventNames
    this.condition = condition ?? new VarTests()
    this.rawConditionFailedAction = rawConditionFailedAction
  }

  get hasCondition(): boolean {
    return this.condition.varTestsComponents.length > 0
  }

  /** A conditional button disables by default; an unconditional one does nothing. */
  get conditionFailedAction(): QuestButtonAction {
    if (this.rawConditionFailedAction !== null) return this.rawConditionFailedAction
    return this.hasCondition ? QuestButtonAction.DISABLE : QuestButtonAction.NONE
  }

  /** ITestable: the condition doubles as the button's tests. */
  get tests(): VarTests {
    return this.condition
  }

  toString(): string {
    return serializeButton(0, this)
  }
}

const ACTION_VALUES = new Map<string, number>([
  ['NONE', 0],
  ['DISABLE', 1],
  ['HIDE', 2],
])
const ACTION_NAMES = new Map<number, string>([
  [0, 'NONE'],
  [1, 'DISABLE'],
  [2, 'HIDE'],
])

/**
 * Port of `Enum.TryParse<QuestButtonAction>(value, ignoreCase: true, out _)`.
 *
 * Accepts a name, a decimal integer (in or out of range), or a comma-separated
 * list of names combined bitwise — .NET does that even for a non-flags enum.
 * Rejects "1.0", "0x1", blanks and numeric lists. Verified against .NET.
 */
function parseAction(value: string): QuestButtonAction | null {
  const trimmed = value.trim()
  if (trimmed.length === 0) return null

  const named = ACTION_VALUES.get(trimmed.toUpperCase())
  if (named !== undefined) return ACTION_NAMES.get(named)!

  if (/^[+-]?[0-9]+$/.test(trimmed)) {
    const numeric = Number(trimmed)
    return ACTION_NAMES.get(numeric) ?? String(numeric)
  }

  if (trimmed.includes(',')) {
    let combined = 0
    for (const part of trimmed.split(',')) {
      const partValue = ACTION_VALUES.get(part.trim().toUpperCase())
      if (partValue === undefined) return null
      combined |= partValue
    }
    return ACTION_NAMES.get(combined) ?? String(combined)
  }

  return null
}

/** Reads button `position` out of an event's ini fields. */
export function buttonFromData(
  data: ContentFields,
  position: number,
  sectionName: string,
  localization?: Localization,
): QuestButtonData {
  const label = readButtonLabel(data, position, sectionName, localization)

  const nextEventString = data.get(`event${position}`)
  const button =
    nextEventString === undefined
      ? new QuestButtonData(label, [])
      : buttonFromSingleString(label, nextEventString)

  const conditionString = data.get(`event${position}Condition`)
  if (conditionString !== undefined && conditionString.trim().length > 0) {
    const tests = new VarTests()
    for (const part of conditionString.split(' ').filter((s) => s.length > 0)) {
      tests.addFromString(part)
    }
    button.condition = tests

    const actionString = data.get(`event${position}ConditionAction`)
    if (actionString !== undefined && actionString.trim().length > 0) {
      const action = parseAction(actionString)
      if (action !== null) button.rawConditionFailedAction = action
    }
  }

  const color = data.get(`buttoncolor${position}`)
  if (color !== undefined) button.color = color

  return button
}

/**
 * Parses the `eventN=` value: `Event1 Event2,var,op,value,action`.
 *
 * The condition is only read when all three of its parts are present, which
 * keeps files written by the unreleased 2.4.11a readable.
 */
export function buttonFromSingleString(label: StringKey, eventDataString: string): QuestButtonData {
  if (eventDataString.trim().length === 0) return new QuestButtonData(label)

  const parts = eventDataString.split(',')
  const questNames = (parts[0] ?? '').split(' ').filter((s) => s.length > 0)

  if (parts.length < 4) return new QuestButtonData(label, questNames)

  const condition = new VarOperation(`${parts[1]!},${parts[2]!},${parts[3]!}`)
  const varTests = new VarTests()
  varTests.add(condition)

  if (parts.length > 4) {
    const action = parseAction(parts[4]!)
    if (action !== null) return new QuestButtonData(label, questNames, varTests, action)
  }

  return new QuestButtonData(label, questNames, varTests)
}

function readButtonLabel(
  data: ContentFields,
  buttonNum: number,
  sectionName: string,
  localization?: Localization,
): StringKey {
  const declared = data.get(`button${buttonNum}`)
  if (declared !== undefined) return StringKey.parse(declared, localization)
  return new StringKey('qst', `${sectionName}.button${buttonNum}`)
}

/** Serialises a button back to its `eventN=` lines. */
export function serializeButton(position: number, button: QuestButtonData): string {
  let result = `event${position}=${button.eventNames.join(' ')}\n`

  if (button.hasCondition) {
    result += `event${position}Condition=${button.condition.toString()}\n`
    if (button.rawConditionFailedAction !== null) {
      result += `event${position}ConditionAction=${button.rawConditionFailedAction.toLowerCase()}\n`
    }
  }
  if (button.color !== DEFAULT_BUTTON_COLOR) {
    result += `buttoncolor${position}="${button.color}"\n`
  }
  return result
}
