/**
 * Tests for the quest data port (T-008).
 *
 * `QuestData.cs` has no dedicated NUnit suite — `QuestComponentTests.cs` is
 * the largest test file in the project but exercises components indirectly
 * through the loader. These tests document the schema directly.
 *
 * Equivalence with the C# is established by the differential harness over
 * 3,479 cases, including 228 published quest manifests and 2,744 sections
 * from 12 real downloaded scenarios.
 */

import { describe, expect, it } from 'vitest'
import { Quest, loadQuestSections, MINIMUM_QUEST_FORMAT } from '../src/quest/Quest.js'
import {
  Activation,
  CustomMonster,
  Door,
  MPlace,
  parseTextAlignment,
  Puzzle,
  QItem,
  QuestComponent,
  QuestEvent,
  QuestUI,
  Spawn,
  TextAlignment,
  Tile,
  Token,
} from '../src/quest/QuestComponent.js'
import {
  buttonFromData,
  buttonFromSingleString,
  QuestButtonAction,
} from '../src/quest/QuestButtonData.js'
import {
  VarOperation,
  VarTests,
  VarTestsLogicalOperator,
  VarTestsParenthesis,
} from '../src/quest/VarTests.js'
import { StringKey } from '../src/i18n/StringKey.js'
import { readFromString } from '../src/ini/IniRead.js'

const fields = (o: Record<string, string>) => new Map(Object.entries(o))

const load = (section: string, o: Record<string, string> = {}, format = 21) =>
  loadQuestSections({ data: new Map([[section, fields(o)]]) }, 'quest.ini', { format })

const one = (section: string, o: Record<string, string> = {}, format = 21) => {
  const map = load(section, o, format)
  const value = map.get(section)
  if (value === undefined) throw new Error(`no component for ${section}`)
  return value
}

describe('QuestComponent', () => {
  it('defaults to no location', () => {
    const c = one('EventFoo')

    expect(c.locationSpecified).toBe(false)
    expect(c.location).toEqual({ x: 0, y: 0 })
  })

  it('marks a location as specified when either axis is given', () => {
    expect(one('EventFoo', { xposition: '3.5' }).locationSpecified).toBe(true)
    expect(one('EventFoo', { yposition: '-2' }).location.y).toBe(-2)
  })

  it('rejects a comma decimal separator in positions', () => {
    // NumberStyles.Float, so no group separators.
    expect(one('EventFoo', { xposition: '0,5' }).location.x).toBe(0)
  })

  it('parses operations', () => {
    const c = one('EventFoo', { operations: '$a,=,1 $b,+,2' })

    expect(c.operations!.map((o) => o.toString())).toEqual(['$a,=,1', '$b,+,2'])
  })

  it('rewrites the format-3 #fire variable name', () => {
    expect(one('EventFoo', { operations: '#fire,=,1' }).operations![0]!.var).toBe('$fire')
  })

  it('adds an implicit end operation to EventEnd before format 9', () => {
    expect(one('EventEnd', {}, 8).operations!.map((o) => o.toString())).toEqual(['$end,=,1'])
    expect(one('EventEnd', {}, 9).operations).toEqual([])
  })

  it('parses vartests', () => {
    const c = one('EventFoo', {
      vartests: 'VarOperation:$a,>,1 VarTestsLogicalOperator:AND VarOperation:$b,<,2',
    })

    expect(c.tests!.varTestsComponents).toHaveLength(3)
  })

  it('converts the legacy conditions field to AND-joined tests', () => {
    const c = one('EventFoo', { conditions: '$a,>,1 $b,<,2' })
    const parts = c.tests!.varTestsComponents

    expect(parts).toHaveLength(3)
    expect(parts[1]).toBeInstanceOf(VarTestsLogicalOperator)
  })

  it('prefers vartests over conditions when both are present', () => {
    const c = one('EventFoo', { vartests: 'VarOperation:$x,>,9', conditions: '$a,>,1 $b,<,2' })

    expect(c.tests!.varTestsComponents).toHaveLength(1)
  })

  it('builds scenario-text keys from the section name', () => {
    const c = one('EventFoo')

    expect(c.genKey('text')).toBe('EventFoo.text')
    expect(c.genQuery('text').fullKey).toBe('{qst:EventFoo.text}')
  })

  it('removeFromArray drops every match', () => {
    expect(QuestComponent.removeFromArray(['a', '', 'b', ''], '')).toEqual(['a', 'b'])
  })
})

