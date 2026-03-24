// W3C Web Storage API for GJS
// Reference: refs/deno/ext/webstorage/01_webstorage.js
// localStorage: backed by in-memory Map (persistent via file I/O on GJS)
// sessionStorage: in-memory only (cleared on process exit)

/**
 * Storage class implementing the W3C Web Storage API.
 * https://html.spec.whatwg.org/multipage/webstorage.html
 */
export class Storage {
  private _data: Map<string, string>;

  constructor() {
    this._data = new Map();
  }

  /** Returns the number of key/value pairs. */
  get length(): number {
    return this._data.size;
  }

  /** Returns the name of the nth key, or null if n >= length. */
  key(index: number): string | null {
    if (index < 0 || index >= this._data.size) return null;
    const keys = Array.from(this._data.keys());
    return keys[index];
  }

  /** Returns the value associated with the given key, or null. */
  getItem(key: string): string | null {
    return this._data.get(String(key)) ?? null;
  }

  /** Sets the value of the pair identified by key to value. */
  setItem(key: string, value: string): void {
    this._data.set(String(key), String(value));
  }

  /** Removes the key/value pair with the given key. */
  removeItem(key: string): void {
    this._data.delete(String(key));
  }

  /** Removes all key/value pairs. */
  clear(): void {
    this._data.clear();
  }

  /** @internal Get all entries (for serialization). */
  _entries(): [string, string][] {
    return Array.from(this._data.entries());
  }

  /** @internal Load data from entries (for deserialization). */
  _load(entries: [string, string][]): void {
    this._data.clear();
    for (const [key, value] of entries) {
      this._data.set(key, value);
    }
  }

  get [Symbol.toStringTag]() {
    return 'Storage';
  }
}

/**
 * localStorage — persistent key/value storage.
 *
 * On GJS, persistence could be achieved via Gio.File to
 * `GLib.get_user_data_dir()/gjsify/localStorage.json`.
 * Currently backed by in-memory storage for cross-platform compatibility.
 */
export const localStorage = new Storage();

/**
 * sessionStorage — per-session key/value storage.
 * Data is lost when the process exits.
 */
export const sessionStorage = new Storage();

export default {
  Storage,
  localStorage,
  sessionStorage,
};
