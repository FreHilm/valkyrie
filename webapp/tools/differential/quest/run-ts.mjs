import { readFileSync, writeFileSync } from 'node:fs'
import { Quest, loadQuestSections } from '../../../packages/core/src/quest/Quest.ts'
import {
  buttonFromData,
  QuestButtonData,
} from '../../../packages/core/src/quest/QuestButtonData.ts'
import { VarTests } from '../../../packages/core/src/quest/VarTests.ts'
import { StringKey } from '../../../packages/core/src/i18n/StringKey.ts'
import { readFromStringArray } from '../../../packages/core/src/ini/IniRead.ts'
import { Localization } from '../../../packages/core/src/i18n/Localization.ts'
import { textAlignmentName } from '../../../packages/core/src/quest/QuestComponent.ts'

const corpus = JSON.parse(readFileSync(process.argv[2], 'utf8'))

const fields = (o) => new Map(Object.entries(o))

const render = (v) => {
  if (v === null || v === undefined) return null
  if (v instanceof StringKey) return v.fullKey
  if (v instanceof VarTests) return v.toString()
  if (v instanceof QuestButtonData) {
    return {
      label: v.label.fullKey,
      eventNames: v.eventNames,
      color: v.color,
      condition: v.condition.toString(),
      action: v.conditionFailedAction,
    }
  }
  if (v instanceof Map) return [...v].map(([k, val]) => [render(k), render(val)])
  if (Array.isArray(v)) return v.map(render)
  if (typeof v === 'number' && !Number.isFinite(v)) {
    return Number.isNaN(v) ? 'NaN' : v > 0 ? 'Infinity' : '-Infinity'
  }
  if (typeof v === 'object' && 'x' in v && 'y' in v && Object.keys(v).length === 2) {
    return [render(v.x), render(v.y)]
  }
  if (typeof v === 'object' && 'componentType' in v) {
    return `${v.componentType}:${v.toString()}`
  }
  return v
}

// The C# dumper skips these; mirror it.
const SKIPPED = new Set(['type', 'image', 'gameObject'])

/**
 * The port renames the C#'s snake_case key accessors to camelCase, and exposes
 * the ITestable members as lowercase fields. Mapping them back keeps the
 * comparison about behaviour rather than naming.
 */
const RENAMED = new Map([
  ['textKey', 'text_key'],
  ['uiTextKey', 'uitext_key'],
  ['monsterNameKey', 'monstername_key'],
  ['infoKey', 'info_key'],
  ['uniqueTitleKey', 'uniquetitle_key'],
  ['uniqueTextKey', 'uniquetext_key'],
  ['abilityKey', 'ability_key'],
  ['minionKey', 'minion_key'],
  ['masterKey', 'master_key'],
  ['moveButtonKey', 'movebutton_key'],
  ['moveKey', 'move_key'],
])

function dumpComponent(c) {
  const out = {}
  const own = { ...c }
  for (const key of Object.keys(own).sort()) {
    if (SKIPPED.has(key)) continue
    // The C# dumps the enum, whose ToString is the member name or, for a
    // value outside the enum, the number.
    const value = key === 'textAlignment' ? textAlignmentName(own[key]) : own[key]
    out[RENAMED.get(key) ?? key] = render(value)
  }
  // Getters live on the prototype, so they are collected explicitly.
  for (const [name, value] of accessorValues(c)) {
    if (SKIPPED.has(name)) continue
    out[RENAMED.get(name) ?? name] = render(value)
  }
  // ITestable is a pair of properties in C#, backed by the same state.
  out.Tests = out.tests
  out.Operations = out.operations

  // Emitted in name order so the raw JSON comparison is not order-sensitive.
  const sorted = {}
  for (const key of Object.keys(out).sort()) sorted[key] = out[key]
  return sorted
}

function accessorValues(c) {
  const seen = new Map()
  let proto = Object.getPrototypeOf(c)
  while (proto !== null && proto !== Object.prototype) {
    for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(proto))) {
      if (descriptor.get === undefined || seen.has(name)) continue
      seen.set(name, c[name])
    }
    proto = Object.getPrototypeOf(proto)
  }
  return [...seen].sort((a, b) => (a[0] < b[0] ? -1 : 1))
}