describe('QuestEvent', () => {
  it('gives a displayed event a button even when none are declared', () => {
    expect((one('EventFoo') as QuestEvent).buttons).toHaveLength(1)
  })

  it('gives a hidden event no buttons', () => {
    expect((one('EventFoo', { display: 'false' }) as QuestEvent).buttons).toHaveLength(0)
  })

  it('honours an explicit button count', () => {
    expect((one('EventFoo', { buttons: '3' }) as QuestEvent).buttons).toHaveLength(3)
  })

  it('treats a non-numeric quota as a variable name', () => {
    const c = one('EventFoo', { quota: '$counter' }) as QuestEvent

    expect(c.quota).toBe(0)
    expect(c.quotaVar).toBe('$counter')
  })

  it('keeps a numeric quota out of quotaVar', () => {
    const c = one('EventFoo', { quota: '3' }) as QuestEvent

    expect(c.quota).toBe(3)
    expect(c.quotaVar).toBe('')
  })

  it('normalises backslashes in audio and music paths', () => {
    const c = one('EventFoo', { audio: 'a\\b.ogg', music: 'x\\1.ogg y\\2.ogg' }) as QuestEvent

    expect(c.audio).toBe('a/b.ogg')
    expect(c.music).toEqual(['x/1.ogg', 'y/2.ogg'])
  })

  it('clears the location when the event is camera-relative', () => {
    const c = one('EventFoo', { xposition: '5', mincam: 'true' }) as QuestEvent

    expect(c.minCam).toBe(true)
    expect(c.locationSpecified).toBe(false)
  })

  it('renames references to a renamed component', () => {
    const c = one('EventFoo', {
      hero: 'EventOld',
      add: 'EventOld Other',
      remove: 'EventOld',
      trigger: 'DefeatedEventOld',
      event1: 'EventOld EventKeep',
    }) as QuestEvent

    c.changeReference('EventOld', 'EventNew')

    expect(c.heroListName).toBe('EventNew')
    expect(c.addComponents).toEqual(['EventNew', 'Other'])
    expect(c.trigger).toBe('DefeatedEventNew')
    expect(c.buttons[0]!.eventNames).toEqual(['EventNew', 'EventKeep'])
  })

  it('drops references when renamed to the empty string', () => {
    const c = one('EventFoo', { add: 'Gone Kept', event1: 'Gone Kept' }) as QuestEvent

    c.changeReference('Gone', '')

    expect(c.addComponents).toEqual(['Kept'])
    expect(c.buttons[0]!.eventNames).toEqual(['Kept'])
  })
})

describe('Tile', () => {
  it('is always placed', () => {
    expect(one('TileRoom', { side: 'TileSide1' }).locationSpecified).toBe(true)
  })

  it('accepts a custom image instead of a side', () => {
    expect((one('TileRoom', { customImage: 'x.png' }) as Tile).customImage).toBe('x.png')
  })

  it('throws when neither side nor customImage is given (DEVIATION)', () => {
    // The C# calls Application.Quit() here.
    expect(() => one('TileRoom')).toThrow(RangeError)
  })
})

