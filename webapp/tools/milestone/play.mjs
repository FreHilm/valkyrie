/**
 * Plays a real published scenario from start to an ending, through the ported
 * engine, and reports what happened.
 *
 * This is the T-018 milestone as a check rather than a claim: it loads the
 * Mansions content packs from the repository, parses the scenario, and drives
 * QuestSession the way a player would — exploring, ending turns, answering
 * events, activating monsters — until the quest ends or it can make no further
 * progress.
 *
 * It is not a differential: there is no C# to compare against, because the C#
 * cannot be run headless. What it proves is that the engine gets through a real
 * scenario without stalling and without warnings, which is the thing no unit
 * test can tell us.
 *
 * Skips cleanly when the scenario or the imported assets are absent, as the
 * other content-dependent harnesses do.
 *
 *   node tools/milestone/play.mjs [scenarioDir]
 */
/** Play the milestone scenario with real content loaded. */
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

// Everything from the package, one identity: questArt looks content up by
// class, and the same class imported twice through different specifiers gives
// two distinct objects that never match.
import {
  ActivationData,
  bundleQuest,
  ContentData,
  ContentLoader,
  DictionaryI18n,
  fameLevel,
  generateItemSelection,
  headlessContext,
  ItemData,
  QItem,
  loadQuestSections,
  MonsterData,
  QuestSession,
  readFromString,
  setLogSink,
  TILE_PIXELS_PER_SQUARE,
  TileSideData,
  WEB_TEXTURE_EXTENSIONS,
} from '@valkyrie/core'
import { buildScene, sceneBounds } from '../../packages/ui/src/boardScene.ts'
import { questArt } from '../../packages/app/src/questArt.ts'

const repo = join(here, '../../..')
const warnings = []
setLogSink((m) => warnings.push(m))

// --- content -------------------------------------------------------------
const ctx = headlessContext({
  importPath: join(homedir(), '.cache/valkyrie-web-port/ffg/MoM-import/import'),
  // A Mansions tile is 1024 pixels across 3.5 squares; without this every
  // tile divides by zero and lands at NaN.
  tilePixelPerSquare: TILE_PIXELS_PER_SQUARE.MoM,
  resolveTextureFile: (name) => {
    for (const e of WEB_TEXTURE_EXTENSIONS) if (existsSync(name + e)) return name + e
    return existsSync(name) ? name : null
  },
})
if (!existsSync(join(repo, 'unity/Assets/StreamingAssets/content/MoM'))) {
  console.log('milestone: no Mansions content — skipped')
  process.exit(0)
}

// The game's own strings, from the player's import. `loadContent` registers
// these as `ffg`, and without them every name the game ships — monsters,
// tiles, items — stays a raw `{ffg:KEY}`, which is what this harness used to
// print in place of them.
const importText = join(homedir(), '.cache/valkyrie-web-port/ffg/MoM-import/import/text')
if (existsSync(importText)) {
  const lines = []
  for (const file of readdirSync(importText).filter((f) => /^Localization_en\.txt$/i.test(f))) {
    lines.push(...readFileSync(join(importText, file), 'utf8').split(/\r?\n/))
  }
  if (lines.length > 0) ctx.localization.addDictionary('ffg', new DictionaryI18n(lines))
}

const content = new ContentData(ctx)
const loader = new ContentLoader(content, ctx)
for (const packIni of execSync(
  `find "${repo}/unity/Assets/StreamingAssets/content/MoM" -name content_pack.ini`,
  { encoding: 'utf8' },
)
  .split('\n')
  .filter(Boolean)) {
  const packDir = dirname(packIni)
  const declared = ['content_pack.ini']
  let section = ''
  for (const raw of readFileSync(packIni, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('[')) {
      section = line.replace(/^\[|\]$/g, '')
      continue
    }
    if (section !== 'ContentPackData' || !line || line.startsWith('#')) continue
    declared.push(line.includes('=') ? line.slice(0, line.indexOf('=')).trim() : line)
  }
  for (const name of declared) {
    try {
      loader.loadIni(
        readFromString(readFileSync(join(packDir, name), 'utf8')),
        packDir,
        packDir.slice(repo.length + 1),
      )
    } catch {
      /* declared but absent */
    }
  }
}
const contentMonsters = new Map(
  content
    .getAll(MonsterData)
    .map(([k, v]) => [
      k,
      { traits: v.traits, sectionName: v.sectionName, activations: v.activations },
    ]),
)
const contentActivations = new Map(content.getAll(ActivationData))

