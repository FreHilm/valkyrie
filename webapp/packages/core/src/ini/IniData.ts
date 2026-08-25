/**
 * Port of the `IniData` class in `libraries/ValkyrieTools/IniRead.cs`.
 *
 * Backed by `Map` rather than a plain object: INI keys come from untrusted
 * content packs, and a key like `__proto__` or `constructor` must be storable
 * without touching the prototype chain. `Map` also guarantees the insertion
 * order that `toString()` depends on.
 */
export class IniData {
  readonly data = new Map<string, Map<string, string>>()

  /** Adds a whole section. Returns false on collision, leaving the original. */
  addSection(name: string, section: Map<string, string>): boolean {
    if (this.data.has(name)) return false
    this.data.set(name, section)
    return true
  }

  /** Adds or replaces a single entry, creating the section if needed. */
  add(section: string, name: string, value: string): void {
    let entries = this.data.get(section)
    if (entries === undefined) {
      entries = new Map<string, string>()
      this.data.set(section, entries)
    }
    entries.set(name, value)
  }

  /** Removes one entry. No-op if the section or entry is absent. */
  remove(section: string, name: string): void {
    this.data.get(section)?.delete(name)
  }

  /** Removes a whole section. No-op if absent. */
  removeSection(section: string): void {
    this.data.delete(section)
  }

  /** Returns the section, or null if absent. */
  getSection(section: string): Map<string, string> | null {
    return this.data.get(section) ?? null
  }

  /** Returns the value, or "" if the section or entry is absent. */
  get(section: string, item: string): string {
    return this.data.get(section)?.get(item) ?? ''
  }

  /**
   * Serialises back to INI text.
   *
   * Deviation from C#: uses "\n" where the original used
   * `System.Environment.NewLine`. The C# output was platform-dependent; a
   * single artifact serving every platform cannot be.
   */
  toString(): string {
    let result = ''
    for (const [section, entries] of this.data) {
      result += `[${section}]\n`
      for (const [key, value] of entries) {
        result += value.length > 0 ? `${key}=${value}\n` : `${key}\n`
      }
      result += '\n'
    }
    return result
  }
}
