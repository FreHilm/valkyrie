/**
 * Port of `libraries/ValkyrieTools/ValkyrieDebug.cs`.
 *
 * Core must not depend on `console`, a file logger, or any host API, so the
 * sink is injected. The app wires a real sink at startup; tests leave it off.
 */

export type LogSink = (message: string) => void

let sink: LogSink | null = null

export function setLogSink(next: LogSink | null): void {
  sink = next
}

export function log(message: string): void {
  sink?.(message)
}