// --- quest ---------------------------------------------------------------
const dir =
  process.argv[2] ??
  join(homedir(), '.cache/valkyrie-web-port/quests/extracted/MoM__TheFallofHouseLynch')

if (!existsSync(dir)) {
  console.log('milestone: no scenario — skipped (needs a downloaded quest package)')
  process.exit(0)
}
const components = new Map()
for (const f of readdirSync(dir).filter((f) => f.endsWith('.ini') && f !== 'quest.ini')) {
  loadQuestSections(readFromString(readFileSync(join(dir, f), 'utf8')), f, {}, components)
}

// The scenario's own strings, as `addQuestText` registers them. Without this
// every line the engine produces is a raw `{qst:...}` key, and every check
// that looks at text — the `{c:...}` markers below among them — passes by
// looking at nothing.
const language = 'English'
const questText = readdirSync(dir).filter((f) => /^Localization\..*\.txt$/.test(f))
const preferred =
  questText.find((f) => f === `Localization.${language}.txt`) ?? questText[0] ?? null
if (preferred !== null) {
  const lines = readFileSync(join(dir, preferred), 'utf8').split(/\r?\n/)
  const dictionary = new DictionaryI18n(lines)
  dictionary.defaultLanguage = language
  dictionary.currentLanguage = language
  ctx.localization.addDictionary('qst', dictionary)
}

let seed = 20260825
const random = (n) => (n <= 0 ? 0 : ((seed = (seed * 1664525 + 1013904223) >>> 0) >>> 9) % n)

const session = new QuestSession({
  bundle: bundleQuest(components),
  components,
  contentMonsters,
  contentActivations,
  // `{c:Name}` in a scenario's prose is replaced with what the thing is
  // called, and a tile's name lives in the content rather than the quest.
  contentName: (kind, name) => {
    const type = kind === 'tileSide' ? TileSideData : kind === 'monster' ? MonsterData : ItemData
    const data = content.tryGet(type, name)
    return data === undefined ? null : data.name.translate()
  },
  random,
  localization: ctx.localization,
})
session.runtime.heroes.push(
  { heroName: 'HeroAshcanPete', activated: false },
  { heroName: 'HeroAgnesBaker', activated: false },
)

// `Quest`'s constructor calls `GenerateItemSelection` before any event runs,
// and the app does it during party setup. Without it every `QItem` the
// scenario names resolves to nothing: no card beside a dialog, and a
// `{c:QItem...}` marker that reads as its own section name.
const itemsById = new Map(content.getAll(ItemData))
for (const [section, item] of generateItemSelection(
  [...components.values()].filter((c) => c instanceof QItem),
  {
    items: itemsById,
    fame: fameLevel((name) => session.runtime.vars.getValue(name)),
    held: session.runtime.items(),
    random,
    warn: (message) => warnings.push(message),
  },
)) {
  session.runtime.itemSelect.set(section, item)
}

session.start()

