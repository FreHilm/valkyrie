/** Shared differential corpus for the content-model port. */

const section = (name, fields, extra = {}) => ({
  name: `section:${name}`,
  kind: 'section',
  section: name,
  fields,
  path: '/pack',
  packId: 'base',
  ...extra,
})

export const corpus = [
  // ---- GenericData basics -----------------------------------------------
  section('HeroFoo', { name: 'Foo the Brave', traits: 'human warrior' }),
  section('HeroFoo', {}),
  section('HeroFoo', { name: '{val:HERO_FOO}' }),
  section('HeroFoo', { priority: '5' }),
  section('HeroFoo', { priority: 'not-a-number' }),
  section('HeroFoo', { traits: '' }),
  section('HeroFoo', { traits: 'a  b' }),
  section('HeroFoo', { traits: ' leading' }),
  section('HeroFoo', { archetype: 'healer', item: 'ItemSword' }),
  section('HeroFoo', { image: 'pic.png' }),
  section('HeroFoo', { image: '{import}/img/a.png' }),
  section('HeroFoo', { image: 'a.png', image2: 'b.png', image3: 'c.png' }),
  section('HeroFoo', { image2: 'only-second.png' }),
  section('Hero', { name: 'exact prefix' }),
  section('HeroX', {}, { path: '' }),

  // ---- TileSideData ------------------------------------------------------
  section('TileSideRoom', { top: '1.5', left: '-2.25', aspect: '1.33', reverse: 'TileSideOther' }),
  section('TileSideRoom', {}),
  section('TileSideRoom', { pps: '200' }),
  section('TileSideRoom', { pps: '*2' }),
  section('TileSideRoom', { pps: '*0.5' }),
  section('TileSideRoom', { pps: '*' }),
  section('TileSideRoom', { pps: 'bad' }),
  section('TileSideRoom', { top: '0,5' }),
  section('TileSideRoom', { top: '1e2' }),
  section('TileSideRoom', { pps: '105' }, { pps: 42 }),

  // ---- ClassData / SkillData / ItemData ----------------------------------
  section('ClassMage', { archetype: 'mage', hybridarchetype: 'healer', items: 'a b  c' }),
  section('ClassMage', { items: '' }),
  section('SkillFoo', { xp: '3' }),
  section('SkillFoo', { xp: '-1' }),
  section('SkillFoo', {}),
  section('ItemSword', { price: '25', minfame: 'noteworthy', maxfame: 'legendary' }),
  section('ItemUniqueBlade', {}),
  section('ItemSword', { minfame: 'nonsense' }),
  section('ItemSword', { price: '2147483648' }),

  // ---- MonsterData -------------------------------------------------------
  section('MonsterZombie', {
    info: 'Slow but many',
    activation: 'MonsterActivationA MonsterActivationB',
    health: '4.5',
    healthperhero: '1.5',
    horror: '2',
    awareness: '3',
  }),
  section('MonsterZombie', { imageplace: 'place.png' }),
  section('MonsterZombie', { imageplace: '{import}/p.png' }),
  section('MonsterZombie', { image: 'i.png' }),
  section('MonsterZombie', { activation: '' }),
  section('MonsterZombie', { health: '0,5' }),

  // ---- ActivationData ----------------------------------------------------
  section('MonsterActivationA', {
    ability: 'Attacks',
    minion: 'Minions act',
    master: 'Master acts',
    movebutton: 'Move',
    move: 'It moves',
    masterfirst: 'true',
    minionfirst: 'True',
  }),
  section('MonsterActivationA', { masterfirst: 'TRUE', minionfirst: 'yes' }),
  section('MonsterActivationA', {}),

  // ---- TokenData / ImageData --------------------------------------------
  section('TokenSearch', {
    image: 'a.png',
    x: '10',
    y: '20',
    height: '32',
    width: '64',
    pps: '50',
  }),
  section('TokenSearch', { image: 'a.png' }),
  section('TokenSearch', { image: 'a.png', x_android: '5', y_android: '6', x: '1', y: '2' }),
  section(
    'TokenSearch',
    { image: 'a.png', x_android: '5', y_android: '6', x: '1', y: '2' },
    { android: true },
  ),
  section('TokenSearch', { image: 'a.png', x_android: '5' }, { android: true }),
  section('TokenSearch', {}),
  section('ImageBanner', { image: 'a.png', height: '10', width: '20' }),

  // ---- Attack / Evade / Horror / Puzzle / Audio / PackType ---------------
  section('AttackBash', { text: 'You bash', target: 'human', attacktype: 'heavy' }),
  section('EvadeRun', { text: 'You run', monster: 'MonsterZombie' }),
  section('HorrorFear', { text: 'You panic', monster: 'MonsterZombie' }),
  section('PuzzleSlide', { image: 'p.png' }),
  section('AudioTheme', { file: 'song.ogg' }),
  section('AudioTheme', { file: '{import}/song.ogg' }),
  section('AudioTheme', {}),
  section('PackTypeCore', { name: 'Core' }),

  // ---- sections no loader claims ----------------------------------------
  section('UnknownThing', { name: 'x' }),
  section('QuestStuff', {}),
]

