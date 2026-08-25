/**
 * Name-for-name migrations of the C# cases that are cheap to carry across:
 * pure functions where a named test says exactly what broke.
 *
 * The behaviour-grouped suites elsewhere (quest.test.ts, content.test.ts,
 * rules.test.ts) already assert all of this; these exist so a regression in,
 * say, `CodeGuess.CorrectType` names itself instead of surfacing as a generic
 * failure. `tools/conformance/ledger.mjs` reports which C# names are matched.
 */

import { describe, expect, it } from 'vitest'
import {
  VarOperation,
  VarTests,
  VarTestsLogicalOperator,
  VarTestsParenthesis,
} from '../src/quest/VarTests.js'
import { VarManager } from '../src/quest/VarManager.js'
import {
  CodeAnswer,
  CodeGuess,
  PuzzleCode,
  PuzzleSlide,
  PuzzleTower,
  SlideBlock,
  TilePosition,
  PuzzleImage,
} from '../src/quest/puzzles.js'
import { versionCodeGenerate } from '../src/version/version.js'

const fields = (o: Record<string, string>) => new Map(Object.entries(o))
const answer = (s: string) => CodeAnswer.parse(s)
const build = (...parts: string[]) => {
  const t = new VarTests()
  for (const p of parts) t.addFromString(p)
  return t
}
const vm = (saved: Record<string, string> = {}) => VarManager.fromSaved(fields(saved))

// ---------------------------------------------------------------------------
// VarTestsTests.cs
// ---------------------------------------------------------------------------