describe('Token, Door, UI', () => {
  it('a token carries no conditions', () => {
    expect(
      (one('TokenA', { type: 'TokenSearch', vartests: 'VarOperation:$a,>,1' }) as Token).tests,
    ).toBeNull()
  })

  it('a token and a door are both cancelable', () => {
    expect((one('TokenA', {}) as Token).cancelable).toBe(true)
    expect((one('DoorA', {}) as Door).cancelable).toBe(true)
  })

  it('a door defaults to white', () => {
    expect((one('DoorA') as Door).colourName).toBe('white')
  })

  it('UI horizontal alignment maps left/right to -1/1', () => {
    expect((one('UIThing', { halign: 'left' }) as QuestUI).hAlign).toBe(-1)
    expect((one('UIThing', { halign: 'right' }) as QuestUI).hAlign).toBe(1)
    expect((one('UIThing', { halign: 'nonsense' }) as QuestUI).hAlign).toBe(0)
  })

  it('UI vertical alignment maps top/bottom to -1/1', () => {
    expect((one('UIThing', { valign: 'top' }) as QuestUI).vAlign).toBe(-1)
    expect((one('UIThing', { valign: 'bottom' }) as QuestUI).vAlign).toBe(1)
  })

  it('textAlignment is vertical, so left and right fall back to CENTER', () => {
    // The enum is TOP/CENTER/BOTTOM — horizontal alignment is halign.
    expect(parseTextAlignment('top')).toBe(TextAlignment.TOP)
    expect(parseTextAlignment('BOTTOM')).toBe(TextAlignment.BOTTOM)
    expect(parseTextAlignment('left')).toBe(TextAlignment.CENTER)
    expect(parseTextAlignment('right')).toBe(TextAlignment.CENTER)
  })

  it('richText only changes on a parseable boolean', () => {
    expect((one('UIThing', { richText: 'true' }) as QuestUI).richText).toBe(true)
    expect((one('UIThing', { richText: 'garbage' }) as QuestUI).richText).toBe(false)
  })
})

describe('Spawn', () => {
  it('parses monsters, traits and placements', () => {
    const s = one('SpawnA', {
      monster: 'MonsterZombie MonsterGhoul',
      traits: 'undead',
      traitpool: 'a b',
      placement1: 'MPlaceA MPlaceB',
      unique: 'true',
      uniquehealth: '5.5',
    }) as Spawn

    expect(s.mTypes).toEqual(['MonsterZombie', 'MonsterGhoul'])
    expect(s.mTraitsRequired).toEqual(['undead'])
    expect(s.mTraitsPool).toEqual(['a', 'b'])
    expect(s.placement[1]).toEqual(['MPlaceA', 'MPlaceB'])
    expect(s.unique).toBe(true)
    expect(s.uniqueHealthBase).toBe(5.5)
  })

  it('renames placements but leaves built-in monster names alone', () => {
    const s = one('SpawnA', {
      monster: 'MonsterZombie CustomThing',
      placement0: 'MPlaceOld',
    }) as Spawn

    s.changeReference('MPlaceOld', 'MPlaceNew')
    expect(s.placement[0]).toEqual(['MPlaceNew'])

    s.changeReference('MonsterZombie', 'Renamed')
    expect(s.mTypes).toContain('MonsterZombie')

    s.changeReference('CustomThing', 'Renamed')
    expect(s.mTypes).toContain('Renamed')
  })
})

describe('CustomMonster, QItem, MPlace, Puzzle, Activation', () => {
  it('expands the attacks count into per-index text keys', () => {
    const m = one('CustomMonsterA', { attacks: 'melee:3 ranged' }) as CustomMonster

    expect(m.investigatorAttacks.get('melee')!.map((k) => k.fullKey)).toEqual([
      '{qst:CustomMonsterA.Attack_melee_1}',
      '{qst:CustomMonsterA.Attack_melee_2}',
      '{qst:CustomMonsterA.Attack_melee_3}',
    ])
    expect(m.investigatorAttacks.get('ranged')).toHaveLength(1)
  })

  it('tracks whether health, horror and awareness were declared', () => {
    const bare = one('CustomMonsterA') as CustomMonster
    expect([bare.healthDefined, bare.horrorDefined, bare.awarenessDefined]).toEqual([
      false,
      false,
      false,
    ])

    const full = one('CustomMonsterA', {
      health: '5',
      horror: '2',
      awareness: '1',
    }) as CustomMonster
    expect([full.healthDefined, full.horrorDefined, full.awarenessDefined]).toEqual([
      true,
      true,
      true,
    ])
  })

  it('falls back from imageplace to image', () => {
    expect((one('CustomMonsterA', { image: 'a\\b.png' }) as CustomMonster).imagePlace).toBe(
      'a/b.png',
    )
  })

  it('a QItem is a starting item unless told otherwise', () => {
    expect((one('QItemA') as QItem).starting).toBe(true)
    expect((one('QItemA', { starting: 'false' }) as QItem).starting).toBe(false)
  })

  it('an MPlace is always placed', () => {
    const m = one('MPlaceA', { master: 'true', rotate: 'true' }) as MPlace

    expect(m.locationSpecified).toBe(true)
    expect([m.master, m.rotate]).toEqual([true, true])
  })

  it('a Puzzle has slide/observation defaults', () => {
    const p = one('PuzzleA') as Puzzle

    expect(p.puzzleClass).toBe('slide')
    expect(p.skill).toBe('{observation}')
    expect([p.puzzleLevel, p.puzzleAltLevel]).toEqual([4, 3])
  })

  it('an Activation exposes its five text keys', () => {
    const a = one('ActivationA') as Activation

    expect(a.abilityKey).toBe('ActivationA.ability')
    expect(a.moveButton.fullKey).toBe('{qst:ActivationA.movebutton}')
  })
})

