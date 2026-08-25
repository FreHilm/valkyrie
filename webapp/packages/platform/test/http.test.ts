/**
 * Tests for the fetch-backed HTTP client (T-013).
 *
 * `HTTPManager.cs` has no tests at all — it is Unity coroutines over
 * `UnityWebRequest`. What is worth pinning here is the error split the UI
 * depends on, and the resumption behaviour, which is new.
 */

import { describe, expect, it, vi } from 'vitest'

import { FetchHttpClient, HttpError, NetworkError } from '../src/http.js'

const encoder = new TextEncoder()

/** A Response whose body streams `chunks`, optionally dropping partway. */
function streamResponse(
  chunks: string[],
  init: { status?: number; headers?: Record<string, string>; dropAfter?: number } = {},
): Response {
  let sent = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (init.dropAfter !== undefined && sent >= init.dropAfter) {
        controller.error(new Error('connection reset'))
        return
      }
      const chunk = chunks[sent++]
      if (chunk === undefined) controller.close()
      else controller.enqueue(encoder.encode(chunk))
    },
  })

  return new Response(body, {
    status: init.status ?? 200,
    headers: init.headers ?? {},
  })
}

describe('FetchHttpClient', () => {
  it('reads text', async () => {
    const http = new FetchHttpClient(async () => streamResponse(['hello ', 'world']))

    expect(await http.getText('https://example.invalid/a')).toBe('hello world')
  })

  it('reads bytes', async () => {
    const http = new FetchHttpClient(async () => streamResponse(['ab', 'cd']))

    expect(await http.getBytes('https://example.invalid/a')).toEqual(encoder.encode('abcd'))
  })

  it('reports a failing status as HttpError, not a network problem', async () => {
    const http = new FetchHttpClient(async () => new Response('nope', { status: 404 }))

    await expect(http.getText('https://example.invalid/a')).rejects.toBeInstanceOf(HttpError)
    await expect(http.getText('https://example.invalid/a')).rejects.toMatchObject({ status: 404 })
  })

  it('reports a rejected fetch as NetworkError', async () => {
    const http = new FetchHttpClient(() => Promise.reject(new TypeError('failed to fetch')))

    await expect(http.getText('https://example.invalid/a')).rejects.toBeInstanceOf(NetworkError)
  })

  it('reports progress against content-length', async () => {
    const http = new FetchHttpClient(async () =>
      streamResponse(['aa', 'bb', 'cc'], { headers: { 'content-length': '6' } }),
    )
    const seen: number[] = []
    await http.getBytes('https://example.invalid/a', {
      onProgress: (fraction) => seen.push(fraction),
    })

    expect(seen).toEqual([2 / 6, 4 / 6, 1])
  })

  it('passes the abort signal through and does not wrap the abort', async () => {
    const controller = new AbortController()
    const http = new FetchHttpClient((_url, init) => {
      controller.abort()
      const error = new Error('aborted')
      error.name = 'AbortError'
      expect(init?.signal).toBe(controller.signal)
      return Promise.reject(error)
    })

    await expect(
      http.getText('https://example.invalid/a', { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  describe('resumption', () => {
    it('resumes from where a dropped transfer stopped', async () => {
      const requests: (string | undefined)[] = []
      const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
        const range = (init?.headers as Record<string, string> | undefined)?.['Range']
        requests.push(range)

        if (range === undefined) {
          // Sends "aabb" then drops, of six bytes total.
          return streamResponse(['aa', 'bb', 'cc'], {
            headers: { 'content-length': '6' },
            dropAfter: 2,
          })
        }
        return streamResponse(['cc'], {
          status: 206,
          headers: { 'content-range': 'bytes 4-5/6' },
        })
      })

      const http = new FetchHttpClient(fetchImpl)
      const bytes = await http.getBytes('https://example.invalid/pack')

      expect(new TextDecoder().decode(bytes)).toBe('aabbcc')
      expect(requests).toEqual([undefined, 'bytes=4-'])
    })

    it('does not duplicate bytes when the server ignores the range request', async () => {
      let call = 0
      const http = new FetchHttpClient(async () => {
        call++
        if (call === 1) {
          return streamResponse(['aa', 'bb'], {
            headers: { 'content-length': '4' },
            dropAfter: 1,
          })
        }
        // 200, not 206 — the range was ignored, so the whole body repeats.
        return streamResponse(['aa', 'bb'], { headers: { 'content-length': '4' } })
      })

      // The consumer already has "aa"; the repeat must be skipped, not appended.
      expect(new TextDecoder().decode(await http.getBytes('https://example.invalid/p'))).toBe(
        'aabb',
      )
    })

    it('skips a partial prefix when the repeat is chunked differently', async () => {
      let call = 0
      const http = new FetchHttpClient(async () => {
        call++
        if (call === 1) {
          return streamResponse(['abc', 'def'], {
            headers: { 'content-length': '6' },
            dropAfter: 1,
          })
        }
        // Same six bytes, split so the boundary falls inside a chunk.
        return streamResponse(['ab', 'cd', 'ef'], { headers: { 'content-length': '6' } })
      })

      expect(new TextDecoder().decode(await http.getBytes('https://example.invalid/p'))).toBe(
        'abcdef',
      )
    })

    it('gives up after the retry limit', async () => {
      const http = new FetchHttpClient(
        async () =>
          streamResponse(['aa', 'bb'], { headers: { 'content-length': '4' }, dropAfter: 1 }),
        2,
      )

      await expect(http.getBytes('https://example.invalid/p')).rejects.toBeInstanceOf(Error)
    })
  })

  it('streams chunks as they arrive', async () => {
    const http = new FetchHttpClient(async () => streamResponse(['a', 'b', 'c']))
    const seen: string[] = []
    for await (const chunk of http.getStream('https://example.invalid/a')) {
      seen.push(new TextDecoder().decode(chunk))
    }

    expect(seen).toEqual(['a', 'b', 'c'])
  })
})