describe('VarTestsTests.cs', () => {
  it('Constructor_Default_CreatesEmptyComponentsList', () => {
    expect(new VarTests().varTestsComponents).toEqual([])
  })

  it('Constructor_WithList_AssignsComponentsList', () => {
    const op = new VarOperation('$a,>,1')
    expect(new VarTests([op]).varTestsComponents).toEqual([op])
  })

  it('Add_StringWithVarOperation_ParsesAndAddsComponent', () => {
    expect(build('VarOperation:$a,>,1').varTestsComponents[0]).toBeInstanceOf(VarOperation)
  })

  it('Add_StringWithLogicalOperator_ParsesAndAddsComponent', () => {
    expect(build('VarTestsLogicalOperator:OR').varTestsComponents[0]).toBeInstanceOf(
      VarTestsLogicalOperator,
    )
  })

  it('Add_StringWithParenthesis_ParsesAndAddsComponent', () => {
    expect(build('VarTestsParenthesis:(').varTestsComponents[0]).toBeInstanceOf(VarTestsParenthesis)
  })

  it('Add_ParenthesisComponent_InsertsAtBeginning', () => {
    const t = build('VarOperation:$a,>,1')
    t.add(new VarTestsParenthesis('('))
    expect(t.varTestsComponents[0]).toBeInstanceOf(VarTestsParenthesis)
  })

  it('Add_NonParenthesisComponent_AppendsToEnd', () => {
    const t = build('VarOperation:$a,>,1')
    t.add(new VarTestsLogicalOperator('OR'))
    expect(t.varTestsComponents[1]).toBeInstanceOf(VarTestsLogicalOperator)
  })

  const paren = () => build('VarTestsParenthesis:(', 'VarOperation:$a,>,1', 'VarTestsParenthesis:)')
  const nested = () =>
    build(
      'VarTestsParenthesis:(',
      'VarTestsParenthesis:(',
      'VarOperation:$a,>,1',
      'VarTestsParenthesis:)',
      'VarTestsParenthesis:)',
    )

  it('FindClosingParenthesis_SimpleCase_ReturnsCorrectIndex', () => {
    expect(paren().findClosingParenthesis(0)).toBe(2)
  })

  it('FindClosingParenthesis_NestedParentheses_ReturnsOuterClosing', () => {
    expect(nested().findClosingParenthesis(0)).toBe(4)
  })

  it('FindClosingParenthesis_InnerParentheses_ReturnsInnerClosing', () => {
    expect(nested().findClosingParenthesis(1)).toBe(3)
  })

  it('FindClosingParenthesis_NoMatchingParenthesis_ReturnsMinusOne', () => {
    expect(build('VarTestsParenthesis:(').findClosingParenthesis(0)).toBe(-1)
  })

  it('FindOpeningParenthesis_SimpleCase_ReturnsCorrectIndex', () => {
    expect(paren().findOpeningParenthesis(2)).toBe(0)
  })

  it('FindOpeningParenthesis_NestedParentheses_ReturnsOuterOpening', () => {
    expect(nested().findOpeningParenthesis(4)).toBe(0)
  })

  it('FindOpeningParenthesis_InnerParentheses_ReturnsInnerOpening', () => {
    expect(nested().findOpeningParenthesis(3)).toBe(1)
  })

  it('FindOpeningParenthesis_NoMatchingParenthesis_ReturnsMinusOne', () => {
    expect(build('VarTestsParenthesis:)').findOpeningParenthesis(0)).toBe(-1)
  })

  const chain = () =>
    build('VarOperation:$a,>,1', 'VarTestsLogicalOperator:AND', 'VarOperation:$b,<,2')

  it('FindNextValidPosition_LogicalOperator_ReturnsMinusOne', () => {
    expect(chain().findNextValidPosition(1, true)).toBe(-1)
  })

  it('FindNextValidPosition_VarOperationUp_FindsNextVarOperation', () => {
    expect(chain().findNextValidPosition(2, true)).toBe(0)
  })

  it('FindNextValidPosition_VarOperationDown_FindsNextVarOperation', () => {
    expect(chain().findNextValidPosition(0, false)).toBe(2)
  })

  it('FindNextValidPosition_VarOperationNoTarget_ReturnsMinusOne', () => {
    expect(build('VarOperation:$a,>,1').findNextValidPosition(0, true)).toBe(-1)
  })

  it('Remove_SingleVarOperation_RemovesIt', () => {
    const t = build('VarOperation:$a,>,1')
    t.remove(0)
    expect(t.varTestsComponents).toHaveLength(0)
  })

  it('Remove_VarOperationWithPrecedingOperator_RemovesBoth', () => {
    const t = chain()
    t.remove(2)
    expect(t.varTestsComponents.map((c) => c.toString())).toEqual(['$a,>,1'])
  })

  it('Remove_VarOperationWithFollowingOperator_RemovesBoth', () => {
    const t = chain()
    t.remove(0)
    expect(t.varTestsComponents.map((c) => c.toString())).toEqual(['$b,<,2'])
  })

  it('Remove_OpeningParenthesis_RemovesBoth', () => {
    const t = paren()
    t.remove(0)
    expect(t.varTestsComponents).toHaveLength(1)
  })

  it('Remove_ClosingParenthesis_RemovesBoth', () => {
    const t = paren()
    t.remove(2)
    expect(t.varTestsComponents).toHaveLength(1)
  })

  it('ToString_EmptyList_ReturnsEmptyString', () => {
    expect(new VarTests().toString()).toBe('')
  })

  it('ToString_WithComponents_ReturnsFormattedString', () => {
    expect(build('VarOperation:$a,>,1').toString()).toBe('VarOperation:$a,>,1 ')
  })

  it('VarTestsLogicalOperator_DefaultConstructor_SetsAND', () => {
    expect(new VarTestsLogicalOperator().op).toBe('AND')
  })

  it('VarTestsLogicalOperator_ParameterizedConstructor_SetsValue', () => {
    expect(new VarTestsLogicalOperator('OR').op).toBe('OR')
  })

  it('VarTestsLogicalOperator_NextLogicalOperator_TogglesANDtoOR', () => {
    const op = new VarTestsLogicalOperator('AND')
    op.nextLogicalOperator()
    expect(op.op).toBe('OR')
  })

  it('VarTestsLogicalOperator_NextLogicalOperator_TogglesORtoAND', () => {
    const op = new VarTestsLogicalOperator('OR')
    op.nextLogicalOperator()
    expect(op.op).toBe('AND')
  })

  it('VarTestsLogicalOperator_GetVarTestsComponentType_ReturnsCorrectType', () => {
    expect(new VarTestsLogicalOperator().componentType).toBe('VarTestsLogicalOperator')
  })

  it('VarTestsLogicalOperator_ToString_ReturnsOperator', () => {
    expect(new VarTestsLogicalOperator('OR').toString()).toBe('OR')
  })

  it('VarTestsParenthesis_ParameterizedConstructor_SetsValue', () => {
    expect(new VarTestsParenthesis('(').parenthesis).toBe('(')
  })

  it('VarTestsParenthesis_GetVarTestsComponentType_ReturnsCorrectType', () => {
    expect(new VarTestsParenthesis('(').componentType).toBe('VarTestsParenthesis')
  })

  it('VarTestsParenthesis_ToString_ReturnsParenthesis', () => {
    expect(new VarTestsParenthesis(')').toString()).toBe(')')
  })

  it('VarOperation_ParameterizedConstructor_ParsesCorrectly', () => {
    const op = new VarOperation('$a,>=,5')
    expect([op.var, op.operation, op.value]).toEqual(['$a', '>=', '5'])
  })

  it('VarOperation_GetVarTestsComponentType_ReturnsCorrectType', () => {
    expect(new VarOperation('$a,>,1').componentType).toBe('VarOperation')
  })

  it('VarOperation_ToString_ReturnsFormattedString', () => {
    expect(new VarOperation('$a,>,1').toString()).toBe('$a,>,1')
  })

  it('VarOperation_UpdateVarName_ConvertsFireVariable', () => {
    expect(new VarOperation('#fire,=,1').var).toBe('$fire')
  })

  it('VarOperation_UpdateVarName_ConvertsFireInValue', () => {
    expect(new VarOperation('$a,=,#fire').value).toBe('$fire')
  })
})