describe('section dispatch', () => {
  it('routes each prefix to its component type', () => {
    const map = loadQuestSections(
      readFromString(
        [
          '[EventA]',
          'text=x',
          '[TileB]',
          'side=TileSide1',
          '[TokenC]',
          'type=TokenSearch',
          '[DoorD]',
          '[UIE]',
          '[SpawnF]',
          '[MPlaceG]',
          '[QItemH]',
          '[PuzzleI]',
          '[CustomMonsterJ]',
          '[ActivationK]',
        ].join('\n'),
      ),
      'quest.ini',
      { format: 21 },
    )

    expect(map.get('EventA')).toBeInstanceOf(QuestEvent)
    expect(map.get('TileB')).toBeInstanceOf(Tile)
    expect(map.get('TokenC')).toBeInstanceOf(Token)
    expect(map.get('DoorD')).toBeInstanceOf(Door)
    expect(map.get('UIE')).toBeInstanceOf(QuestUI)
    expect(map.get('SpawnF')).toBeInstanceOf(Spawn)
    expect(map.get('MPlaceG')).toBeInstanceOf(MPlace)
    expect(map.get('QItemH')).toBeInstanceOf(QItem)
    expect(map.get('PuzzleI')).toBeInstanceOf(Puzzle)
    expect(map.get('CustomMonsterJ')).toBeInstanceOf(CustomMonster)
    expect(map.get('ActivationK')).toBeInstanceOf(Activation)
  })

  it('renames StartingItem sections to QItem', () => {
    const map = loadQuestSections(readFromString('[StartingItemA]\nitemname=X'), 'quest.ini', {
      format: 21,
    })

    expect(map.has('QItemA')).toBe(true)
    expect(map.has('StartingItemA')).toBe(false)
  })

  it('ignores sections no prefix claims', () => {
    expect(
      loadQuestSections(readFromString('[Nonsense]\nx=1'), 'quest.ini', { format: 21 }).size,
    ).toBe(0)
  })

  it('throws on a duplicate component (DEVIATION)', () => {
    // The C# calls Application.Quit() here.
    const into = loadQuestSections(readFromString('[EventA]\ntext=1'), 'quest.ini', { format: 21 })

    expect(() =>
      loadQuestSections(readFromString('[EventA]\ntext=2'), 'quest.ini', { format: 21 }, into),
    ).toThrow(RangeError)
  })
})

