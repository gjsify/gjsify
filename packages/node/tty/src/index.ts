// Node.js tty module for GJS
// Reference: Node.js lib/tty.js
// Uses ANSI escape sequences for terminal control.

import { Writable, Readable } from 'node:stream';
import GLib from '@girs/glib-2.0';

export class ReadStream extends Readable {
  isRaw = false;
  readonly fd: number;

  constructor(fd: number = 0) {
    super();
    this.fd = fd;
  }

  get isTTY() {
    return isatty(this.fd);
  }

  setRawMode(mode: boolean) {
    if (this.isRaw !== mode) {
      this.isRaw = mode;
      this.emit('modeChange');
    }
    return this;
  }
}

export class WriteStream extends Writable {
  isRaw = false;
  columns = 80;
  rows = 24;
  readonly fd: number;

  protected _print = console.log;

  constructor(fd: number) {
    super();
    this.fd = fd;
    this._detectSize();
  }

  get isTTY() {
    return isatty(this.fd);
  }

  /** Detect terminal size from environment or defaults. */
  private _detectSize(): void {
    const cols = parseInt(
      (globalThis as any).process?.env?.COLUMNS ||
      (typeof GLib !== 'undefined' ? GLib.getenv('COLUMNS') : '') || '0',
      10,
    );
    const rows = parseInt(
      (globalThis as any).process?.env?.LINES ||
      (typeof GLib !== 'undefined' ? GLib.getenv('LINES') : '') || '0',
      10,
    );
    if (cols > 0) this.columns = cols;
    if (rows > 0) this.rows = rows;
  }

  /**
   * Clear the current line.
   * dir: -1 = left of cursor, 0 = entire line, 1 = right of cursor
   */
  clearLine(dir: number, callback?: () => void): boolean {
    let seq: string;
    if (dir === -1) {
      seq = '\x1b[1K'; // clear left
    } else if (dir === 1) {
      seq = '\x1b[0K'; // clear right
    } else {
      seq = '\x1b[2K'; // clear entire line
    }
    return this.write(seq, callback);
  }

  /** Clear the screen from the cursor down. */
  clearScreenDown(callback?: () => void): boolean {
    return this.write('\x1b[0J', callback);
  }

  /**
   * Move cursor to absolute position (x, y).
   * If y is omitted, only move horizontally.
   */
  cursorTo(x: number, y?: number | (() => void), callback?: () => void): boolean {
    if (typeof y === 'function') {
      callback = y;
      y = undefined;
    }

    let seq: string;
    if (y == null) {
      seq = `\x1b[${x + 1}G`; // move to column x
    } else {
      seq = `\x1b[${(y as number) + 1};${x + 1}H`; // move to row;col
    }
    return this.write(seq, callback);
  }

  /**
   * Move cursor relative to its current position.
   */
  moveCursor(dx: number, dy: number, callback?: () => void): boolean {
    let seq = '';
    if (dx > 0) seq += `\x1b[${dx}C`;      // right
    else if (dx < 0) seq += `\x1b[${-dx}D`; // left
    if (dy > 0) seq += `\x1b[${dy}B`;       // down
    else if (dy < 0) seq += `\x1b[${-dy}A`; // up

    if (seq.length === 0) {
      if (callback) callback();
      return true;
    }
    return this.write(seq, callback);
  }

  /**
   * Get the color depth of the terminal.
   * Returns 1 (no color), 4 (16 colors), 8 (256 colors), or 24 (true color).
   */
  getColorDepth(env?: Record<string, string>): number {
    const e = env || (globalThis as any).process?.env || {};

    // FORCE_COLOR takes precedence
    if ('FORCE_COLOR' in e) {
      const force = e.FORCE_COLOR;
      if (force === '0' || force === 'false') return 1;
      if (force === '1') return 4;
      if (force === '2') return 8;
      if (force === '3') return 24;
      return 4; // truthy value
    }

    if ('NO_COLOR' in e) return 1;

    const term = e.TERM || '';
    const colorterm = e.COLORTERM || '';

    if (colorterm === 'truecolor' || colorterm === '24bit') return 24;
    if (term === 'xterm-256color' || term.endsWith('-256color')) return 8;
    if (colorterm) return 4;
    if (term === 'dumb') return 1;
    if (term.startsWith('xterm') || term.startsWith('screen') || term.startsWith('vt100') || term.startsWith('linux')) return 4;

    return 1;
  }

  /** Get the terminal window size as [columns, rows]. */
  getWindowSize(): [number, number] {
    return [this.columns, this.rows];
  }

  /**
   * Check if the terminal supports the given number of colors.
   */
  hasColors(count?: number | Record<string, string>, env?: Record<string, string>): boolean {
    let _count: number;
    let _env: Record<string, string> | undefined;

    if (typeof count === 'object') {
      _env = count;
      _count = 16;
    } else {
      _count = count ?? 16;
      _env = env;
    }

    const depth = this.getColorDepth(_env);
    switch (depth) {
      case 1: return _count >= 2;
      case 4: return _count >= 16;
      case 8: return _count >= 256;
      case 24: return _count >= 16777216;
      default: return false;
    }
  }

  setRawMode(mode: boolean) {
    if (this.isRaw !== mode) {
      this.isRaw = mode;
      this.emit('modeChange');
    }
    return this;
  }

  override _write(chunk: any, enc: string, cb: Function) {
    this._print(enc === 'buffer' ? chunk.toString('utf-8') : chunk);
    cb(null);
  }

  _changeColumns(columns: number) {
    if (columns !== this.columns) {
      this.columns = columns;
      this.emit('resize');
    }
  }

  _changeRows(rows: number) {
    if (rows !== this.rows) {
      this.rows = rows;
      this.emit('resize');
    }
  }
}

/**
 * Check if a file descriptor refers to a TTY.
 * Uses GLib.log_writer_supports_color() as a reliable TTY proxy: if a fd supports
 * ANSI colors it is connected to an interactive terminal.
 */
export function isatty(fd: number | ReadStream | WriteStream): boolean {
  if (fd instanceof ReadStream || fd instanceof WriteStream) {
    return isatty(fd.fd);
  }
  if (typeof fd === 'number') {
    return GLib.log_writer_supports_color(fd);
  }
  return false;
}

export default {
  isatty,
  WriteStream,
  ReadStream,
};
