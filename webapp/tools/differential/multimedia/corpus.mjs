/**
 * Cases for the multimedia resolver: a set of files to create under the
 * scenario root, the name to resolve, and the language context.
 *
 * Covers the two localised layouts, their interaction, edit mode, the
 * fallback-disabling conditions, and the awkward inputs — separators, empty
 * strings, traversal, names that collide with a language folder.
 */

const LANGS = ['German', 'English']

/** The hand-written cases, including every layout the C# suite exercises. */
export function curated() {
  const cases = []
  const add = (label, files, name, currentLang, fallbackLang, editMode = false) =>
    cases.push({ label, files, name, currentLang, fallbackLang, editMode })

  add('root lang folder', ['German/Tile.png'], 'Tile.png', 'German', 'English')
  add('fallback only', ['English/Tile.png'], 'Tile.png', 'German', 'English')
  add('unlocalised only', ['Tile.png'], 'Tile.png', 'German', 'English')
  add('nothing at all', [], 'Missing.png', 'German', 'English')
  add('edit mode skips lang', ['German/Tile.png'], 'Tile.png', 'German', 'English', true)
  add(
    'current beats fallback',
    ['German/Tile.png', 'English/Tile.png'],
    'Tile.png',
    'German',
    'English',
  )
  add('empty fallback', ['English/Tile.png'], 'Tile.png', 'German', '')
  add('fallback equals current', ['German/Tile.png'], 'Tile.png', 'French', 'French')
  add(
    'subfolder under lang',
    ['German/images/BgTile.png'],
    'images/BgTile.png',
    'German',
    'English',
  )
  add(
    'lang inside subfolder',
    ['image/map.png', 'image/German/map.png'],
    'image/map.png',
    'German',
    'English',
  )
  add('fallback inside subfolder', ['image/English/map.png'], 'image/map.png', 'German', 'English')
  add(
    'edit mode ignores subfolder lang',
    ['image/German/map.png', 'image/map.png'],
    'image/map.png',
    'German',
    'English',
    true,
  )

  // Orderings the C# suite never pins down, which the port has to match.
  add(
    'root lang beats subfolder lang',
    ['German/image/map.png', 'image/German/map.png'],
    'image/map.png',
    'German',
    'English',
  )
  add(
    'current in subfolder beats fallback at root',
    ['image/German/map.png', 'English/image/map.png'],
    'image/map.png',
    'German',
    'English',
  )
  add(
    'fallback root beats fallback subfolder',
    ['English/image/map.png', 'image/English/map.png'],
    'image/map.png',
    'German',
    'English',
  )
  add('deep nesting', ['German/a/b/c/x.png'], 'a/b/c/x.png', 'German', 'English')
  add('lang folder deep inside', ['a/b/German/x.png'], 'a/b/x.png', 'German', 'English')

  // Awkward inputs.
  add('empty current lang', ['Tile.png'], 'Tile.png', '', 'English')
  add('name with leading ./', ['German/Tile.png'], './Tile.png', 'German', 'English')
  add('name is a directory that exists', ['image/map.png'], 'image', 'German', 'English')
  add('name collides with lang folder', ['German/German.png'], 'German.png', 'German', 'English')
  add('trailing separator on name', ['German/Tile.png'], 'Tile.png/', 'German', 'English')
  add('dotted name', ['German/a.b.c.png'], 'a.b.c.png', 'German', 'English')
  add('spaces in name', ['German/my tile.png'], 'my tile.png', 'German', 'English')

  return cases
}

/** Deterministic layouts, so a run is reproducible from its seed. */
export function fuzz(count, seed = 1) {
  let state = seed >>> 0
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
  const pick = (list) => list[Math.floor(next() * list.length)]

  const NAMES = ['Tile.png', 'image/map.png', 'a/b/deep.ogg', 'audio/theme.ogg', 'x.png']
  const cases = []

  for (let i = 0; i < count; i++) {
    const name = pick(NAMES)
    const at = name.lastIndexOf('/')
    const dir = at === -1 ? '' : name.slice(0, at)
    const file = name.slice(at + 1)

    // Every place the resolver could conceivably look.
    const places = [name]
    for (const lang of LANGS) {
      places.push(`${lang}/${name}`)
      if (dir.length > 0) places.push(`${dir}/${lang}/${file}`)
    }

    const files = places.filter(() => next() < 0.5)
    cases.push({
      label: `fuzz ${i}`,
      files,
      name,
      currentLang: pick([...LANGS, 'French', '']),
      fallbackLang: pick([...LANGS, '', 'French']),
      editMode: next() < 0.2,
    })
  }
  return cases
}