describe('Quest metadata', () => {
  const build = (o: Record<string, string>, context = {}) =>
    new Quest('testquest', fields(o), {
      gameType: 'D2E',
      maxHeroes: 4,
      defaultHeroes: 4,
      currentLang: 'English',
      isMoM: false,
      ...context,
    })

  it('rejects a format outside the supported range', () => {
    expect(build({ format: '21' }).valid).toBe(true)
    expect(build({ format: String(MINIMUM_QUEST_FORMAT - 1) }).valid).toBe(false)
    expect(build({ format: '99' }).valid).toBe(false)
  })

  it('expands shorthand pack ids and sorts the result', () => {
    const q = build({ format: '21', packs: 'extra MoM1E FA CotW' })

    expect(q.packs).toEqual([
      'CotWI',
      'CotWM',
      'CotWT',
      'FAI',
      'FAM',
      'FAT',
      'MoM1EI',
      'MoM1EM',
      'MoM1ET',
      'extra',
    ])
  })

  it('adds the conversion kit for old MoM scenarios that need it', () => {
    expect(
      new Quest('HolyMansion', fields({ format: '16' }), {
        gameType: 'MoM',
        maxHeroes: 5,
        defaultHeroes: 5,
        currentLang: 'English',
        isMoM: true,
      }).packs,
    ).toEqual(['MoM1CK'])
  })

  it('does not add the conversion kit once the format post-dates the split', () => {
    expect(
      new Quest('HolyMansion', fields({ format: '17' }), {
        gameType: 'MoM',
        maxHeroes: 5,
        defaultHeroes: 5,
        currentLang: 'English',
        isMoM: true,
      }).packs,
    ).toEqual([])
  })

  it('defaults music on and clamps the hero counts', () => {
    expect(build({ format: '21' }).defaultMusicOn).toBe(true)
    expect(build({ format: '21', defaultmusicon: 'false' }).defaultMusicOn).toBe(false)
    expect(build({ format: '21', minhero: '0' }).minHero).toBe(1)
    expect(build({ format: '21', maxhero: '99' }).maxHero).toBe(4)
  })

  it('collects per-language names only when the default language is present', () => {
    const withDefault = build({
      format: '21',
      'name.English': 'A Quest',
      'name.German': 'Eine Quest',
    })
    expect(Object.fromEntries(withDefault.languagesName)).toEqual({
      English: 'A Quest',
      German: 'Eine Quest',
    })

    expect(build({ format: '21', 'name.German': 'Eine Quest' }).languagesName.size).toBe(0)
  })

  it('leaves maxHero at the declared default when the quest is invalid', () => {
    // populate returns before the context is consulted.
    expect(build({ format: '99' }).maxHero).toBe(5)
  })
})

describe('QuestButtonData', () => {
  it('defaults the label to the section key', () => {
    expect(buttonFromData(fields({}), 1, 'EventFoo').label.fullKey).toBe('{qst:EventFoo.button1}')
  })

  it('parses event names', () => {
    expect(buttonFromData(fields({ event1: 'A B' }), 1, 'E').eventNames).toEqual(['A', 'B'])
  })

  it('reads an inline condition only when all three parts are present', () => {
    expect(buttonFromSingleString(StringKey.NULL, 'A,$a,>,1').hasCondition).toBe(true)
    expect(buttonFromSingleString(StringKey.NULL, 'A,$a,>').hasCondition).toBe(false)
  })

  it('derives the failure action from whether a condition exists', () => {
    expect(buttonFromData(fields({ event1: 'A' }), 1, 'E').conditionFailedAction).toBe(
      QuestButtonAction.NONE,
    )
    expect(buttonFromData(fields({ event1: 'A,$a,>,1' }), 1, 'E').conditionFailedAction).toBe(
      QuestButtonAction.DISABLE,
    )
  })

  it('accepts an action by name, case-insensitively', () => {
    expect(buttonFromSingleString(StringKey.NULL, 'A,$a,>,1,hide').conditionFailedAction).toBe(
      QuestButtonAction.HIDE,
    )
  })

  it('accepts an action by number, because Enum.TryParse does', () => {
    // A real quirk: "1" is DISABLE and "2" is HIDE.
    expect(buttonFromSingleString(StringKey.NULL, 'A,$a,>,1,2').conditionFailedAction).toBe(
      QuestButtonAction.HIDE,
    )
    expect(
      buttonFromData(
        fields({ event1: 'A', event1Condition: 'VarOperation:$a,>,1', event1ConditionAction: '1' }),
        1,
        'E',
      ).conditionFailedAction,
    ).toBe(QuestButtonAction.DISABLE)
  })

  it('does not range-check a numeric action', () => {
    expect(buttonFromSingleString(StringKey.NULL, 'A,$a,>,1,99').conditionFailedAction).toBe('99')
  })

  it('rejects a non-integer numeric action', () => {
    expect(buttonFromSingleString(StringKey.NULL, 'A,$a,>,1,1.0').conditionFailedAction).toBe(
      QuestButtonAction.DISABLE,
    )
  })

  it('ignores a blank separate condition', () => {
    expect(
      buttonFromData(fields({ event1: 'A', event1Condition: '   ' }), 1, 'E').hasCondition,
    ).toBe(false)
  })

  it('round-trips through serialisation', () => {
    const b = buttonFromData(fields({ event1: 'A B,$a,>,1,hide', buttoncolor1: 'red' }), 1, 'E')

    expect(b.toString()).toContain('event0=A B')
    expect(b.toString()).toContain('buttoncolor0="red"')
  })
})

