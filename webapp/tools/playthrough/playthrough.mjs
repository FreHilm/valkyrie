/**
 * Plays a published scenario in a real browser, and says where it stopped.
 *
 * The in-process playthrough (`packages/app/test/playthrough.test.ts`) covers
 * the loop against a fixture and runs in CI. This covers what that cannot: a
 * real scenario, with real art and audio, against a real content import. It
 * needs a licensed install, so it never runs in CI — it is a check you run
 * before believing the port can be played.
 *
 * Usage, with `npm run dev` up and a Chrome listening on the debug port:
 *
 *   node --experimental-websocket tools/playthrough/playthrough.mjs \
 *     --quest MoM__ExoticMaterial --app http://localhost:5173/
 *
 * It presses what a player would press, in the order a player would find it:
 * a puzzle first, then whatever a dialog is asking, then the board, then the
 * controls that end a turn. The board is reachable because its pieces are real
 * buttons — before that they were pixels on a canvas and this could only sweep
 * blindly for them.
 *
 * Exit code 0 means the quest reached its end screen. Anything else is a
 * failure with a reason: a console error, an uncaught exception, or a state it
 * could not advance out of.
 */

const args = new Map()
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i]?.replace(/^--/, ''), process.argv[i + 1])
}

const APP = args.get('app') ?? 'http://localhost:5173/'
const QUEST = args.get('quest') ?? 'MoM__ExoticMaterial'
const PORT = Number(args.get('port') ?? 9333)
const STEPS = Number(args.get('steps') ?? 400)
const PACE = Number(args.get('pace') ?? 400)
const PARTY = (args.get('party') ?? 'Agatha Crane,Carson Sinclair').split(',')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const fail = (why) => {
  console.error(`FAILED: ${why}`)
  process.exit(1)
}

const version = await fetch(`http://127.0.0.1:${PORT}/json/version`).catch(() => null)
if (version === null) {
  fail(`no browser listening on ${String(PORT)} — start Chrome with --remote-debugging-port`)
}

const browser = new WebSocket((await version.json()).webSocketDebuggerUrl)
await new Promise((resolve) => browser.addEventListener('open', resolve, { once: true }))

function talker(socket) {
  let id = 0
  const pending = new Map()
  socket.addEventListener('message', (message) => {
    const parsed = JSON.parse(message.data)
    if (parsed.id !== undefined) {
      pending.get(parsed.id)?.(parsed)
      pending.delete(parsed.id)
    }
  })
  return (method, params = {}) => {
    const next = ++id
    socket.send(JSON.stringify({ id: next, method, params }))
    return new Promise((resolve) => pending.set(next, resolve))
  }
}

const browserSend = talker(browser)
const target = (await browserSend('Target.createTarget', { url: 'about:blank' })).result.targetId
const page = new WebSocket(`ws://127.0.0.1:${PORT}/devtools/page/${target}`)
await new Promise((resolve) => page.addEventListener('open', resolve, { once: true }))
const send = talker(page)

/** Anything here fails the run: a playthrough is not a success with errors in it. */
const problems = []
page.addEventListener('message', (message) => {
  const parsed = JSON.parse(message.data)
  if (parsed.method === 'Runtime.exceptionThrown') {
    const details = parsed.params.exceptionDetails
    problems.push(`exception: ${details.exception?.description ?? details.text}`)
  } else if (parsed.method === 'Log.entryAdded' && parsed.params.entry.level === 'error') {
    // The favicon is the dev server's business, not the game's — and the name
    // is in the URL rather than the message, which is easy to filter wrongly.
    const entry = parsed.params.entry
    const where = `${entry.url ?? ''} ${entry.text}`
    if (!where.includes('favicon')) problems.push(`console: ${entry.text}`)
  } else if (parsed.method === 'Inspector.targetCrashed') {
    problems.push('the tab crashed')
  }
})
for (const domain of ['Runtime', 'Log', 'Page', 'Inspector']) await send(`${domain}.enable`)

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  })
  const thrown = result.result?.exceptionDetails
  if (thrown !== undefined) {
    fail(`evaluating in the page: ${thrown.exception?.description ?? thrown.text}`)
  }
  return result.result?.result?.value
}

const pressByText = (text) =>
  evaluate(`(() => {
    const found = [...document.querySelectorAll('button')].find(
      (b) => !b.disabled && b.textContent.includes(${JSON.stringify(text)}),
    )
    if (!found) return false
    found.click()
    return true
  })()`)

/**
 * One step of play, decided in the page.
 *
 * Reads the same DOM a player sees and presses the same thing, then reports
 * what it did so a failing run says how it got there.
 */