// ---------------------------------------------------------------------------
// VarManagerTests.cs
// ---------------------------------------------------------------------------

describe('VarManagerTests.cs', () => {
  it('Constructor_Default_CreatesEmptyVarsDictionary', () => {
    expect(new VarManager().vars.size).toBe(0)
  })

  it('Constructor_WithDictionaryData_ParsesValuesCorrectly', () => {
    expect(vm({ $a: '5.5' }).getValue('$a')).toBe(5.5)
  })

  it('Constructor_WithDictionaryData_HandlesInvalidFloatValues', () => {
    expect(vm({ $a: 'abc' }).getValue('$a')).toBe(0)
  })

  it('Constructor_WithDictionaryData_StripsBackslashFromHashKeys', () => {
    expect(vm({ '\\#x': '5' }).getValue('#x')).toBe(5)
  })

  it('GetValue_ExistingVar_ReturnsValue', () => {
    expect(vm({ $a: '3' }).getValue('$a')).toBe(3)
  })

  it('GetValue_NonExistingVar_ReturnsZero', () => {
    expect(vm().getValue('$nope')).toBe(0)
  })

  it('GetValue_NegativeValue_ReturnsCorrectValue', () => {
    expect(vm({ $a: '-7.5' }).getValue('$a')).toBe(-7.5)
  })

  it('GetPrefixVars_MatchingPrefix_ReturnsFilteredDictionary', () => {
    expect([...vm({ $a: '1', $ab: '2', b: '3' }).getPrefixVars('$a').keys()]).toEqual(['$a', '$ab'])
  })

  it('GetPrefixVars_NoMatchingPrefix_ReturnsEmptyDictionary', () => {
    expect(vm({ $a: '1' }).getPrefixVars('zzz').size).toBe(0)
  })

  it('GetPrefixVars_EmptyVars_ReturnsEmptyDictionary', () => {
    expect(vm().getPrefixVars('$').size).toBe(0)
  })

  it('GetPrefixVars_ExactMatchOnly_DoesNotReturnPartialMatch', () => {
    expect([...vm({ $abc: '1', $b: '2' }).getPrefixVars('$abc').keys()]).toEqual(['$abc'])
  })

  it('TrimQuest_KeepsPercentVars_RemovesOthers', () => {
    const m = vm({ '%camp': '1', $quest: '2' })
    m.trimQuest()
    expect([...m.vars.keys()]).toEqual(['%camp'])
  })

  it('TrimQuest_KeepsDollarPercentVars_RemovesOthers', () => {
    const m = vm({ '$%camp': '1', $quest: '2' })
    m.trimQuest()
    expect([...m.vars.keys()]).toEqual(['$%camp'])
  })

  it('TrimQuest_EmptyVars_RemainsEmpty', () => {
    const m = vm()
    m.trimQuest()
    expect(m.vars.size).toBe(0)
  })

  it('TrimQuest_MixedVars_KeepsOnlyPersistentTypes', () => {
    const m = vm({ '%a': '1', '$%b': '2', $c: '3', d: '4' })
    m.trimQuest()
    expect([...m.vars.keys()].sort()).toEqual(['$%b', '%a'])
  })

  const check = (saved: Record<string, string>, op: string) =>
    vm(saved).test(build(`VarOperation:${op}`))

  it('Test_EqualOperator_ReturnsTrueWhenEqual', () => {
    expect(check({ $a: '1' }, '$a,==,1')).toBe(true)
  })

  it('Test_EqualOperator_ReturnsFalseWhenNotEqual', () => {
    expect(check({ $a: '1' }, '$a,==,2')).toBe(false)
  })

  it('Test_NotEqualOperator_ReturnsTrueWhenDifferent', () => {
    expect(check({ $a: '1' }, '$a,!=,2')).toBe(true)
  })

  it('Test_NotEqualOperator_ReturnsFalseWhenEqual', () => {
    expect(check({ $a: '1' }, '$a,!=,1')).toBe(false)
  })

  it('Test_GreaterThanOrEqualOperator_ReturnsTrueWhenGreater', () => {
    expect(check({ $a: '2' }, '$a,>=,1')).toBe(true)
  })

  it('Test_GreaterThanOrEqualOperator_ReturnsTrueWhenEqual', () => {
    expect(check({ $a: '1' }, '$a,>=,1')).toBe(true)
  })

  it('Test_GreaterThanOrEqualOperator_ReturnsFalseWhenLess', () => {
    expect(check({ $a: '0' }, '$a,>=,1')).toBe(false)
  })

  it('Test_LessThanOrEqualOperator_ReturnsTrueWhenLess', () => {
    expect(check({ $a: '0' }, '$a,<=,1')).toBe(true)
  })

  it('Test_LessThanOrEqualOperator_ReturnsTrueWhenEqual', () => {
    expect(check({ $a: '1' }, '$a,<=,1')).toBe(true)
  })

  it('Test_LessThanOrEqualOperator_ReturnsFalseWhenGreater', () => {
    expect(check({ $a: '2' }, '$a,<=,1')).toBe(false)
  })

  it('Test_GreaterThanOperator_ReturnsTrueWhenGreater', () => {
    expect(check({ $a: '2' }, '$a,>,1')).toBe(true)
  })

  it('Test_GreaterThanOperator_ReturnsFalseWhenEqual', () => {
    expect(check({ $a: '1' }, '$a,>,1')).toBe(false)
  })

  it('Test_LessThanOperator_ReturnsTrueWhenLess', () => {
    expect(check({ $a: '0' }, '$a,<,1')).toBe(true)
  })

  it('Test_LessThanOperator_ReturnsFalseWhenEqual', () => {
    expect(check({ $a: '1' }, '$a,<,1')).toBe(false)
  })

  it('Test_UnknownOperator_ReturnsFalse', () => {
    expect(check({ $a: '1' }, '$a,?,1')).toBe(false)
  })

  it('Test_NegativeValues_ComparesCorrectly', () => {
    expect(check({ $a: '-5' }, '$a,<,-1')).toBe(true)
  })

  it('Test_DecimalValues_ComparesCorrectly', () => {
    expect(check({ $a: '1.5' }, '$a,>,1.4')).toBe(true)
  })

  it('Test_NullVarTests_ReturnsTrue', () => {
    expect(vm().test(null)).toBe(true)
  })

  it('Test_EmptyVarTests_ReturnsTrue', () => {
    expect(vm().test(new VarTests())).toBe(true)
  })

  it('Test_SingleTrueCondition_ReturnsTrue', () => {
    expect(check({ $a: '1' }, '$a,==,1')).toBe(true)
  })

  it('Test_SingleFalseCondition_ReturnsFalse', () => {
    expect(check({ $a: '1' }, '$a,==,9')).toBe(false)
  })

  const pair = (saved: Record<string, string>, a: string, join: string, b: string) =>
    vm(saved).test(
      build(`VarOperation:${a}`, `VarTestsLogicalOperator:${join}`, `VarOperation:${b}`),
    )

  it('Test_TwoConditionsWithAnd_BothTrue_ReturnsTrue', () => {
    expect(pair({ $a: '1', $b: '2' }, '$a,==,1', 'AND', '$b,==,2')).toBe(true)
  })

  it('Test_TwoConditionsWithAnd_OneFalse_ReturnsFalse', () => {
    expect(pair({ $a: '1', $b: '2' }, '$a,==,1', 'AND', '$b,==,9')).toBe(false)
  })

  it('Test_TwoConditionsWithOr_OneFalse_ReturnsTrue', () => {
    expect(pair({ $a: '1', $b: '2' }, '$a,==,9', 'OR', '$b,==,2')).toBe(true)
  })

  it('Test_TwoConditionsWithOr_BothFalse_ReturnsFalse', () => {
    expect(pair({ $a: '1', $b: '2' }, '$a,==,9', 'OR', '$b,==,9')).toBe(false)
  })

  it('ToString_EmptyVars_ReturnsHeaderOnly', () => {
    expect(vm().toString()).toBe('[Vars]\n\n')
  })

  it('ToString_WithVars_ContainsKeyValuePairs', () => {
    expect(vm({ $a: '5' }).toString()).toContain('$a=5')
  })

  it('ToString_ZeroValueVars_AreNotIncluded', () => {
    expect(vm({ $a: '0' }).toString()).toBe('[Vars]\n\n')
  })

  it('ToString_HashVars_AreEscapedWithBackslash', () => {
    expect(vm({ '\\#x': '5' }).toString()).toContain('\\#x=5')
  })
})