describe('VarTests', () => {
  const build = (...parts: string[]) => {
    const tests = new VarTests()
    for (const part of parts) tests.addFromString(part)
    return tests
  }

  it('parses each component kind', () => {
    const tests = build(
      'VarTestsParenthesis:(',
      'VarOperation:$a,>,1',
      'VarTestsLogicalOperator:AND',
      'VarOperation:$b,<,2',
      'VarTestsParenthesis:)',
    )

    expect(tests.varTestsComponents.map((c) => c.componentType)).toEqual([
      'VarTestsParenthesis',
      'VarOperation',
      'VarTestsLogicalOperator',
      'VarOperation',
      'VarTestsParenthesis',
    ])
  })

  it('ignores an unknown component kind', () => {
    expect(build('Nonsense:x').varTestsComponents).toHaveLength(0)
  })

  it('keeps a malformed operation instead of throwing (DEVIATION)', () => {
    // The C# logs and then indexes past the end.
    const op = new VarOperation('$a,>')

    expect(op.var).toBe('$a')
    expect(op.operation).toBe('>')
    expect(op.value).toBe('')
  })

  it('round-trips through toString', () => {
    const source = 'VarOperation:$a,>,1 VarTestsLogicalOperator:AND VarOperation:$b,<,2'
    const tests = build(...source.split(' '))

    expect(tests.toString().trim()).toBe(source)
  })

  it('matches parentheses, including nested ones', () => {
    const tests = build(
      'VarTestsParenthesis:(',
      'VarTestsParenthesis:(',
      'VarOperation:$a,>,1',
      'VarTestsParenthesis:)',
      'VarTestsParenthesis:)',
    )

    expect(tests.findClosingParenthesis(0)).toBe(4)
    expect(tests.findClosingParenthesis(1)).toBe(3)
    expect(tests.findOpeningParenthesis(4)).toBe(0)
  })

  it('returns -1 for an unmatched or out-of-range parenthesis', () => {
    expect(build('VarTestsParenthesis:(').findClosingParenthesis(0)).toBe(-1)
    expect(build('VarOperation:$a,>,1').findClosingParenthesis(5)).toBe(-1)
  })

  it('removes an operation together with its operator', () => {
    const tests = build('VarOperation:$a,>,1', 'VarTestsLogicalOperator:AND', 'VarOperation:$b,<,2')
    tests.remove(2)

    expect(tests.varTestsComponents.map((c) => c.toString())).toEqual(['$a,>,1'])
  })

  it('removes a parenthesis together with its pair', () => {
    const tests = build('VarTestsParenthesis:(', 'VarOperation:$a,>,1', 'VarTestsParenthesis:)')
    tests.remove(0)

    expect(tests.varTestsComponents.map((c) => c.componentType)).toEqual(['VarOperation'])
  })

  it('adds a parenthesis at the front and anything else at the back', () => {
    const tests = build('VarOperation:$a,>,1')
    tests.add(new VarTestsParenthesis('('))
    tests.add(new VarTestsLogicalOperator('OR'))

    expect(tests.varTestsComponents.map((c) => c.componentType)).toEqual([
      'VarTestsParenthesis',
      'VarOperation',
      'VarTestsLogicalOperator',
    ])
  })

  it('flips a logical operator', () => {
    const op = new VarTestsLogicalOperator('AND')
    op.nextLogicalOperator()
    expect(op.op).toBe('OR')
    op.nextLogicalOperator()
    expect(op.op).toBe('AND')
  })
})