const STEP = `(() => {
  const enabled = (selector) =>
    [...document.querySelectorAll(selector)].filter((b) => !b.disabled)

  const puzzle = enabled('.vk-puzzle button')
  if (puzzle.length) {
    const finish = puzzle.find((b) => b.textContent === 'Finish')
    const giveUp = puzzle.find((b) => b.textContent === 'Give up')
    // A generated puzzle is not something to solve by brute force; giving up
    // is a real move and the quest goes on either way.
    const chosen = finish ?? giveUp ?? puzzle[0]
    chosen.click()
    return ['puzzle', chosen.textContent]
  }

  // Not the way out of a cancelable event. A token's dialog leads with Cancel,
  // and pressing whatever comes first opens the same door and closes it again
  // forever — a stuck quest that looks like a busy one.
  const overlay = enabled('.vk-play__overlay button').filter(
    (b) => !b.classList.contains('vk-event__cancel'),
  )
  if (overlay.length) {
    // A quota event asks for a number, and its spinner carries a '+' just as
    // a monster's health tracker does. Pressing the wrong one dials a counter
    // up and down forever without ever answering the question, so the spinner
    // is recognised by its own class and answered with the button beside it.
    const spinner = document.querySelector('.vk-play__overlay .vk-event__quota')
    if (spinner) {
      // Dial before answering. Submitting the nought it opens on means "no
      // successes", so a search never finds anything and the token it came
      // from stays on the board to be searched again — which reads as a stuck
      // quest when it is really an answer of zero, given over and over.
      for (let i = 0; i < 3; i++) {
        const more = [...spinner.querySelectorAll('button')].find(
          (b) => b.textContent === '+' && !b.disabled,
        )
        if (!more) break
        more.click()
      }
      const after = [...document.querySelectorAll('.vk-play__overlay button')].filter(
        (b) => !b.disabled,
      )
      const spinnerNow = document.querySelector('.vk-play__overlay .vk-event__quota')
      const submit = after.find((b) => spinnerNow === null || !spinnerNow.contains(b))
      if (submit) {
        submit.click()
        return ['quota', submit.textContent]
      }
    }

    // Kill a monster rather than fight it forever: its health is tracked on
    // the table, so nothing on screen ends the fight by itself.
    const defeated = overlay.find((b) => b.textContent === 'Defeated')
    const wound = document.querySelector('.vk-play__overlay .vk-monster__damage')
      ? overlay.find((b) => b.textContent === '+')
      : undefined
    const chosen = defeated ?? wound ?? overlay[0]
    chosen.click()
    return ['dialog', chosen.textContent]
  }

  // A scenario's own screen elements. Several published quests run their
  // opening, and sometimes their whole first act, as UI components
  // rather than events, so a presser that only knows about dialogs and the
  // board waits for a board that is never coming.
  const questUi = [...document.querySelectorAll('.vk-quest-ui__item--clickable')]
  const bordered = questUi.find((n) => n.className.includes('--border'))
  if (bordered) {
    bordered.click()
    return ['questUi', (bordered.innerText || '').trim().slice(0, 30)]
  }

  const pieces = enabled('.vk-board__pieces button')
  if (pieces.length) {
    // Round-robin, so a board with several doors does not press one forever.
    const index = Number(document.body.dataset.playthroughPiece ?? 0) % pieces.length
    document.body.dataset.playthroughPiece = String(index + 1)
    pieces[index].click()
    return ['board', pieces[index].textContent]
  }

  const controls = enabled('.vk-play__controls button')
  if (controls.length) {
    controls[0].click()
    return ['controls', controls[0].textContent]
  }

  return ['idle', '']
})()`

const ENDED = `document.body.innerText.includes('The quest is over')`

await send('Page.navigate', { url: APP })
await sleep(3500)

console.log(`playing ${QUEST}`)
if (!(await pressByText('Play a quest'))) fail('no "Play a quest" on the menu')
await sleep(4000)
if (!(await pressByText(QUEST))) fail(`no scenario called ${QUEST} — is the content imported?`)
await sleep(8000)

for (const investigator of PARTY) {
  await pressByText(investigator)
  await sleep(400)
}
await pressByText('Finished')
await sleep(4000)
await pressByText('Ready')
await sleep(6000)

let last = ''
let idle = 0
for (let step = 0; step < STEPS; step++) {
  if (await evaluate(ENDED)) {
    console.log(`reached the end of the quest in ${String(step)} steps`)
    if (problems.length > 0) fail(`the quest ended, but:\n  ${problems.join('\n  ')}`)
    await browserSend('Target.closeTarget', { targetId: target })
    process.exit(0)
  }
  if (problems.length > 0) fail(problems.join('\n  '))

  const [kind, what] = await evaluate(STEP)
  // Three idle steps in a row is stuck, not thinking: nothing on screen can be
  // pressed and the quest is not over.
  idle = kind === 'idle' ? idle + 1 : 0
  if (idle >= 3) {
    const showing = await evaluate('document.body.innerText.slice(0, 300)')
    fail(`stuck after ${String(step)} steps, with nothing to press. On screen:\n${showing}`)
  }

  const line = `${kind}:${what}`
  if (line !== last) console.log(`${String(step).padStart(4)} ${kind.padEnd(9)} ${what}`)
  last = line
  await sleep(PACE)
}

fail(`gave up after ${String(STEPS)} steps without reaching the end`)