// ---- Content pack parsing -----------------------------------------------
const packIni = (...lines) => lines

const pack = (name, ini, extra = {}) => ({
  name: `pack:${name}`,
  kind: 'pack',
  ini,
  path: '/pack',
  ...extra,
})

corpus.push(
  pack(
    'full',
    packIni(
      '[ContentPack]',
      'name=Base Game',
      'id=base',
      'type=D2E',
      'image=cover.png',
      'icon=icon.png',
      'description=The base game',
      'clone=extra1 extra2',
      '[ContentPackData]',
      'heros.ini',
      'monsters.ini',
      '[LanguageData]',
      'val Localization.English.txt',
      'val Localization.French.txt',
      'ffg FfgText.txt',
    ),
  ),
  pack('minimal', packIni('[ContentPack]', 'name=Tiny')),
  pack('import-image', packIni('[ContentPack]', 'name=X', 'image={import}/cover.png')),
  pack('no-icon', packIni('[ContentPack]', 'name=X', 'icon=')),
  pack('blank-icon', packIni('[ContentPack]', 'name=X', 'icon=   ')),
  pack('gametype-match', packIni('[ContentPack]', 'name=X', 'type=D2EBase'), {
    requireGameType: 'D2E',
  }),
  pack('gametype-mismatch', packIni('[ContentPack]', 'name=X', 'type=MoM'), {
    requireGameType: 'D2E',
  }),
  pack('gametype-missing', packIni('[ContentPack]', 'name=X'), { requireGameType: 'D2E' }),
  pack('clone-spacing', packIni('[ContentPack]', 'name=X', 'clone=  a   b  ')),
)

// ---- Whole-ini loading, priority and set merging -------------------------
const iniFile = (path, packId, ...lines) => ({ path, packId, lines })

corpus.push(
  {
    name: 'loadIni:priority-higher-wins',
    kind: 'loadIni',
    files: [
      iniFile('/a', 'packA', '[HeroFoo]', 'name=Low', 'priority=1'),
      iniFile('/b', 'packB', '[HeroFoo]', 'name=High', 'priority=2'),
    ],
  },
  {
    name: 'loadIni:priority-lower-ignored',
    kind: 'loadIni',
    files: [
      iniFile('/a', 'packA', '[HeroFoo]', 'name=High', 'priority=2'),
      iniFile('/b', 'packB', '[HeroFoo]', 'name=Low', 'priority=1'),
    ],
  },
  {
    name: 'loadIni:equal-priority-merges-sets',
    kind: 'loadIni',
    files: [
      iniFile('/a', 'packA', '[HeroFoo]', 'name=A'),
      iniFile('/b', 'packB', '[HeroFoo]', 'name=B'),
      iniFile('/c', 'packC', '[HeroFoo]', 'name=C'),
    ],
  },
  {
    name: 'loadIni:many-types',
    kind: 'loadIni',
    files: [
      iniFile(
        '/pack',
        'base',
        '[HeroA]',
        'name=A',
        '[MonsterB]',
        'health=3',
        '[TokenC]',
        'image=c.png',
        '[TokenNoImage]',
        'x=1',
        '[ItemD]',
        'price=5',
        '[AttackE]',
        'text=hit',
        '[UnknownF]',
        'x=1',
      ),
    ],
  },
  {
    name: 'loadIni:image-vs-token-prefix',
    kind: 'loadIni',
    files: [iniFile('/pack', 'base', '[ImageX]', 'image=x.png', '[TokenY]', 'image=y.png')],
  },
)