describe('serialisation back to ini', () => {
  it('writes position, comment, operations and tests', () => {
    const c = one('EventFoo', {
      xposition: '1.5',
      yposition: '-2',
      comment: 'a note',
      operations: '$a,=,1 $b,+,2',
      vartests: 'VarOperation:$x,>,0',
    })

    const text = c.toString()

    expect(text).toContain('[EventFoo]')
    expect(text).toContain('xposition=1.5')
    expect(text).toContain('yposition=-2')
    expect(text).toContain('comment=a note')
    expect(text).toContain('operations=$a,=,1 $b,+,2')
    expect(text).toContain('vartests=VarOperation:$x,>,0')
  })

  it('omits everything unset', () => {
    expect(one('EventFoo', { display: 'false' }).toString()).toBe('[EventFoo]\n')
  })

  it('writes tile fields', () => {
    const text = one('TileRoom', {
      side: 'TileSide1',
      rotation: '90',
      customImage: 'x.png',
      top: '1.5',
      left: '-2',
    }).toString()

    expect(text).toContain('side=TileSide1')
    expect(text).toContain('rotation=90')
    expect(text).toContain('customImage=x.png')
    expect(text).toContain('top=1.5')
    expect(text).toContain('left=-2')
  })

  it('omits a tile rotation of zero and a default door colour', () => {
    expect(one('TileRoom', { side: 'S' }).toString()).not.toContain('rotation')
    expect(one('DoorA').toString()).not.toContain('color')
  })

  it('writes door and token fields', () => {
    expect(one('DoorA', { rotation: '90', color: '#FF0000' }).toString()).toContain('color=#FF0000')

    const token = one('TokenA', {
      type: 'TokenSearch',
      rotation: '45',
      tokensize: 'small',
      clickeffect: 'false',
      customImage: 'x.png',
    }).toString()

    expect(token).toContain('type=TokenSearch')
    expect(token).toContain('tokensize=small')
    expect(token).toContain('clickeffect=false')
    expect(token).toContain('customImage=x.png')
  })

  it('writes MPlace and Activation flags only when set', () => {
    const mplace = one('MPlaceA', { master: 'true', rotate: 'true', tokensize: 'big' }).toString()
    expect(mplace).toContain('master=true')
    expect(mplace).toContain('rotate=true')
    expect(mplace).toContain('tokensize=big')

    expect(one('MPlaceA').toString()).not.toContain('master')

    const activation = one('ActivationA', {
      minionfirst: 'true',
      masterfirst: 'true',
    }).toString()
    expect(activation).toContain('minionfirst=True')
    expect(activation).toContain('masterfirst=True')
  })
})

describe('VarTests movement', () => {
  const build = (...parts: string[]) => {
    const tests = new VarTests()
    for (const part of parts) tests.addFromString(part)
    return tests
  }

  const layout = () =>
    build(
      'VarOperation:$a,>,1',
      'VarTestsLogicalOperator:AND',
      'VarOperation:$b,<,2',
      'VarTestsLogicalOperator:OR',
      'VarOperation:$c,=,3',
    )

  it('finds the next position for an operation in both directions', () => {
    const tests = layout()

    expect(tests.findNextValidPosition(2, true)).toBe(0)
    expect(tests.findNextValidPosition(2, false)).toBe(4)
  })

  it('returns -1 for a logical operator, which cannot be moved', () => {
    expect(layout().findNextValidPosition(1, true)).toBe(-1)
  })

  it('swaps two operations when moved up', () => {
    const tests = layout()
    tests.moveComponent(2, true)

    expect(tests.varTestsComponents.map((c) => c.toString())).toEqual([
      '$b,<,2',
      'AND',
      '$a,>,1',
      'OR',
      '$c,=,3',
    ])
  })

  it('swaps two operations when moved down', () => {
    const tests = layout()
    tests.moveComponent(0, false)

    expect(tests.varTestsComponents.map((c) => c.toString())).toEqual([
      '$b,<,2',
      'AND',
      '$a,>,1',
      'OR',
      '$c,=,3',
    ])
  })

  it('moves a parenthesis to a valid slot', () => {
    const tests = build(
      'VarTestsParenthesis:(',
      'VarOperation:$a,>,1',
      'VarTestsLogicalOperator:AND',
      'VarOperation:$b,<,2',
      'VarTestsParenthesis:)',
    )

    expect(tests.findNextValidPosition(0, false)).toBe(2)
    expect(tests.findNextValidPosition(4, true)).toBe(2)
  })

  it('does nothing when there is nowhere valid to move', () => {
    const tests = build('VarOperation:$a,>,1')
    tests.moveComponent(0, true)

    expect(tests.varTestsComponents).toHaveLength(1)
  })

  it('removes an operation nested in parentheses by dropping them too', () => {
    const tests = build('VarTestsParenthesis:(', 'VarOperation:$a,>,1', 'VarTestsParenthesis:)')
    tests.remove(1)

    expect(tests.varTestsComponents).toHaveLength(0)
  })

  it('ignores a remove past the end', () => {
    const tests = build('VarOperation:$a,>,1')
    tests.remove(9)

    expect(tests.varTestsComponents).toHaveLength(1)
  })
})

