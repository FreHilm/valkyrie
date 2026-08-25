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
  headlessContext,
  loadQuestSections,
  MonsterData,
  QuestSession,
  readFromString,
  setLogSink,
  TILE_PIXELS_PER_SQUARE,
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

let seed = 20260825
const random = (n) => (n <= 0 ? 0 : ((seed = (seed * 1664525 + 1013904223) >>> 0) >>> 9) % n)

const session = new QuestSession({
  bundle: bundleQuest(components),
  components,
  contentMonsters,
  contentActivations,
  random,
})
session.runtime.heroes.push(
  { heroName: 'HeroAshcanPete', activated: false },
  { heroName: 'HeroAgnesBaker', activated: false },
)
session.start()

const clicked = new Set()
const seen = []
let activations = 0
let steps = 0
let perTurn = 0
for (; steps < 4000; steps++) {
  const v = session.view()
  if (v.kind === 'event') {
    seen.push(v.name)
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