const clicked = new Set()
const seen = []
/** `{c:...}` markers that reached the screen unreplaced. */
const unresolved = new Set()
let activations = 0
let steps = 0
let perTurn = 0
for (; steps < 4000; steps++) {
  const v = session.view()
  if (v.kind === 'event') {
    seen.push(v.name)
    // A marker that survived is a marker the player would read. The engine
    // replaces `{c:...}` before anything is drawn, so one showing up here is
    // a component the scenario names and does not declare, or a resolver that
    // stopped working.
    for (const line of [v.text, ...v.buttons.map((x) => x.label)]) {
      for (const marker of line.match(/\{c:[^}]*\}/g) ?? []) unresolved.add(`${v.name}: ${marker}`)
    }
    const b = v.buttons.find((x) => !x.disabled)
    if (b === undefined) break
    session.press(b.index)
  } else if (v.kind === 'activation') {
    activations++
    session.activationDone()
  } else if (v.kind === 'phase') {
    session.phaseAcknowledged()
  } else if (v.kind === 'ended') {
    break
  } else {
    const clickable = session.runtime
      .boardItems()
      .filter((i) => ['Token', 'Door', 'UI'].includes(i.component.type))
      .map((i) => i.name)
      .filter((n) => !clicked.has(n))
    // Two actions per investigator turn, then end it — closer to how the game
    // is actually played than clicking the whole board at once.
    if (clickable.length > 0 && session.rounds.phase === 'investigator' && perTurn < 2) {
      perTurn++
      clicked.add(clickable[0])
      session.activate(clickable[0])
    } else if (session.rounds.phase === 'investigator') {
      perTurn = 0
      session.investigatorsDone()
    } else if (!session.endRound() && session.view().kind === 'board') {
      // The horror phase waits for the players by design; say we are done.
      if (!session.endPhase() && session.view().kind === 'board') break
    }
  }
}

const ended = session.view().kind === 'ended'
console.log(
  `milestone: ${seen.length} events over ${session.runtime.vars.getValue('#round')} rounds, ` +
    `${activations} monster activations, ` +
    `${ended ? 'reached an ending' : 'did NOT reach an ending'}, ${warnings.length} warnings`,
)
console.log(`content monsters loaded : ${contentMonsters.size}`)
console.log(`content activations      : ${contentActivations.size}`)
console.log(`steps                   : ${steps}`)
console.log(`events seen             : ${seen.length} (${new Set(seen).size} distinct)`)
console.log(`board items clicked     : ${clicked.size}`)
console.log(`monster activations     : ${activations}`)
console.log(`monsters on the board   : ${session.runtime.monsters.length}`)
for (const m of session.runtime.monsters) console.log(`    ${m.monsterName}  (from ${m.spawnedBy})`)
console.log(`round                   : ${session.runtime.vars.getValue('#round')}`)
console.log(`items held              : ${session.runtime.items().length}`)
console.log(`log entries             : ${session.runtime.log.length}`)
console.log(`quest ended             : ${ended}`)
console.log(`unreplaced {c:} markers : ${unresolved.size}`)
for (const marker of unresolved) console.log(`    ${marker}`)
// --- what the board would draw ------------------------------------------
// The real art layer, not a stand-in: this is what the app uses.
const resolveTexture = ctx.resolveTextureFile
const sources = questArt({
  content,
  components,
  resolveTexture,
  // Every image reports 1024x1024 here; the check is that geometry resolves,
  // not that the pixels are right — the dds harness covers those.
  sizeOf: (path) => (resolveTexture(path) === null ? null : { width: 1024, height: 1024 }),
  questPath: dir,
  gameType: 'MoM',
  pixelsPerSquare: TILE_PIXELS_PER_SQUARE.MoM,
})
const scene = buildScene(session.runtime.boardItems(), session.runtime.monsters, sources)
const bounds = sceneBounds(scene)
const withArt = scene.filter((s) => s.source !== null).length
console.log(`scene items             : ${scene.length} (${withArt} with art)`)
if (bounds !== null) {
  console.log(
    `board extent            : x ${bounds.min.x.toFixed(1)}..${bounds.max.x.toFixed(1)}, ` +
      `y ${bounds.min.y.toFixed(1)}..${bounds.max.y.toFixed(1)}`,
  )
}
const broken = scene.filter(
  (s) => !Number.isFinite(s.placed.centre.x) || !Number.isFinite(s.placed.centre.y),
)
console.log(`items with a bad position: ${broken.length}`)
for (const b of broken.slice(0, 3)) console.log(`    ${b.id}`)

console.log(`warnings                : ${warnings.length}`)
for (const w of [...new Set(warnings)].slice(0, 6)) console.log(`    ${w}`)

process.exit(ended && warnings.length === 0 ? 0 : 1)
