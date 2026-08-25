/**
 * Port of `unity/Assets/Scripts/HTTPManager.cs`.
 *
 * The C# creates a `GameObject` per download and drives `UnityWebRequest`
 * through coroutines. All of that becomes ordinary async code over `fetch`.
 *
 * The one behaviour worth keeping is the error split: `UnityWebRequest`
 * distinguishes `isNetworkError` (no connectivity) from `isHttpError` (the
 * server answered, badly), and the UI says different things for each.
 */

/** No answer from the server: offline, DNS failure, blocked request. */
export class NetworkError extends Error {
  constructor(
    readonly url: string,
    options?: { cause?: unknown },
  ) {
    super(`Network error requesting ${url}`, options)
    this.name = 'NetworkError'
  }
}

/** The server answered with a failure status. */
export class HttpError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
    readonly statusText: string,
  ) {
    super(`HTTP ${status} ${statusText} for ${url}`)
    this.name = 'HttpError'
  }
}

export interface RequestOptions {
  signal?: AbortSignal
  /** Fraction between 0 and 1, and the bytes received so far. */
  onProgress?: (fraction: number, received: number, total: number | null) => void
}

export interface HttpClient {
  getText(url: string, options?: RequestOptions): Promise<string>
  getBytes(url: string, options?: RequestOptions): Promise<Uint8Array>
  /** Chunks as they arrive, for streaming straight into an extractor. */
  getStream(url: string, options?: RequestOptions): AsyncIterable<Uint8Array>
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

/**
 * `fetch`-backed client with progress, cancellation and resumption.
 *
 * Resumption is a real option here rather than a hope: `raw.githubusercontent.com`
 * answers with `accept-ranges: bytes` on both the manifests and the packages,
 * so an interrupted download of a 14 MB pack continues instead of restarting.
 */
export class FetchHttpClient implements HttpClient {
  constructor(
    private readonly fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
    /** How many times to resume a dropped transfer before giving up. */
    private readonly maxRetries = 3,
  ) {}

  async getText(url: string, options: RequestOptions = {}): Promise<string> {
    return new TextDecoder().decode(await this.getBytes(url, options))
  }

  async getBytes(url: string, options: RequestOptions = {}): Promise<Uint8Array> {
    const parts: Uint8Array[] = []
    let received = 0

    for await (const chunk of this.getStream(url, options)) {
      parts.push(chunk)
      received += chunk.length
    }

    const joined = new Uint8Array(received)
    let at = 0
    for (const part of parts) {
      joined.set(part, at)
      at += part.length
    }
    return joined
  }

  async *getStream(url: string, options: RequestOptions = {}): AsyncIterable<Uint8Array> {
    // Bytes already handed to the consumer. A resumed request must continue
    // from here exactly: the consumer cannot un-receive what it has.
    let delivered = 0
    let total: number | null = null
    let attempt = 0

    for (;;) {
      const headers: Record<string, string> = {}
      if (delivered > 0) headers['Range'] = `bytes=${delivered}-`

      const response = await this.request(url, headers, options.signal)
      const resumed = response.status === 206

      // A server that ignores the range sends the whole body again. Skipping
      // the prefix already delivered keeps the stream correct — restarting it
      // would duplicate those bytes in the consumer's output.
      let skip = resumed ? 0 : delivered
      const declared = contentLength(response, resumed ? delivered : 0)
      if (declared !== null) total = declared

      try {
        for await (const chunk of readBody(response)) {
          let piece = chunk
          if (skip > 0) {
            if (piece.length <= skip) {
              skip -= piece.length
              continue
            }
            piece = piece.subarray(skip)
            skip = 0
          }

          delivered += piece.length
          options.onProgress?.(
            total === null ? 0 : Math.min(delivered / total, 1),
            delivered,
            total,
          )
          yield piece
        }

        if (total === null || delivered >= total) return
        // The body ended short of what was promised: treat it as a drop.
        throw new NetworkError(url)
      } catch (cause) {
        if (isAbort(cause, options.signal)) throw cause
        if (++attempt > this.maxRetries) {
          throw cause instanceof NetworkError ? cause : new NetworkError(url, { cause })
        }
      }
    }
  }

  private async request(
    url: string,
    headers: Record<string, string>,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
    let response: Response
    try {
      response = await this.fetchImpl(url, {
        ...(signal === undefined ? {} : { signal }),
        ...(Object.keys(headers).length === 0 ? {} : { headers }),
      })
    } catch (cause) {
      if (isAbort(cause, signal)) throw cause
      throw new NetworkError(url, { cause })
    }

    if (!response.ok && response.status !== 206) {
      throw new HttpError(url, response.status, response.statusText)
    }
    return response
  }
}

/** Total size of the resource, accounting for a partial response. */
function contentLength(response: Response, alreadyHave: number): number | null {
  const range = response.headers.get('content-range')
  if (range !== null) {
    const total = /\/(\d+)$/.exec(range)?.[1]
    if (total !== undefined) return Number(total)
  }
  const length = response.headers.get('content-length')
  if (length === null) return null
  const value = Number(length)
  return Number.isFinite(value) ? value + alreadyHave : null
}

async function* readBody(response: Response): AsyncGenerator<Uint8Array> {
  const body = response.body
  if (body === null) {
    yield new Uint8Array(await response.arrayBuffer())
    return
  }

  const reader = body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      if (value !== undefined) yield value
    }
  } finally {
    reader.releaseLock()
  }
}

function isAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted === true) return true
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: string }).name === 'AbortError'
  )
}
