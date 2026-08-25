import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ContentData, makeTextureResolver } from '../../../packages/core/src/content/ContentData.ts'
import { ContentLoader } from '../../../packages/core/src/content/ContentLoader.ts'
import { parseContentPack } from '../../../packages/core/src/content/ContentPack.ts'
import { headlessContext } from '../../../packages/core/src/content/context.ts'
import { Localization } from '../../../packages/core/src/i18n/Localization.ts'
import { readFromStringArray } from '../../../packages/core/src/ini/IniRead.ts'
import { StringKey } from '../../../packages/core/src/i18n/StringKey.ts'

const corpus = JSON.parse(readFileSync(process.argv[2], 'utf8'))

/** Matches the C# probe: importPath = appData/gameType + "/import". */
function contextFor(c) {
  const appData = c.appData ?? '/appdata'
  const gameType = c.gameType ?? 'D2E'
  return headlessContext({
    localization: new Localization(),
    // A real existence check, so image resolution matches the C#'s File.Exists.
    resolveTextureFile: makeTextureResolver(existsSync),
    importPath: `${appData}/${gameType}/import`,
    tilePixelPerSquare: c.pps ?? 105,
    isAndroid: c.android === true,
  })
}

const render = (v) => {
  if (v === null || v === undefined) return null
  if (v instanceof StringKey) return v.fullKey
  if (Array.isArray(v)) return v.map(render)
  if (typeof v === 'number' && !Number.isFinite(v)) {
    return Number.isNaN(v) ? 'NaN' : v > 0 ? 'Infinity' : '-Infinity'
  }
  return v
}

function dumpEntry(entry) {
  const out = {}
  for (const key of Object.keys(entry).sort()) {
    if (key === 'priorityValue') continue
    out[key] = render(entry[key])
  }
  // Interface members are properties in C#, so they appear in the dump too.
  out.Priority = entry.priority
  out.SectionName = entry.sectionName
  out.Sets = render(entry.sets)
  out.TranslationKey = render(entry.translationKey)
  return out
}

const TYPE_NAMES = new Map()

function dumpRegistry(cd) {
  const buckets = []
  for (const [type, bucket] of cd.contentBuckets()) {
    const typeName = TYPE_NAMES.get(type) ?? type.name
    if (typeName === 'PerilData') continue
    const entries = [...bucket.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([key, value]) => [key, dumpEntry(value)])
    buckets.push([typeName, entries])
  }
  buckets.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return buckets
}

const results = corpus.map((c) => {
  const r = { name: c.name }
  try {
    r.ok = true
    const context = contextFor(c)

    if (c.kind === 'section') {
      const cd = new ContentData(context)
      const loader = new ContentLoader(cd, context)
      const fields = new Map(Object.entries(c.fields))
      loader.loadSection(c.section, fields, c.path ?? '/pack', c.packId ?? 'base')
      r.data = dumpRegistry(cd)
    } else if (c.kind === 'pack') {
      const data = readFromStringArray(c.ini, 'content_pack.ini')
      const options = {
        // Mirrors the temp directory the C# probe writes content_pack.ini into.
        path: join(tmpdir(), 'valkyrie-pack-probe'),
        importPath: context.importPath,
      }
      if (c.requireGameType !== undefined) options.requireGameType = c.requireGameType
      const pack = parseContentPack(data, options)
      r.data =
        pack === null
          ? null
          : {
              name: pack.name,
              id: pack.id,
              type: pack.type,
              image: pack.image,
              icon: pack.icon,
              description: pack.description,
              clone: pack.clone,
              iniFiles: pack.iniFiles,
              localizationFiles: [...pack.localizationFiles].map(([k, v]) => [k, v]),
            }
    } else if (c.kind === 'loadIni') {
      const cd = new ContentData(context)
      const loader = new ContentLoader(cd, context)
      for (const file of c.files) {
        const data = readFromStringArray(file.lines, 'x.ini')
        loader.loadIni(data, file.path, file.packId)
      }
      r.data = dumpRegistry(cd)
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