// ---------------------------------------------------------------------------
// PuzzleCodeTests.cs
// ---------------------------------------------------------------------------

describe('PuzzleCodeTests.cs', () => {
  const guessOf = (a: string, g: string) => new CodeGuess(answer(a), g)

  it('Answer_StringConstructor_ParsesSingleValue', () => {
    expect(answer('3').state).toEqual([3])
  })

  it('Answer_StringConstructor_ParsesMultipleValues', () => {
    expect(answer('1 2 3 4').state).toEqual([1, 2, 3, 4])
  })

  it('Answer_StringConstructor_HandlesInvalidValue', () => {
    expect(answer('1 x 3').state).toEqual([1, 0, 3])
  })

  it('Answer_ToString_ReturnsSpaceSeparatedValues', () => {
    expect(answer('1 2 3').toString()).toBe('1 2 3')
  })

  it('CodeGuess_ListConstructor_StoresGuess', () => {
    expect(new CodeGuess(answer('1 2'), [3, 4]).guess).toEqual([3, 4])
  })

  it('CodeGuess_StringConstructor_ParsesGuess', () => {
    expect(guessOf('1 2', '3 4').guess).toEqual([3, 4])
  })

  it('CodeGuess_Correct_AllMatch_ReturnsTrue', () => {
    expect(guessOf('1 2 3', '1 2 3').correct()).toBe(true)
  })

  it('CodeGuess_Correct_OneMismatch_ReturnsFalse', () => {
    expect(guessOf('1 2 3', '1 2 4').correct()).toBe(false)
  })

  it('CodeGuess_Correct_AllMismatch_ReturnsFalse', () => {
    expect(guessOf('1 2 3', '4 5 6').correct()).toBe(false)
  })

  it('CodeGuess_CorrectSpot_AllCorrect_ReturnsCount', () => {
    expect(guessOf('1 2 3', '1 2 3').correctSpot()).toBe(3)
  })

  it('CodeGuess_CorrectSpot_NoneCorrect_ReturnsZero', () => {
    expect(guessOf('1 2 3', '4 5 6').correctSpot()).toBe(0)
  })

  it('CodeGuess_CorrectSpot_SomeCorrect_ReturnsPartialCount', () => {
    expect(guessOf('1 2 3', '1 5 3').correctSpot()).toBe(2)
  })

  it('CodeGuess_CorrectType_AllWrongSpotRightType_ReturnsCount', () => {
    expect(guessOf('1 2 3', '3 1 2').correctType()).toBe(3)
  })

  it('CodeGuess_CorrectType_NoMatchingTypes_ReturnsZero', () => {
    expect(guessOf('1 2 3', '4 5 6').correctType()).toBe(0)
  })

  it('CodeGuess_CorrectType_MixedCorrectSpotAndType_CountsOnlyWrongSpot', () => {
    expect(guessOf('1 2 3', '1 3 2').correctType()).toBe(2)
  })

  it('CodeGuess_CorrectType_DuplicateValuesInGuess_CountsOnce', () => {
    // Verified against the C#: the 2 in the right place is excluded from both
    // sides, and the remaining answer positions hold 1 and 3, so nothing is
    // left to match. The count is 0, not 1.
    expect(guessOf('1 2 3', '2 2 2').correctSpot()).toBe(1)
    expect(guessOf('1 2 3', '2 2 2').correctType()).toBe(0)
  })

  it('CodeGuess_ToString_ReturnsSpaceSeparatedValues', () => {
    expect(guessOf('1 2', '3 4').toString()).toBe('3 4')
  })

  it('PuzzleCode_DictionaryConstructor_ParsesAnswer', () => {
    expect(PuzzleCode.fromSaved(fields({ answer: '1 2 3' })).answer.state).toEqual([1, 2, 3])
  })

  it('PuzzleCode_DictionaryConstructor_ParsesGuesses', () => {
    expect(PuzzleCode.fromSaved(fields({ answer: '1 2', guess: '1 2,2 1' })).guess).toHaveLength(2)
  })

  it('PuzzleCode_DictionaryConstructor_EmptyGuess_CreatesEmptyList', () => {
    expect(PuzzleCode.fromSaved(fields({ answer: '1 2' })).guess).toHaveLength(0)
  })

  const withSolution = (solution: string) => PuzzleCode.create(0, 0, solution, () => 0)

  it('PuzzleCode_Solved_NoGuesses_ReturnsFalse', () => {
    expect(withSolution('1 2 3').solved()).toBe(false)
  })

  it('PuzzleCode_Solved_LastGuessCorrect_ReturnsTrue', () => {
    const p = withSolution('1 2 3')
    p.addGuess([1, 2, 3])
    expect(p.solved()).toBe(true)
  })

  it('PuzzleCode_Solved_LastGuessIncorrect_ReturnsFalse', () => {
    const p = withSolution('1 2 3')
    p.addGuess([1, 2, 3])
    p.addGuess([3, 2, 1])
    expect(p.solved()).toBe(false)
  })

  it('PuzzleCode_AddGuess_AddsToGuessList', () => {
    const p = withSolution('1 2 3')
    p.addGuess([1, 1, 1])
    expect(p.guess).toHaveLength(1)
  })

  it('PuzzleCode_ToString_ContainsAnswerAndGuess', () => {
    const p = withSolution('1 2 3')
    p.addGuess([1, 2, 3])
    const text = p.toSectionString('1')
    expect(text).toContain('answer=1 2 3')
    expect(text).toContain('guess=1 2 3')
  })
})

