// Node.js readline module for GJS
// Reference: Node.js lib/readline.js

import { EventEmitter } from 'events';
import type { Readable, Writable } from 'stream';

export interface InterfaceOptions {
  input?: Readable;
  output?: Writable;
  prompt?: string;
  terminal?: boolean;
  historySize?: number;
  completer?: (line: string, callback: (err: Error | null, result: [string[], string]) => void) => void;
  crlfDelay?: number;
  removeHistoryDuplicates?: boolean;
  escapeCodeTimeout?: number;
  tabSize?: number;
}

/**
 * readline.Interface — reads lines from a Readable stream.
 */
export class Interface extends EventEmitter {
  terminal: boolean;
  line = '';
  cursor = 0;

  private _input: Readable | null;
  private _output: Writable | null;
  private _prompt: string;
  private _closed = false;
  private _paused = false;
  private _history: string[];
  private _historySize: number;
  private _crlfDelay: number;
  private _lineBuffer = '';
  private _questionCallback: ((answer: string) => void) | null = null;

  constructor(input?: Readable | InterfaceOptions, output?: Writable) {
    super();

    let opts: InterfaceOptions;
    if (input && typeof input === 'object' && !('read' in input && typeof (input as any).read === 'function')) {
      opts = input as InterfaceOptions;
    } else {
      opts = { input: input as Readable, output };
    }

    this._input = opts.input || null;
    this._output = opts.output || null;
    this._prompt = opts.prompt || '> ';
    this.terminal = opts.terminal ?? (this._output !== null);
    this._historySize = opts.historySize ?? 30;
    this._history = [];
    this._crlfDelay = opts.crlfDelay ?? 100;

    if (this._input) {
      this._input.on('data', (chunk: Buffer | string) => this._onData(chunk));
      this._input.on('end', () => this._onEnd());
      this._input.on('error', (err: Error) => this.emit('error', err));

      if (typeof (this._input as any).setEncoding === 'function') {
        (this._input as any).setEncoding('utf8');
      }
    }
  }

  private _onData(chunk: Buffer | string): void {
    if (this._closed || this._paused) return;

    const str = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    this._lineBuffer += str;

    let newlineIndex: number;
    while ((newlineIndex = this._lineBuffer.indexOf('\n')) !== -1) {
      let line = this._lineBuffer.substring(0, newlineIndex);
      this._lineBuffer = this._lineBuffer.substring(newlineIndex + 1);

      // Handle \r\n
      if (line.endsWith('\r')) {
        line = line.slice(0, -1);
      }

      this._onLine(line);
    }
  }

  private _onLine(line: string): void {
    // Add to history
    if (line.length > 0 && this._historySize > 0) {
      if (this._history.length === 0 || this._history[0] !== line) {
        this._history.unshift(line);
        if (this._history.length > this._historySize) {
          this._history.pop();
        }
      }
    }

    if (this._questionCallback) {
      const cb = this._questionCallback;
      this._questionCallback = null;
      cb(line);
    }

    this.emit('line', line);
  }

  private _onEnd(): void {
    // Emit remaining buffer as last line
    if (this._lineBuffer.length > 0) {
      this._onLine(this._lineBuffer);
      this._lineBuffer = '';
    }
    this.close();
  }

  /** Set the prompt string. */
  setPrompt(prompt: string): void {
    this._prompt = prompt;
  }

  /** Get the current prompt string. */
  getPrompt(): string {
    return this._prompt;
  }

  /** Write the prompt to the output stream. */
  prompt(preserveCursor?: boolean): void {
    if (this._closed) return;
    if (this._output) {
      this._output.write(this._prompt);
    }
  }

  /**
   * Display the query and wait for user input.
   */
  question(query: string, callback: (answer: string) => void): void;
  question(query: string, options: any, callback: (answer: string) => void): void;
  question(query: string, optionsOrCallback: any, callback?: (answer: string) => void): void {
    if (this._closed) {
      throw new Error('readline was closed');
    }

    const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback!;

    this._questionCallback = cb;

    if (this._output) {
      this._output.write(query);
    }
  }

  /** Write data to the output stream. */
  write(data: string | Buffer | null, key?: { ctrl?: boolean; meta?: boolean; shift?: boolean; name?: string }): void {
    if (this._closed) return;

    if (data !== null && data !== undefined) {
      if (this._output) {
        this._output.write(data);
      }
    }
  }

  /** Close the interface. */
  close(): void {
    if (this._closed) return;
    this._closed = true;

    if (this._input) {
      this._input.removeAllListeners('data');
      this._input.removeAllListeners('end');
    }

    this.emit('close');
  }