describe('scenario-text keys', () => {
  it('every component exposes the keys its text lives under', () => {
    const event = one('EventFoo') as QuestEvent
    expect([event.textKey, event.text.fullKey]).toEqual(['EventFoo.text', '{qst:EventFoo.text}'])

    const ui = one('UIThing') as QuestUI
    expect([ui.uiTextKey, ui.uiText.fullKey]).toEqual(['UIThing.uitext', '{qst:UIThing.uitext}'])

    const spawn = one('SpawnA') as Spawn
    expect([
      spawn.uniqueTitleKey,
      spawn.uniqueTextKey,
      spawn.uniqueTitle.fullKey,
      spawn.uniqueText.fullKey,
    ]).toEqual([
      'SpawnA.uniquetitle',
      'SpawnA.uniquetext',
      '{qst:SpawnA.uniquetitle}',
      '{qst:SpawnA.uniquetext}',
    ])

    const monster = one('CustomMonsterA') as CustomMonster
    expect([
      monster.monsterNameKey,
      monster.infoKey,
      monster.monsterName.fullKey,
      monster.info.fullKey,
    ]).toEqual([
      'CustomMonsterA.monstername',
      'CustomMonsterA.info',
      '{qst:CustomMonsterA.monstername}',
      '{qst:CustomMonsterA.info}',
    ])

    const activation = one('ActivationA') as Activation
    expect([
      activation.abilityKey,
      activation.minionKey,
      activation.masterKey,
      activation.moveButtonKey,
      activation.moveKey,
    ]).toEqual([
      'ActivationA.ability',
      'ActivationA.minion',
      'ActivationA.master',
      'ActivationA.movebutton',
      'ActivationA.move',
    ])
    expect([
      activation.ability.fullKey,
      activation.minionActions.fullKey,
      activation.masterActions.fullKey,
      activation.move.fullKey,
    ]).toEqual([
      '{qst:ActivationA.ability}',
      '{qst:ActivationA.minion}',
      '{qst:ActivationA.master}',
      '{qst:ActivationA.move}',
    ])
  })

  it('a quest exposes its five metadata keys', () => {
    const q = new Quest('x', fields({ format: '21' }))

    expect([
      q.name.fullKey,
      q.description.fullKey,
      q.synopsys.fullKey,
      q.authors.fullKey,
      q.authorsShort.fullKey,
    ]).toEqual([
      '{qst:quest.name}',
      '{qst:quest.description}',
      '{qst:quest.synopsys}',
      '{qst:quest.authors}',
      '{qst:quest.authors_short}',
    ])
  })

  it('removeReference deletes by renaming to the empty string', () => {
    const c = one('EventFoo', { add: 'Gone Kept' }) as QuestEvent
    c.removeReference('Gone')

    expect(c.addComponents).toEqual(['Kept'])
  })

  it('a QItem follows a renamed inspect event', () => {
    const item = one('QItemA', { inspect: 'EventOld' }) as QItem
    item.changeReference('EventOld', 'EventNew')

    expect(item.inspect).toBe('EventNew')
  })

  it('logged parse helpers default on bad input', () => {
    expect(one('TokenA', { rotation: 'bad' }).sectionName).toBe('TokenA')
    expect((one('TokenA', { rotation: 'bad' }) as Token).rotation).toBe(0)
    expect((one('MPlaceA', { master: 'bad' }) as MPlace).master).toBe(false)
  })
})
