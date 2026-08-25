/**
 * Curated round-controller cases: the branches worth naming, chosen by reading
 * RoundController.cs and RoundControllerMoM.cs rather than by sampling.
 */

const MINION_AND_MASTER = { minion: 'MinionText', master: 'MasterText' }
const MASTER_ONLY = { minion: '', master: 'MasterText' }
const MINION_ONLY = { minion: 'MinionText', master: '' }

const goblinType = { activations: [] }
const goblinActivations = { MonsterActivationGoblinA: MINION_AND_MASTER }

const base = {
  monsterTypes: { MonsterGoblin: goblinType },
  contentActivations: goblinActivations,
}

const one = (over = {}) => ({
  ...base,
  monsters: [{ id: 'm1', type: 'MonsterGoblin' }],
  heroes: [{ id: 'h1' }, { id: 'h2' }],
  ...over,
})

export function cases() {
  const list = []
  const add = (name, body) => list.push({ name, ...body })

  // --- Descent: hero and monster activation interleave -------------------
  add('d2e/hero-activated-first', {
    kind: 'd2e',
    ...one(),
    random: [0, 0, 0],
    commands: ['heroActivated'],
  })

  add('d2e/all-heroes-done-monster-left', {
    kind: 'd2e',
    ...one({
      heroes: [
        { id: 'h1', activated: true },
        { id: 'h2', activated: true },
      ],
    }),
    random: [0, 0, 0],
    commands: ['heroActivated'],
  })

  add('d2e/empty-hero-seat-never-blocks', {
    kind: 'd2e',
    ...one({
      heroes: [
        { id: 'h1', activated: true },
        { id: 'h2', present: false },
      ],
    }),
    random: [0, 0],
    commands: ['heroActivated'],
  })

  add('d2e/no-monsters-round-ends', {
    kind: 'd2e',
    ...one({ monsters: [], heroes: [{ id: 'h1', activated: true }] }),
    commands: ['heroActivated', 'checkNewRound'],
  })

  add('d2e/master-only-activation-shows-both', {
    kind: 'd2e',
    ...one(),
    contentActivations: { MonsterActivationGoblinA: MASTER_ONLY },
    random: [0, 0],
    commands: ['activateMonster'],
  })

  add('d2e/minion-only-activation-shows-both', {
    kind: 'd2e',
    ...one(),
    contentActivations: { MonsterActivationGoblinA: MINION_ONLY },
    random: [0, 0],
    commands: ['activateMonster'],
  })

  add('d2e/minion-first-flag-overrides-draw', {
    kind: 'd2e',
    ...one(),
    contentActivations: {
      MonsterActivationGoblinA: { ...MINION_AND_MASTER, minionFirst: true },
    },
    random: [0, 1],
    commands: ['activateMonster'],
  })

  add('d2e/master-first-flag-overrides-draw', {
    kind: 'd2e',
    ...one(),
    contentActivations: {
      MonsterActivationGoblinA: { ...MINION_AND_MASTER, masterFirst: true },
    },
    random: [0, 0],
    commands: ['activateMonster'],
  })

  add('d2e/half-activation-completes-next', {
    kind: 'd2e',
    ...one(),
    random: [0, 0, 0, 0],
    commands: ['activateMonster', 'monsterActivated', 'monsterActivated'],
  })

  add('d2e/activation-persists-across-monsterActivated', {
    kind: 'd2e',
    ...one({
      monsters: [
        { id: 'm1', type: 'MonsterGoblin' },
        { id: 'm2', type: 'MonsterGoblin' },
      ],
      heroes: [{ id: 'h1', activated: true }],
    }),
    contentActivations: {
      MonsterActivationGoblinA: MINION_AND_MASTER,
      MonsterActivationGoblinB: { minion: 'B', master: 'B' },
    },
    random: [1, 0, 0, 1, 0, 0],
    commands: ['activateMonster', 'monsterActivated', 'monsterActivated', 'monsterActivated'],
  })

  add('d2e/end-round-fires-numbered-trigger', {
    kind: 'd2e',
    ...one({ monsters: [] }),
    vars: { '#round': 3 },
    liveTriggers: ['EndRound3'],
    commands: ['endRound'],
  })

  add('d2e/end-round-eliminated-chain', {
    kind: 'd2e',
    ...one({ monsters: [] }),
    vars: { '#eliminatedprev': 1, '#eliminated': 1 },
    liveTriggers: ['Eliminated'],
    commands: ['endRound'],
  })

  add('d2e/check-new-round-blocked-by-open-event', {
    kind: 'd2e',
    ...one({ monsters: [], heroes: [{ id: 'h1', activated: true }] }),
    liveTriggers: ['EndRound'],
    blockingTriggers: ['EndRound'],
    commands: ['heroActivated', 'checkNewRound'],
  })

  add('d2e/check-new-round-advances-counter', {
    kind: 'd2e',
    ...one({ monsters: [], heroes: [{ id: 'h1', activated: true }] }),
    vars: { '#round': 1 },
    liveTriggers: ['StartRound'],
    commands: ['heroActivated', 'checkNewRound', 'checkNewRound'],
  })

  add('d2e/round-counter-banker-rounding', {
    kind: 'd2e',
    ...one({ monsters: [], heroes: [{ id: 'h1', activated: true }] }),
    vars: { '#round': 2.5 },
    commands: ['heroActivated', 'checkNewRound'],
  })

  add('d2e/quest-monster-custom-activation', {
    kind: 'd2e',
    ...one(),
    monsterTypes: {
      MonsterGoblin: {
        quest: true,
        derivedType: 'MonsterGoblinBase',
        useMonsterTypeActivations: false,
        activations: ['Custom'],
      },
    },
    questActivations: { ActivationCustom: MINION_AND_MASTER },
    random: [0, 0],
    commands: ['activateMonster'],
  })

  add('d2e/quest-monster-custom-activation-failing-test', {
    kind: 'd2e',
    ...one(),
    monsterTypes: {
      MonsterGoblin: {
        quest: true,
        useMonsterTypeActivations: false,
        activations: ['Custom'],
      },
    },
    vars: { '#flag': 0 },
    questActivations: { ActivationCustom: { ...MINION_AND_MASTER, tests: ['#flag>0'] } },
    contentActivations: { MonsterActivationCustom: MASTER_ONLY },
    random: [0, 0],
    commands: ['activateMonster'],
  })

  add('d2e/quest-monster-custom-activation-passing-test', {
    kind: 'd2e',
    ...one(),
    monsterTypes: {
      MonsterGoblin: {
        quest: true,
        useMonsterTypeActivations: false,
        activations: ['Custom'],
      },
    },
    vars: { '#flag': 1 },
    questActivations: { ActivationCustom: { ...MINION_AND_MASTER, tests: ['#flag>0'] } },
    contentActivations: { MonsterActivationCustom: MASTER_ONLY },
    random: [0, 0],
    commands: ['activateMonster'],
  })

  add('d2e/quest-monster-unknown-activation-warns', {
    kind: 'd2e',
    ...one(),
    monsterTypes: {
      MonsterGoblin: {
        quest: true,
        useMonsterTypeActivations: false,
        activations: ['Missing', 'Custom'],
      },
    },
    questActivations: { ActivationCustom: MINION_AND_MASTER },
    random: [0, 0],
    commands: ['activateMonster'],
  })

  add('d2e/derived-type-supplies-activations', {
    kind: 'd2e',
    ...one(),
    monsterTypes: {
      MonsterGoblin: { quest: true, derivedType: 'MonsterOrc', activations: [] },
      MonsterOrc: { activations: ['Common'] },
    },
    contentActivations: {
      MonsterActivationOrcA: MINION_AND_MASTER,
      MonsterActivationCommon: MASTER_ONLY,
    },
    random: [0, 0],
    commands: ['activateMonster'],
  })

  add('d2e/no-activation-data-at-all', {
    kind: 'd2e',
    ...one(),
    contentActivations: {},
    random: [0, 0],
    commands: ['activateMonster'],
  })

  add('d2e/morale-drops-below-zero', {
    kind: 'd2e',
    ...one({ heroes: [{ id: 'h1' }] }),
    vars: { '$%morale': 0 },
    liveTriggers: ['NoMorale'],
    random: [0, 0, 0],
    commands: ['activateMonster', 'monsterActivated'],
  })

  // --- Mansions: investigator → mythos → monsters → horror ---------------
  add('mom/investigators-finish-enters-mythos', {
    kind: 'mom',
    ...one(),
    phase: 'investigator',
    liveTriggers: ['Mythos'],
    commands: ['heroActivated'],
  })

  add('mom/eliminated-interrupts-phase-change', {
    kind: 'mom',
    ...one(),
    phase: 'investigator',
    vars: { '#eliminatedprev': 1 },
    liveTriggers: ['Eliminated'],
    commands: ['heroActivated'],
  })

  add('mom/mythos-with-monsters-goes-to-monsters', {
    kind: 'mom',
    ...one(),
    phase: 'mythos',
    random: [0, 0],
    commands: ['checkNewRound'],
  })

  add('mom/mythos-with-no-monsters-goes-to-horror', {
    kind: 'mom',
    ...one({ monsters: [] }),
    phase: 'mythos',
    commands: ['checkNewRound'],
  })

  add('mom/monsters-phase-goes-to-horror', {
    kind: 'mom',
    ...one(),
    phase: 'monsters',
    commands: ['checkNewRound'],
  })

  add('mom/horror-with-monsters-waits-for-player', {
    kind: 'mom',
    ...one(),
    phase: 'horror',
    commands: ['checkNewRound'],
  })

  add('mom/horror-after-end-round-advances', {
    kind: 'mom',
    ...one(),
    phase: 'horror',
    vars: { '#round': 4 },
    liveTriggers: ['StartRound'],
    commands: ['endRound', 'checkNewRound'],
  })

  add('mom/event-activation-queues-and-marks-done', {
    kind: 'mom',
    ...one(),
    monsterTypes: {
      MonsterGoblin: { quest: true, activations: ['EventGoblinActs'] },
    },
    events: { EventGoblinActs: { disabled: false } },
    liveTriggers: [],
    random: [0],
    commands: ['activateMonster'],
  })

  // `IndexOf("Event") == 0` is a prefix test: an activation that merely
  // contains "Event" is an ordinary one and must not be queued as an event.
  add('mom/activation-only-containing-event-is-ordinary', {
    kind: 'mom',
    ...one(),
    monsterTypes: {
      MonsterGoblin: { quest: true, activations: ['TrapEventActs'] },
    },
    questActivations: { ActivationTrapEventActs: MINION_AND_MASTER },
    events: { TrapEventActs: { disabled: false } },
    random: [0, 0],
    commands: ['activateMonster'],
  })

  add('mom/defeating-a-monster-fires-both-triggers', {
    kind: 'mom',
    ...one({ monsters: [{ id: 'm1', type: 'MonsterGoblin', spawnedBy: 'SpawnA' }] }),
    phase: 'monsters',
    liveTriggers: ['DefeatedMonsterGoblin', 'DefeatedSpawnA'],
    commands: ['defeatFirst'],
  })

  add('mom/defeat-clears-the-open-event-first', {
    kind: 'mom',
    ...one({ monsters: [{ id: 'm1', type: 'MonsterGoblin', spawnedBy: 'SpawnA' }] }),
    phase: 'monsters',
    liveTriggers: ['Mythos', 'DefeatedMonsterGoblin'],
    blockingTriggers: ['Mythos'],
    commands: ['activateMonster', 'defeatFirst'],
    random: [0, 0],
  })

  add('mom/monster-health-scales-with-the-party', {
    kind: 'mom',
    ...one({
      monsters: [
        { id: 'm1', type: 'MonsterGoblin' },
        { id: 'm2', type: 'MonsterGoblin', healthMod: 2 },
      ],
      heroes: [{ id: 'h1' }, { id: 'h2' }, { id: 'h3', present: false }],
    }),
    monsterTypes: { MonsterGoblin: { activations: [], healthBase: 3, healthPerHero: 0.5 } },
    commands: ['health'],
  })

  add('mom/disabled-event-activation-skips-monster', {
    kind: 'mom',
    ...one(),
    monsterTypes: {
      MonsterGoblin: { quest: true, activations: ['EventGoblinActs'] },
    },
    events: { EventGoblinActs: { disabled: true } },
    commands: ['activateMonster'],
  })

  add('mom/disabled-event-in-mythos-skips-to-horror', {
    kind: 'mom',
    ...one(),
    phase: 'mythos',
    monsterTypes: {
      MonsterGoblin: { quest: true, activations: ['EventGoblinActs'] },
    },
    events: { EventGoblinActs: { disabled: true } },
    commands: ['checkNewRound'],
  })

  add('mom/mom-activation-shows-one-dialog', {
    kind: 'mom',
    ...one(),
    random: [0, 0],
    commands: ['activateMonster'],
  })

  add('mom/monster-activated-marks-started-done', {
    kind: 'mom',
    ...one({
      monsters: [
        { id: 'm1', type: 'MonsterGoblin', masterStarted: true },
        { id: 'm2', type: 'MonsterGoblin' },
      ],
    }),
    random: [0, 0, 0],
    commands: ['monsterActivated'],
  })

  add('mom/full-round-trip', {
    kind: 'mom',
    ...one({ monsters: [] }),
    phase: 'investigator',
    vars: { '#round': 1 },
    liveTriggers: ['StartRound'],
    commands: ['heroActivated', 'checkNewRound', 'checkNewRound'],
  })

  add('mom/final-round-trigger', {
    kind: 'mom',
    ...one({ monsters: [] }),
    phase: 'horror',
    vars: { '#eliminatedprev': 1 },
    liveTriggers: ['StartFinalRound', 'StartRound'],
    commands: ['endRound', 'checkNewRound'],
  })

  return list
}
