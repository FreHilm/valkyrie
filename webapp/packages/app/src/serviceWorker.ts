/**
 * The service worker: offline support, and updates that do not surprise anyone.
 *
 * Two rules shape this, and both come from what the app stores.
 *
 * **The cache holds the app, never the content.** Imported FFG assets and
 * saves live in OPFS, which the service worker does not touch. A cache purge
 * on update therefore costs a download of a few hundred kilobytes, not the
 * user's several-hundred-megabyte import. Caching content here would make an
 * app update capable of destroying it.
 *
 * **An update never swaps under the user.** A new worker waits until the page
 * asks it to take over, so a quest in progress is not replaced mid-event. The
 * shell tells the user and lets them choose.
 */

/// <reference lib="webworker" />

/** Bumped by the build; the version string comes from `version.txt`. */
export const CACHE_PREFIX = 'valkyrie-app-'

export interface WorkerScope {
  addEventListener: (type: string, listener: (event: never) => void) => void
  skipWaiting: () => Promise<void>
  clients: { claim: () => Promise<void> }
  caches: CacheStorage
  registration: { waiting: unknown }
}

/**
 * Installs the handlers.
 *
 * Written as a function over an injected scope so it can be tested; a service
 * worker's own global is not reachable from a test runner.
 */
export function installServiceWorker(
  scope: {
    addEventListener: (type: string, listener: (event: ExtendableEvent) => void) => void
    skipWaiting: () => Promise<void>
    clients: { claim: () => Promise<void> }
  },
  options: { version: string; shell: readonly string[]; caches: CacheStorage },
): void {
  const cacheName = `${CACHE_PREFIX}${options.version}`

  scope.addEventListener('install', (event) => {
    // Deliberately *not* skipWaiting: the new worker waits until the user
    // accepts, so an update cannot replace the app mid-quest.
    event.waitUntil(
      options.caches.open(cacheName).then((cache) => cache.addAll([...options.shell])),
    )
  })

  scope.addEventListener('activate', (event) => {
    event.waitUntil(
      (async () => {
        // Only this app's own old caches are removed. Anything else in the
        // origin — including another tool's — is left alone.
        const names = await options.caches.keys()
        await Promise.all(
          names
            .filter((name) => name.startsWith(CACHE_PREFIX) && name !== cacheName)
            .map((name) => options.caches.delete(name)),
        )
        await scope.clients.claim()
      })(),
    )
  })

  scope.addEventListener('fetch', (event) => {
    const request = (event as unknown as { request: Request }).request
    if (request.method !== 'GET') return
    ;(event as unknown as FetchEvent).respondWith(respond(request, cacheName, options.caches))
  })

  scope.addEventListener('message', (event) => {
    const data = (event as unknown as { data?: { type?: string } }).data
    if (data?.type === 'SKIP_WAITING') void scope.skipWaiting()
  })
}

/**
 * Cache-first for the shell, network-first for everything else.
 *
 * The shell is versioned, so a cache hit is always correct. Content packs come
 * from GitHub and should be fresh, but a cached copy is far better than an
 * error when the user is offline — which is the whole point of the exercise.
 */
async function respond(
  request: Request,
  cacheName: string,
  caches: CacheStorage,
): Promise<Response> {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  if (cached !== undefined) return cached

  try {
    const response = await fetch(request)
    // Only same-origin, successful, basic responses are worth keeping; an
    // opaque cross-origin response cannot be inspected and would poison it.
    if (response.ok && response.type === 'basic') {
      await cache.put(request, response.clone())
    }
    return response
  } catch (error) {
    const fallback = await cache.match(request)
    if (fallback !== undefined) return fallback
    throw error
  }
}

export interface UpdateStatus {
  /** A new version is installed and waiting for the user to accept it. */
  waiting: boolean
  accept: () => void
}

/**
 * Watches for an update from the page side.
 *
 * `onUpdate` fires when a new worker is installed and waiting. Calling
 * `accept` tells it to take over and reloads — which is the user's choice, not
 * something that happens to them.
 */
export function watchForUpdate(
  registration: ServiceWorkerRegistration,
  onUpdate: (status: UpdateStatus) => void,
  reload: () => void = () => globalThis.location.reload(),
): void {
  const announce = (worker: ServiceWorker): void => {
    onUpdate({
      waiting: true,
      accept: () => {
        worker.postMessage({ type: 'SKIP_WAITING' })
        reload()
      },
    })
  }

  if (registration.waiting !== null) announce(registration.waiting)

  registration.addEventListener('updatefound', () => {
    const installing = registration.installing
    if (installing === null) return

    installing.addEventListener('statechange', () => {
      // "installed" with a controller present means an update, not a first
      // install — a first install has nothing to replace.
      if (installing.state === 'installed' && navigator.serviceWorker.controller !== null) {
        announce(installing)
      }
    })
  })
}