// ---------------------------------------------------------------------------
// PuzzleTests.cs — the slide, tower and image types
// ---------------------------------------------------------------------------

describe('PuzzleTests.cs', () => {
  const block = (s: string) => SlideBlock.parse(s)
  const tower = (o: Record<string, string>) => PuzzleTower.fromSaved(fields(o))

  it('Block_ConstructFromString_ParsesAllFieldsCorrectly', () => {
    const b = block('True,0,1,5,2,False')
    expect([b.rotation, b.xlen, b.ylen, b.xpos, b.ypos, b.target]).toEqual([
      true,
      0,
      1,
      5,
      2,
      false,
    ])
  })

  it('Block_ConstructFromString_TargetBlockParsesCorrectly', () => {
    expect(block('False,1,0,0,2,True').target).toBe(true)
  })

  it('Block_ToString_ProducesCorrectFormat', () => {
    expect(block('False,1,0,0,2,True').toString()).toBe('False,1,0,0,2,True')
  })

  it('Block_CopyConstructor_CreatesIndependentCopy', () => {
    const original = block('False,1,0,0,2,True')
    const copy = original.clone()
    copy.xpos = 5
    expect(original.xpos).toBe(0)
  })

  it('Block_Blocks_SingleCell_ReturnsTrueForOverlappingPosition', () => {
    expect(block('False,0,0,3,3,False').blocksSquare(3, 3)).toBe(true)
  })

  it('Block_Blocks_HorizontalBlock_ReturnsTrueForAllCoveredPositions', () => {
    const b = block('False,2,0,1,2,False')
    expect([b.blocksSquare(1, 2), b.blocksSquare(2, 2), b.blocksSquare(3, 2)]).toEqual([
      true,
      true,
      true,
    ])
  })

  it('Block_Blocks_VerticalBlock_ReturnsTrueForAllCoveredPositions', () => {
    const b = block('True,0,2,4,1,False')
    expect([b.blocksSquare(4, 1), b.blocksSquare(4, 2), b.blocksSquare(4, 3)]).toEqual([
      true,
      true,
      true,
    ])
  })

  it('Block_BlocksOtherBlock_ReturnsTrueWhenOverlapping', () => {
    expect(block('False,1,0,0,2,True').blocksBlock(block('False,1,0,1,2,False'))).toBe(true)
  })

  it('Block_BlocksOtherBlock_ReturnsFalseWhenNotOverlapping', () => {
    expect(block('False,1,0,0,2,True').blocksBlock(block('False,1,0,4,5,False'))).toBe(false)
  })

  it('Block_BlocksList_ReturnsTrueIfAnyBlockOverlaps', () => {
    expect(
      block('False,1,0,0,2,True').blocksAny([
        block('False,1,0,4,5,False'),
        block('False,1,0,1,2,False'),
      ]),
    ).toBe(true)
  })

  it('Block_BlocksList_ReturnsFalseIfNoBlockOverlaps', () => {
    expect(block('False,1,0,0,2,True').blocksAny([block('False,1,0,4,5,False')])).toBe(false)
  })

  const hardCoded = () => PuzzleSlide.fromSaved(PuzzleSlide.hardCodedPuzzle())

  it('PuzzleSlide_Empty_ReturnsFalseForNegativeCoordinates', () => {
    expect(PuzzleSlide.empty([], -1, 0)).toBe(false)
    expect(PuzzleSlide.empty([], 0, -1)).toBe(false)
  })

  it('PuzzleSlide_Empty_ReturnsFalseForOutOfBoundsY', () => {
    expect(PuzzleSlide.empty([], 0, 6)).toBe(false)
  })

  it('PuzzleSlide_Empty_AllowsExitOnlyOnRow2', () => {
    expect(PuzzleSlide.empty([], 6, 2)).toBe(true)
    expect(PuzzleSlide.empty([], 6, 3)).toBe(false)
  })

  it('PuzzleSlide_Empty_ReturnsFalseWhenBlockOccupiesPosition', () => {
    expect(PuzzleSlide.empty([block('False,1,0,0,2,True')], 0, 2)).toBe(false)
  })

  it('PuzzleSlide_HardCodedPuzzle_ReturnsValidPuzzleData', () => {
    expect(PuzzleSlide.hardCodedPuzzle().size).toBe(11)
  })

  it('PuzzleSlide_Loadpuzzle_LoadsBlocksAndMoves', () => {
    const p = hardCoded()
    expect(p.moves).toBe(0)
    expect(p.puzzle).toHaveLength(10)
  })

  it('PuzzleSlide_Solved_ReturnsTrueWhenTargetAtExit', () => {
    expect(PuzzleSlide.fromSaved(fields({ block0: 'False,1,0,6,2,True' })).solved()).toBe(true)
  })

  it('PuzzleSlide_Solved_ReturnsFalseWhenTargetNotAtExit', () => {
    expect(hardCoded().solved()).toBe(false)
  })

  it('PuzzleSlide_ToString_ProducesValidSaveFormat', () => {
    const text = hardCoded().toSectionString('1')
    expect(text).toContain('[PuzzleSlide1]')
    expect(text).toContain('block0=False,1,0,0,2,True')
  })

  const three = { moves: '0', 0: '7 6 5', 1: '', 2: '' }

  it('PuzzleTower_MoveOK_ReturnsFalseForInvalidFromTower', () => {
    expect(tower(three).moveOK(9, 1)).toBe(false)
  })

  it('PuzzleTower_MoveOK_ReturnsFalseForInvalidToTower', () => {
    expect(tower(three).moveOK(0, 9)).toBe(false)
  })

  it('PuzzleTower_MoveOK_ReturnsFalseForEmptyFromTower', () => {
    expect(tower(three).moveOK(1, 0)).toBe(false)
  })

  it('PuzzleTower_MoveOK_ReturnsTrueForMoveToEmptyTower', () => {
    expect(tower(three).moveOK(0, 1)).toBe(true)
  })

  it('PuzzleTower_MoveOK_ReturnsTrueForSmallerOntoLarger', () => {
    expect(tower({ moves: '0', 0: '3', 1: '7', 2: '' }).moveOK(0, 1)).toBe(true)
  })

  it('PuzzleTower_MoveOK_ReturnsFalseForLargerOntoSmaller', () => {
    expect(tower({ moves: '0', 0: '7', 1: '3', 2: '' }).moveOK(0, 1)).toBe(false)
  })

  it('PuzzleTower_Move_MovesDiscCorrectly', () => {
    const p = tower(three)
    p.move(0, 1)
    expect(p.puzzle).toEqual([[7, 6], [5], []])
  })

  it('PuzzleTower_Move_DoesNothingForInvalidMove', () => {
    const p = tower({ moves: '0', 0: '7', 1: '3', 2: '' })
    p.move(0, 1)
    expect(p.puzzle).toEqual([[7], [3], []])
  })

  it('PuzzleTower_Solved_ReturnsTrueWhenAllDiscsOnOneTowerInOrder', () => {
    expect(tower({ moves: '0', 0: '7 6 5 4 3 2 1 0', 1: '', 2: '' }).solved()).toBe(true)
  })

  it('PuzzleTower_Solved_ReturnsFalseWhenDiscsSpreadAcrossTowers', () => {
    expect(tower({ moves: '0', 0: '7 6 5 4', 1: '3 2 1 0', 2: '' }).solved()).toBe(false)
  })

  it('PuzzleTower_Solved_ReturnsFalseWhenDiscsOutOfOrder', () => {
    expect(tower({ moves: '0', 0: '0 1 2 3 4 5 6 7', 1: '', 2: '' }).solved()).toBe(false)
  })

  it('PuzzleTower_ReverseMoveOK_ReturnsFalseForInvalidTower', () => {
    expect(PuzzleTower.reverseMoveOK(9, [[7], [], []])).toBe(false)
  })

  it('PuzzleTower_ReverseMoveOK_ReturnsFalseForEmptyTower', () => {
    expect(PuzzleTower.reverseMoveOK(1, [[7], [], []])).toBe(false)
  })

  it('PuzzleTower_ReverseMoveOK_ReturnsTrueForSingleDisc', () => {
    expect(PuzzleTower.reverseMoveOK(0, [[7], [], []])).toBe(true)
  })

  it('PuzzleTower_ReverseMoveOK_ReturnsTrueWhenTopSmallerThanBase', () => {
    expect(PuzzleTower.reverseMoveOK(0, [[7, 3], [], []])).toBe(true)
  })

  it('PuzzleTower_ToString_ProducesValidSaveFormat', () => {
    const text = tower({ moves: '4', 0: '7 6', 1: '', 2: '5' }).toSectionString('1')
    expect(text).toContain('[PuzzleTower1]')
    expect(text).toContain('moves=4')
    expect(text).toContain('0=7 6')
  })

  it('PuzzleTower_Loadpuzzle_RestoresStateCorrectly', () => {
    expect(tower({ moves: '3', 0: '7 6', 1: '5', 2: '' }).puzzle).toEqual([[7, 6], [5], []])
  })

  it('TilePosition_ConstructFromInts_SetsCoordinatesCorrectly', () => {
    const p = new TilePosition(2, 3)
    expect([p.x, p.y]).toEqual([2, 3])
  })

  it('TilePosition_ConstructFromString_ParsesCorrectly', () => {
    const p = new TilePosition('4 5')
    expect([p.x, p.y]).toEqual([4, 5])
  })

  it('TilePosition_ToString_ProducesCorrectFormat', () => {
    expect(new TilePosition(1, 2).toString()).toBe('1 2')
  })

  it('TilePosition_RoundTrip_PreservesValues', () => {
    const p = new TilePosition(new TilePosition(6, 7).toString())
    expect([p.x, p.y]).toEqual([6, 7])
  })

  it('PuzzleImage_Solved_ReturnsTrueWhenAllTilesInPlace', () => {
    expect(PuzzleImage.fromSaved(fields({ state: '0 0,0 0:1 1,1 1' })).solved()).toBe(true)
  })

  it('PuzzleImage_Solved_ReturnsFalseWhenTilesSwapped', () => {
    expect(PuzzleImage.fromSaved(fields({ state: '0 0,1 1:1 1,0 0' })).solved()).toBe(false)
  })

  it('PuzzleImage_LoadFromDictionary_RestoresMoves', () => {
    expect(PuzzleImage.fromSaved(fields({ moves: '9', state: '0 0,0 0' })).moves).toBe(9)
  })

  it('PuzzleImage_ToString_ProducesValidSaveFormat', () => {
    const text = PuzzleImage.fromSaved(fields({ moves: '2', state: '0 0,1 1' })).toSectionString(
      '1',
    )
    expect(text).toContain('[PuzzleImage1]')
    expect(text).toContain('moves=2')
    expect(text).toContain('state=0 0,1 1')
  })
})

// ---------------------------------------------------------------------------
// SetVersionTests.cs
// ---------------------------------------------------------------------------

describe('SetVersionTests.cs', () => {
  it.each([
    ['3.12.1', '30120010'],
    ['3.12.0', '30120000'],
    ['1.0.0', '10000000'],
    ['2.5', '20050000'],
    ['3.12a', '0'],
    ['2.5b', '0'],
  ])('VersionCodeGenerate_ReturnsCorrectCode %s', (input, expected) => {
    expect(versionCodeGenerate(input)).toBe(expected)
  })
})