function dumpComponents(map) {
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([name, c]) => [name, dumpComponent(c)])
}

function questContext(c) {
  return { maxHeroes: (c.maxHeroes ?? 4) + 1, localization: new Localization() }
}

function dumpVarTests(tests) {
  return tests.varTestsComponents.map((v) => [v.componentType, v.toString()])
}

const results = corpus.map((c) => {
  const r = { name: c.name }
  try {
    r.ok = true

    if (c.kind === 'section') {
      const data = new Map([[c.section, fields(c.fields)]])
      const map = loadQuestSections({ data }, c.source ?? 'quest.ini', {
        format: c.format ?? 21,
        context: questContext(c),
      })
      r.data = dumpComponents(map)
    } else if (c.kind === 'loadIni') {
      const ini = readFromStringArray(c.lines, 'quest.ini')
      const map = loadQuestSections(ini, c.source ?? 'quest.ini', {
        format: c.format ?? 21,
        context: questContext(c),
      })
      r.data = dumpComponents(map)
    } else if (c.kind === 'quest') {
      const quest = new Quest(c.identifier, fields(c.fields), {
        gameType: c.gameType ?? 'D2E',
        maxHeroes: c.maxHeroes ?? 4,
        defaultHeroes: c.defaultHeroes ?? 4,
        currentLang: 'English',
        isMoM: c.isMoM === true,
      })
      // An invalid quest returns before most fields are assigned, so only the
      // two that are set before the format check are comparable.
      r.data =
        quest.valid === false
          ? { valid: false, format: quest.format, identifier: quest.identifier }
          : {
              valid: quest.valid,
              defaultLanguage: quest.defaultLanguage,
              defaultMusicOn: quest.defaultMusicOn,
              difficulty: quest.difficulty,
              format: quest.format,
              hidden: quest.hidden,
              identifier: quest.identifier,
              image: quest.image,
              languages_authors_short: render(quest.languagesAuthorsShort),
              languages_name: render(quest.languagesName),
              languages_synopsys: render(quest.languagesSynopsys),
              lengthMax: quest.lengthMax,
              lengthMin: quest.lengthMin,
              maxHero: quest.maxHero,
              minHero: quest.minHero,
              packs: quest.packs,
              path: quest.path,
              type: quest.type,
              version: quest.version,
            }
    } else if (c.kind === 'varTests') {
      const tests = new VarTests()
      for (const part of c.parts) tests.addFromString(part)

      const o = {
        toString: tests.toString(),
        count: tests.varTestsComponents.length,
        items: dumpVarTests(tests),
      }
      if (c.remove !== undefined) {
        tests.remove(c.remove)
        o.afterRemove = dumpVarTests(tests)
      }
      if (c.findClosing !== undefined) o.findClosing = tests.findClosingParenthesis(c.findClosing)
      if (c.findOpening !== undefined) o.findOpening = tests.findOpeningParenthesis(c.findOpening)
      if (c.nextPos !== undefined) o.nextPos = tests.findNextValidPosition(c.nextPos, c.up)
      if (c.move !== undefined) {
        tests.moveComponent(c.move, c.up)
        o.afterMove = dumpVarTests(tests)
      }
      r.data = o
    } else if (c.kind === 'button') {
      const b = buttonFromData(fields(c.fields), c.position, c.section)
      r.data = {
        label: b.label.fullKey,
        eventNames: b.eventNames,
        color: b.color,
        hasCondition: b.hasCondition,
        conditionFailedAction: b.conditionFailedAction,
        condition: b.condition.toString(),
        toString: b.toString(),
      }
    } else {
      throw new Error('unknown kind')
    }
  } catch (e) {
    r.ok = false
    r.error = e.constructor.name
    delete r.data
  }
  return r
})

writeFileSync(process.argv[3], JSON.stringify(results))
console.log('ts cases:', results.length)
