/**
 * Random round-controller scenarios.
 *
 * Long command sequences matter more than exotic single calls: the parts of
 * this loop that are easy to get wrong are the ones where state carries over
 * between activations and between rounds.
 */
import { writeFileSync } from 'node:fs'

let seed = 0x5bd1e995
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000
const pick = (a) => a[Math.floor(rnd() * a.length)]
const int = (max) => Math.floor(rnd() * max)
const chance = (p) => rnd() < p

const TRIGGERS = [
  'DefeatedMonsterT0',
  'DefeatedMonsterT1',
  'DefeatedSpawnA',
  'DefeatedSpawnB',
  'EndRound',
  'EndRound0',
  'EndRound1',
  'EndRound2',
  'StartRound',
  'StartFinalRound',
  'Eliminated',
  'NoMorale',
  'Mythos',
  'BeforeMonsterActivation',
  'EndInvestigatorTurn',
]

const COMMANDS = [
  'heroActivated',
  'monsterActivated',
  'checkNewRound',
  'activateMonster',
  'endRound',
  'reset',
  'closeEvent',
  'health',
]

// Defeating a monster is Mansions-only: `MonsterDialogMoM.Defeated` has no
// Descent counterpart, and the Descent path lives in `MonsterDialog.cs`, which
// is not ported yet.
const MOM_COMMANDS = [...COMMANDS, 'defeatFirst', 'defeatFirst']

const PHASES = ['investigator', 'mythos', 'monsters', 'horror']

function activation() {
  const both = chance(0.6)
  return {
    minion: both || chance(0.5) ? 'MinionText' : '',
    master: both || chance(0.5) ? 'MasterText' : '',
    minionFirst: chance(0.15),
    masterFirst: chance(0.15),
  }
}

function scenario(index) {
  const mom = chance(0.5)
  const typeCount = 1 + int(3)
  const monsterTypes = {}
  const contentActivations = {}
  const questActivations = {}
  const events = {}

  for (let t = 0; t < typeCount; t++) {
    const name = `MonsterT${t}`
    const kind = rnd()
    if (kind < 0.35) {
      // A quest monster whose sole activation is an event. Some of the names
      // only *contain* "Event" — the C# tests the prefix, and a name like
      // `MonsterEventTrap` must not be treated as an event activation.
      const event = chance(0.25) ? `T${t}EventActs` : `EventT${t}`
      events[event] = { disabled: chance(0.4) }
      monsterTypes[name] = { quest: true, activations: [event], healthBase: int(5) }
      if (chance(0.7)) questActivations[`Activation${event}`] = activation()
    } else if (kind < 0.6) {
      // A quest monster with its own activation list.
      const activations = []
      for (let a = 0; a < 1 + int(2); a++) {
        const section = `ActivationT${t}A${a}`
        activations.push(`T${t}A${a}`)
        if (chance(0.75)) {
          questActivations[section] = activation()
          if (chance(0.4)) questActivations[section].tests = [`#flag${int(3)}>0`]
        }
        if (chance(0.4)) contentActivations[`MonsterActivationT${t}A${a}`] = activation()
      }
      monsterTypes[name] = {
        quest: true,
        useMonsterTypeActivations: false,
        activations,
        healthBase: int(5),
        healthPerHero: pick([0, 0.5, 1]),
      }
    } else if (kind < 0.75) {
      // Derived from another content type.
      monsterTypes[name] = { quest: true, derivedType: 'MonsterT0', activations: [] }
      monsterTypes.MonsterT0 ??= { activations: [] }
    } else {
      const activations = chance(0.5) ? [`Common${int(2)}`] : []
      monsterTypes[name] = { activations, healthBase: int(6), healthPerHero: pick([0, 0.5, 1, 2]) }
      for (const common of activations) {
        if (chance(0.8)) contentActivations[`MonsterActivation${common}`] = activation()
      }
      if (chance(0.85)) contentActivations[`MonsterActivationT${t}A`] = activation()
      if (chance(0.3)) contentActivations[`MonsterActivationT${t}B`] = activation()
    }
  }

  const names = Object.keys(monsterTypes)
  const monsters = []
  for (let m = 0; m < int(4); m++) {
    monsters.push({
      id: `m${m}`,
      type: pick(names),
      spawnedBy: pick(['', 'SpawnA', 'SpawnB']),
      healthMod: pick([0, 0, 1, -1]),
      activated: chance(0.2),
      minionStarted: chance(0.15),
      masterStarted: chance(0.15),
    })
  }

  const heroes = []
  for (let h = 0; h < 1 + int(4); h++) {
    heroes.push({ id: `h${h}`, activated: chance(0.5), present: !chance(0.15) })
  }

  const vars = {}
  if (chance(0.6)) vars['#round'] = pick([0, 1, 2, 2.5, 7, -1])
  if (chance(0.3)) vars['#eliminatedprev'] = pick([0, 1])
  if (chance(0.3)) vars['#eliminatedcomplete'] = pick([0, 1])
  if (chance(0.3)) vars['#eliminated'] = pick([0, 1])
  if (chance(0.3)) vars['$%morale'] = pick([0, 1, 3])
  for (let f = 0; f < 3; f++) if (chance(0.4)) vars[`#flag${f}`] = pick([0, 1])

  const live = TRIGGERS.filter(() => chance(0.25))
  const blocking = live.filter(() => chance(0.3))

  const commands = []
  const available = mom ? MOM_COMMANDS : COMMANDS
  for (let c = 0; c < 1 + int(6); c++) commands.push(pick(available))

  const random = []
  for (let r = 0; r < 40; r++) random.push(int(7))

  return {
    name: `fuzz/${index}`,
    kind: mom ? 'mom' : 'd2e',
    ...(mom ? { phase: pick(PHASES) } : {}),
    monsterTypes,
    contentActivations,
    questActivations,
    events,
    monsters,
    heroes,
    vars,
    liveTriggers: live,
    blockingTriggers: blocking,
    commands,
    random,
  }
}

const count = Number(process.argv[3] ?? 4000)
const cases = []
for (let i = 0; i < count; i++) cases.push(scenario(i))
writeFileSync(process.argv[2], JSON.stringify(cases))
console.log(`${count} scenarios`)
