/**
 * Opt-in check against the real hosts. Not run in CI, which is offline.
 *
 * The fakes cannot prove the two things this port actually depends on: that
 * `raw.githubusercontent.com` still sends permissive CORS headers, and that
 * `Range` requests really work there so an interrupted 14 MB download resumes.
 *
 *   node tools/differential/remote/live-check.mjs
 */
import {
  FetchHttpClient,
  RemoteContentPackManager,
  StoragePaths,
  MemoryFileSystem,
  manifestUrl,
} from '@valkyrie/platform'

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail.length > 0 ? `  ${detail}` : ''}`)
  if (!ok) failures++
}

const ORIGIN = 'https://valkyrie.example'

for (const game of ['D2E', 'MoM']) {
  const url = manifestUrl(game)
  const response = await fetch(url, { headers: { Origin: ORIGIN } })
  const cors = response.headers.get('access-control-allow-origin')
  check(`${game} manifest reachable`, response.ok, `HTTP ${response.status}`)
  check(`${game} manifest allows cross-origin reads`, cors === '*', `ACAO: ${cors}`)
  await response.text()
}

const fs = new MemoryFileSystem()
const http = new FetchHttpClient()
const paths = new StoragePaths({ appData: '/app', content: '/content', temp: '/tmp' }, 'D2E')
const manager = new RemoteContentPackManager({ fs, http, paths, gameType: 'D2E' })

const mode = await manager.refresh()
check('manifest parses into packs', manager.packs.size > 0, `${mode}, ${manager.packs.size} packs`)

for (const pack of manager.packs.values()) {
  const url = manager.packageUrl(pack.identifier)
  const head = await fetch(url, { method: 'HEAD', headers: { Origin: ORIGIN } })
  check(`${pack.identifier} package exists`, head.ok, `HTTP ${head.status}`)
  check(
    `${pack.identifier} package allows cross-origin reads`,
    head.headers.get('access-control-allow-origin') === '*',
  )
  check(
    `${pack.identifier} package supports Range`,
    head.headers.get('accept-ranges') === 'bytes',
    `${head.headers.get('content-length')} bytes`,
  )
}

// Prove resumption end to end: fetch a package twice, once whole and once
// through a client whose connection is cut partway, and compare.
const [first] = [...manager.packs.values()]
if (first !== undefined) {
  const url = manager.packageUrl(first.identifier)
  const whole = await http.getBytes(url)

  let cut = false
  const flaky = new FetchHttpClient(async (target, init) => {
    const response = await fetch(target, init)
    if (cut || response.body === null) return response
    cut = true

    // Deliver a prefix, then drop the connection.
    const reader = response.body.getReader()
    const body = new ReadableStream({
      async pull(controller) {
        const { done, value } = await reader.read()
        if (done) {
          controller.close()
          return
        }
        controller.enqueue(value)
        await reader.cancel()
        controller.error(new Error('connection reset'))
      },
    })
    return new Response(body, { status: response.status, headers: response.headers })
  })

  const resumed = await flaky.getBytes(url)
  check(
    `${first.identifier} resumes after a dropped connection`,
    resumed.length === whole.length && resumed.every((b, i) => b === whole[i]),
    `${resumed.length} vs ${whole.length} bytes`,
  )
}

console.log(failures === 0 ? '\nall live checks passed' : `\n${failures} live check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
