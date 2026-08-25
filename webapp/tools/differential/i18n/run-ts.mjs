import { readFileSync, writeFileSync } from 'node:fs'
import { DictionaryI18n } from '../../../packages/core/src/i18n/DictionaryI18n.ts'
import { Localization } from '../../../packages/core/src/i18n/Localization.ts'
import { StringKey, splitRemoveEmpty } from '../../../packages/core/src/i18n/StringKey.ts'

const corpus = JSON.parse(readFileSync(process.argv[2], 'utf8'))

const dumpRaw = (raw) => [...raw].map(([lang, lines]) => [lang, lines])

function build(blocks) {
  const d = new DictionaryI18n()
  for (const block of blocks) d.addData(block)
  return d
}

const results = corpus.map((c) => {
  const r = { name: c.name }
  try {
    r.ok = true
    switch (c.kind) {
      case 'parseEntry': {
        r.value = new DictionaryI18n().parseEntry(c.entry)
        break
      }
      case 'split3': {
        r.data = splitRemoveEmpty(c.input, ':', 3)
        break
      }
      case 'addData': {
        const d = build(c.blocks)
        r.data = dumpRaw(d.serializeMultiple())
        r.languages = d.getLanguagesList()
        break
      }
      case 'getValue': {
        const d = build(c.blocks)
        if (c.defaultLanguage !== undefined) d.defaultLanguage = c.defaultLanguage
        if (c.fallbackLanguage !== undefined) d.fallbackLanguage = c.fallbackLanguage
        if (c.currentLanguage !== undefined) d.currentLanguage = c.currentLanguage
        if (c.group !== undefined) {
          d.setKeyToGroup(c.group.key, c.group.groupId)
          d.setGroupTranslationLanguage(c.group.groupId, c.group.language)
        }
        r.value = d.getValue(c.key)
        r.exists = d.keyExists(c.key)
        if (c.extractAll !== undefined) r.extractAll = [...d.extractAllMatches(c.key)]
        if (c.serialize !== undefined) {
          d.addEntry('__PROBE__', 'x')
          r.data = dumpRaw(d.serializeMultiple())
        }
        break
      }
      case 'getValueMany': {
        const d = build(c.blocks)
        if (c.defaultLanguage !== undefined) d.defaultLanguage = c.defaultLanguage
        if (c.fallbackLanguage !== undefined) d.fallbackLanguage = c.fallbackLanguage
        if (c.currentLanguage !== undefined) d.currentLanguage = c.currentLanguage
        r.data = c.keys.map((key) => [key, d.getValue(key), d.keyExists(key)])
        break
      }
      case 'stringKey': {
        const loc = new Localization()
        for (const name of c.dicts) loc.addDictionary(name, new DictionaryI18n(['.,English']))
        const sk = StringKey.parse(c.input, loc)
        r.dict = sk.dict
        r.key = sk.key
        r.fullKey = sk.fullKey
        r.toString = sk.toString()
        r.isKey = sk.isKey()
        r.regex = loc.lookupRegexKey()
        break
      }
      case 'dictLookup': {
        const loc = new Localization()
        for (const entry of c.dicts) loc.addDictionary(entry.name, build(entry.blocks))
        const sk = c.raw !== undefined ? StringKey.parse(c.raw, loc) : new StringKey(c.dict, c.key)
        r.value = sk.translate({ localization: loc })
        r.exists = sk.keyExists(loc)
        r.emptyIfNotFound = sk.translate({ emptyIfNotFound: true, localization: loc })
        break
      }
      default:
        throw new Error('unknown kind')
    }
  } catch (e) {
    r.ok = false
    r.error = e.constructor.name
    delete r.value
    delete r.data
  }
  return r
})

writeFileSync(process.argv[3], JSON.stringify(results))
console.log('ts cases:', results.length)
