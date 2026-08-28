/**
 * Port of `unity/Assets/Scripts/Quest/QuestLog.cs` and the `LogEntry` class
 * from `Quest.cs:2754`.
 *
 * The log a quest accumulates as it plays, written into `save.ini` and shown
 * on the log screen. Three kinds of entry: quest text the player sees, editor
 * notices, and Valkyrie diagnostics.
 */

/** Which audience an entry is for. `type` strings come from a save file. */
export type LogEntryKind = 'quest' | 'editor' | 'valkyrie'

export class LogEntry {
  readonly entry: string
  readonly editor: boolean
  readonly valkyrie: boolean

  constructor(entry: string, editor = false, valkyrie = false) {
    this.entry = entry
    this.editor = editor
    this.valkyrie = valkyrie
  }

  /**
   * The `LogEntry(string type, string e)` overload, which reads the flags out
   * of a save key like `valkyrie3`.
   *
   * The C# uses `IndexOf(...) == 0`, so it is a prefix test: `editorial` sets
   * the editor flag, and a type of `quest` sets neither.
   */
  static fromType(type: string, entry: string): LogEntry {
    return new LogEntry(entry, type.startsWith('editor'), type.startsWith('valkyrie'))
  }

  get kind(): LogEntryKind {
    if (this.valkyrie) return 'valkyrie'
    if (this.editor) return 'editor'
    return 'quest'
  }

  /**
   * The save-file line for this entry.
   *
   * DEVIATION: the C# appends `Environment.NewLine`, so a save written on
   * Windows differs byte for byte from one written elsewhere — and
   * `QuestLogTests.cs` asserts `\r\n` literally, so those cases only pass on
   * Windows. The port always writes "\n", matching `IniData.toString`.
   */
  toString(id: number): string {
    return `${this.kind}${id}=${this.entry.replace(/\n/g, '\\n')}\n`
  }

  /**
   * The display text, or "" when this entry is not for the current audience.
   *
   * DEVIATION: the C# hides Valkyrie entries unless `Application.isEditor`.
   * There is no Unity editor here, so it takes an explicit flag. It defaults
   * to false — the shipped-build behaviour — where the C# test suite runs with
   * it implicitly true.
   */
  getEntry(editorSet = false, developmentBuild = false): string {
    if (this.valkyrie && !developmentBuild) return ''
    if (this.editor && !editorSet) return ''
    return `${this.entry.replace(/\\n/g, '\n')}\n\n`
  }
}

/** An ordered list of log entries. `LinkedList` in the C#; order is the point. */
export class QuestLog implements Iterable<LogEntry> {
  private readonly entries: LogEntry[] = []

  get length(): number {
    return this.entries.length
  }

  add(entry: LogEntry): void {
    this.entries.push(entry)
  }

  /** Takes on another log's entries, for a save being restored in place. */
  replaceWith(other: QuestLog): void {
    this.entries.length = 0
    this.entries.push(...other.toArray())
  }

  [Symbol.iterator](): Iterator<LogEntry> {
    return this.entries[Symbol.iterator]()
  }

  toArray(): LogEntry[] {
    return [...this.entries]
  }

  /** The `[Log]` section of a save, in order. */
  toString(): string {
    return this.entries.map((entry, id) => entry.toString(id)).join('')
  }

  /** Rebuilds a log from a parsed `[Log]` section. */
  static fromSection(section: ReadonlyMap<string, string>): QuestLog {
    const log = new QuestLog()
    for (const [key, value] of section) {
      log.add(LogEntry.fromType(key, value))
    }
    return log
  }
}