  /** Pause the input stream. */
  pause(): this {
    if (this._closed) return this;
    this._paused = true;

    if (this._input && typeof (this._input as any).pause === 'function') {
      (this._input as any).pause();
    }

    this.emit('pause');
    return this;
  }

  /** Resume the input stream. */
  resume(): this {
    if (this._closed) return this;
    this._paused = false;

    if (this._input && typeof (this._input as any).resume === 'function') {
      (this._input as any).resume();
    }

    this.emit('resume');
    return this;
  }

  /** Get the current line content. */
  getCursorPos(): { rows: number; cols: number } {
    return { rows: 0, cols: this.cursor };
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<string> {
    const lines: string[] = [];
    let resolve: ((value: IteratorResult<string>) => void) | null = null;
    let done = false;

    this.on('line', (line: string) => {
      if (resolve) {
        const r = resolve;
        resolve = null;
        r({ value: line, done: false });
      } else {
        lines.push(line);
      }
    });

    this.on('close', () => {
      done = true;
      if (resolve) {
        const r = resolve;
        resolve = null;
        r({ value: undefined as any, done: true });
      }
    });

    return {
      next(): Promise<IteratorResult<string>> {
        if (lines.length > 0) {
          return Promise.resolve({ value: lines.shift()!, done: false });
        }
        if (done) {
          return Promise.resolve({ value: undefined as any, done: true });
        }
        return new Promise<IteratorResult<string>>((r) => { resolve = r; });
      },
      return(): Promise<IteratorResult<string>> {
        done = true;
        return Promise.resolve({ value: undefined as any, done: true });
      },
      [Symbol.asyncIterator]() { return this; },
    };
  }
}

/**
 * Create a readline Interface.
 */
export function createInterface(input?: Readable | InterfaceOptions, output?: Writable, completer?: any, terminal?: boolean): Interface {
  if (typeof input === 'object' && input !== null && !('read' in input && typeof (input as any).read === 'function')) {
    return new Interface(input);
  }
  return new Interface({ input: input as Readable, output, completer, terminal });
}

// --- Terminal utility functions ---

/**
 * Clear the current line of a TTY stream.
 * dir: -1 = to the left, 1 = to the right, 0 = entire line
 */
export function clearLine(stream: Writable, dir: number, callback?: () => void): boolean {
  if (!stream || typeof stream.write !== 'function') {
    if (callback) callback();
    return true;
  }

  const code = dir < 0 ? '\x1b[1K' : dir > 0 ? '\x1b[0K' : '\x1b[2K';
  return stream.write(code, callback);
}

/**
 * Clear from cursor to end of screen.
 */
export function clearScreenDown(stream: Writable, callback?: () => void): boolean {
  if (!stream || typeof stream.write !== 'function') {
    if (callback) callback();
    return true;
  }

  return stream.write('\x1b[0J', callback);
}

/**
 * Move cursor to the specified position.
 */
export function cursorTo(
  stream: Writable,
  x: number,
  y?: number | (() => void),
  callback?: () => void,
): boolean {
  if (!stream || typeof stream.write !== 'function') {
    if (typeof y === 'function') y();
    else if (callback) callback();
    return true;
  }

  if (typeof y === 'function') {
    callback = y;
    y = undefined;
  }

  const code = typeof y === 'number'
    ? `\x1b[${y + 1};${x + 1}H`
    : `\x1b[${x + 1}G`;

  return stream.write(code, callback);
}

/**
 * Move cursor relative to its current position.
 */
export function moveCursor(
  stream: Writable,
  dx: number,
  dy: number,
  callback?: () => void,
): boolean {
  if (!stream || typeof stream.write !== 'function') {
    if (callback) callback();
    return true;
  }

  let code = '';
  if (dx > 0) code += `\x1b[${dx}C`;
  else if (dx < 0) code += `\x1b[${-dx}D`;
  if (dy > 0) code += `\x1b[${dy}B`;
  else if (dy < 0) code += `\x1b[${-dy}A`;

  if (code) {
    return stream.write(code, callback);
  }

  if (callback) callback();
  return true;
}

/**
 * Enable keypress events on a stream (no-op in GJS — full implementation
 * requires raw terminal mode which depends on the input stream type).
 */
export function emitKeypressEvents(_stream: any, _interface?: Interface): void {
  // Keypress event emission requires raw terminal mode.
  // This is a best-effort no-op; real keypress detection needs platform-specific code.
}

export default {
  Interface,
  createInterface,
  clearLine,
  clearScreenDown,
  cursorTo,
  moveCursor,
  emitKeypressEvents,
};
