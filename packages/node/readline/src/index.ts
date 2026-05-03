// Node.js readline module for GJS
// Reference: Node.js lib/readline.js

import { EventEmitter } from 'node:events';
import { StringDecoder } from 'node:string_decoder';
import type { Readable, Writable } from 'node:stream';

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

  get input(): Readable | null { return this._input; }
  get output(): Writable | null { return this._output; }
  private _prompt: string;
  private _closed = false;
  private _paused = false;
  history: string[];
  private _historySize: number;
  private _crlfDelay: number;
  private _lineBuffer = '';
  private _questionCallback: ((answer: string) => void) | null = null;
  // Keep references so close() removes only our listeners (not the keypress parser's).
  private _boundOnData: ((chunk: Buffer | string) => void) | null = null;
  private _boundOnEnd: (() => void) | null = null;
  private _boundOnError: ((err: Error) => void) | null = null;

  constructor(input?: Readable | InterfaceOptions, output?: Writable) {
    super();

    let opts: InterfaceOptions;
    if (input && typeof input === 'object' && !('read' in input && typeof input.read === 'function')) {
      opts = input as InterfaceOptions;
    } else {
      opts = { input: input as Readable, output };
    }

    this._input = opts.input || null;
    this._output = opts.output || null;
    this._prompt = opts.prompt || '> ';
    this.terminal = opts.terminal ?? (this._output !== null);
    this._historySize = opts.historySize ?? 30;
    this.history = [];
    this._crlfDelay = opts.crlfDelay ?? 100;

    if (this._input) {
      this._boundOnData = (chunk: Buffer | string) => this._onData(chunk);
      this._boundOnEnd = () => this._onEnd();
      this._boundOnError = (err: Error) => this.emit('error', err);
      this._input.on('data', this._boundOnData);
      this._input.on('end', this._boundOnEnd);
      this._input.on('error', this._boundOnError);

      if ('setEncoding' in this._input && typeof this._input.setEncoding === 'function') {
        this._input.setEncoding('utf8');
      }

      if (this.terminal) {
        // Install keypress parser so @inquirer/core can receive keypress events.
        // Also activate raw mode when the stream supports it (GjsifyTerminal).
        emitKeypressEvents(this._input as Readable & Record<symbol, unknown>, this as any);
        if ('setRawMode' in this._input && typeof (this._input as any).setRawMode === 'function') {
          const isRaw = (this._input as any).isRaw;
          if (!isRaw) (this._input as any).setRawMode(true);
        }
        if ('resume' in this._input && typeof (this._input as any).resume === 'function') {
          (this._input as any).resume();
        }
      }
    }
  }

  private _onData(chunk: Buffer | string): void {
    if (this._closed || this._paused) return;

    const str = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    this._lineBuffer += str;

    // Process lines separated by \n, \r\n, or standalone \r
    const lineEnd = /\r\n|\r|\n/;
    let m: RegExpExecArray | null;
    while ((m = lineEnd.exec(this._lineBuffer)) !== null) {
      const line = this._lineBuffer.substring(0, m.index);
      this._lineBuffer = this._lineBuffer.substring(m.index + m[0].length);
      this._onLine(line);
    }
  }

  private _onLine(line: string): void {
    // Add to history
    if (line.length > 0 && this._historySize > 0) {
      if (this.history.length === 0 || this.history[0] !== line) {
        this.history.unshift(line);
        if (this.history.length > this._historySize) {
          this.history.pop();
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
    if (this._closed) {
      throw new Error('readline was closed');
    }
    if (this._output) {
      this._output.write(this._prompt);
    }
  }

  /**
   * Display the query and wait for user input.
   */
  question(query: string, callback: (answer: string) => void): void;
  question(query: string, options: Record<string, unknown>, callback: (answer: string) => void): void;
  question(query: string, optionsOrCallback: Record<string, unknown> | ((answer: string) => void), callback?: (answer: string) => void): void {
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
      // Remove only our own listeners — removeAllListeners would also strip the
      // keypress parser's 'data' listener, leaving the _KEYPRESS_DECODER Symbol
      // set but orphaned. The next Interface would see the Symbol and skip
      // emitKeypressEvents setup (idempotency guard), so keypress events would
      // never fire for subsequent prompts.
      if (this._boundOnData) this._input.removeListener('data', this._boundOnData);
      if (this._boundOnEnd) this._input.removeListener('end', this._boundOnEnd);
      if (this._boundOnError) this._input.removeListener('error', this._boundOnError);
      this._boundOnData = null;
      this._boundOnEnd = null;
      this._boundOnError = null;
    }

    this.emit('close');
  }

  /** Pause the input stream. */
  pause(): this {
    if (this._closed) return this;
    this._paused = true;

    if (this._input && 'pause' in this._input && typeof this._input.pause === 'function') {
      this._input.pause();
    }

    this.emit('pause');
    return this;
  }

  /** Resume the input stream. */
  resume(): this {
    if (this._closed) return this;
    this._paused = false;

    if (this._input && 'resume' in this._input && typeof this._input.resume === 'function') {
      this._input.resume();
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
        r({ value: undefined as unknown as string, done: true });
      }
    });

    return {
      next(): Promise<IteratorResult<string>> {
        if (lines.length > 0) {
          return Promise.resolve({ value: lines.shift()!, done: false });
        }
        if (done) {
          return Promise.resolve({ value: undefined as unknown as string, done: true });
        }
        return new Promise<IteratorResult<string>>((r) => { resolve = r; });
      },
      return(): Promise<IteratorResult<string>> {
        done = true;
        return Promise.resolve({ value: undefined as unknown as string, done: true });
      },
      [Symbol.asyncIterator]() { return this; },
    };
  }
}

/**
 * Create a readline Interface.
 */
export function createInterface(input?: Readable | InterfaceOptions, output?: Writable, completer?: InterfaceOptions['completer'], terminal?: boolean): Interface {
  if (typeof input === 'object' && input !== null && !('read' in input && typeof input.read === 'function')) {
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

// ── Keypress parser ───────────────────────────────────────────────────────────
// Ported from refs/node/lib/internal/readline/utils.js (emitKeys generator)
// Original: Node.js contributors, MIT.
// Rewritten for TypeScript / GJS without Node.js primordials.

export interface Key {
  sequence: string;
  name: string | undefined;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  code?: string;
}

const ESCAPE_CODE_TIMEOUT = 500;

// Generator that accepts one character at a time via .next(ch) and emits
// 'keypress' events on `stream` for each recognised key sequence.
function* emitKeys(stream: { emit(event: string, ...args: unknown[]): boolean }): Generator<void, void, string> {
  while (true) {
    let ch: string = yield;
    let s = ch;
    let escaped = false;
    const key: Key = { sequence: '', name: undefined, ctrl: false, meta: false, shift: false };

    if (ch === '\x1b') {
      escaped = true;
      s += (ch = yield);
      if (ch === '\x1b') s += (ch = yield);
    }

    if (escaped && (ch === 'O' || ch === '[')) {
      let code = ch;
      let modifier = 0;

      if (ch === 'O') {
        s += (ch = yield);
        if (ch >= '0' && ch <= '9') { modifier = ch.charCodeAt(0) - 1; s += (ch = yield); }
        code += ch;
      } else if (ch === '[') {
        s += (ch = yield);
        if (ch === '[') { code += ch; s += (ch = yield); }
        const cmdStart = s.length - 1;
        if (ch >= '0' && ch <= '9') {
          s += (ch = yield);
          if (ch >= '0' && ch <= '9') { s += (ch = yield); if (ch >= '0' && ch <= '9') s += (ch = yield); }
        }
        if (ch === ';') { s += (ch = yield); if (ch >= '0' && ch <= '9') s += (yield); }
        const cmd = s.slice(cmdStart);
        let match: RegExpExecArray | null;
        if ((match = /^(?:(\d\d?)(?:;(\d))?([~^$])|(\d{3}~))$/.exec(cmd))) {
          if (match[4]) { code += match[4]; } else { code += match[1] + match[3]; modifier = (parseInt(match[2] ?? '1', 10) || 1) - 1; }
        } else if ((match = /^((\d;)?(\d))?([A-Za-z])$/.exec(cmd))) {
          code += match[4]; modifier = (parseInt(match[3] ?? '1', 10) || 1) - 1;
        } else { code += cmd; }
      }

      key.ctrl = !!(modifier & 4); key.meta = !!(modifier & 10); key.shift = !!(modifier & 1); key.code = code;

      switch (code) {
        case '[P': case 'OP': case '[11~': case '[[A': key.name = 'f1'; break;
        case '[Q': case 'OQ': case '[12~': case '[[B': key.name = 'f2'; break;
        case '[R': case 'OR': case '[13~': case '[[C': key.name = 'f3'; break;
        case '[S': case 'OS': case '[14~': case '[[D': key.name = 'f4'; break;
        case '[15~': case '[[E': key.name = 'f5'; break;
        case '[17~': key.name = 'f6'; break; case '[18~': key.name = 'f7'; break;
        case '[19~': key.name = 'f8'; break; case '[20~': key.name = 'f9'; break;
        case '[21~': key.name = 'f10'; break; case '[23~': key.name = 'f11'; break;
        case '[24~': key.name = 'f12'; break;
        case '[200~': key.name = 'paste-start'; break; case '[201~': key.name = 'paste-end'; break;
        case '[A': case 'OA': key.name = 'up'; break;
        case '[B': case 'OB': key.name = 'down'; break;
        case '[C': case 'OC': key.name = 'right'; break;
        case '[D': case 'OD': key.name = 'left'; break;
        case '[E': case 'OE': key.name = 'clear'; break;
        case '[F': case 'OF': key.name = 'end'; break;
        case '[H': case 'OH': key.name = 'home'; break;
        case '[1~': key.name = 'home'; break; case '[2~': key.name = 'insert'; break;
        case '[3~': key.name = 'delete'; break; case '[4~': key.name = 'end'; break;
        case '[5~': case '[[5~': key.name = 'pageup'; break;
        case '[6~': case '[[6~': key.name = 'pagedown'; break;
        case '[7~': key.name = 'home'; break; case '[8~': key.name = 'end'; break;
        case '[a': key.name = 'up'; key.shift = true; break;
        case '[b': key.name = 'down'; key.shift = true; break;
        case '[c': key.name = 'right'; key.shift = true; break;
        case '[d': key.name = 'left'; key.shift = true; break;
        case '[2$': key.name = 'insert'; key.shift = true; break;
        case '[3$': key.name = 'delete'; key.shift = true; break;
        case '[5$': key.name = 'pageup'; key.shift = true; break;
        case '[6$': key.name = 'pagedown'; key.shift = true; break;
        case '[7$': key.name = 'home'; key.shift = true; break;
        case '[8$': key.name = 'end'; key.shift = true; break;
        case 'Oa': key.name = 'up'; key.ctrl = true; break;
        case 'Ob': key.name = 'down'; key.ctrl = true; break;
        case 'Oc': key.name = 'right'; key.ctrl = true; break;
        case 'Od': key.name = 'left'; key.ctrl = true; break;
        case '[2^': key.name = 'insert'; key.ctrl = true; break;
        case '[3^': key.name = 'delete'; key.ctrl = true; break;
        case '[5^': key.name = 'pageup'; key.ctrl = true; break;
        case '[6^': key.name = 'pagedown'; key.ctrl = true; break;
        case '[7^': key.name = 'home'; key.ctrl = true; break;
        case '[8^': key.name = 'end'; key.ctrl = true; break;
        case '[Z': key.name = 'tab'; key.shift = true; break;
        default: key.name = 'undefined'; break;
      }
    } else if (ch === '\r') {
      key.name = 'return'; key.meta = escaped;
    } else if (ch === '\n') {
      key.name = 'enter'; key.meta = escaped;
    } else if (ch === '\t') {
      key.name = 'tab'; key.meta = escaped;
    } else if (ch === '\b' || ch === '\x7f') {
      key.name = 'backspace'; key.meta = escaped;
    } else if (ch === '\x1b') {
      key.name = 'escape'; key.meta = escaped;
    } else if (ch === ' ') {
      key.name = 'space'; key.meta = escaped;
    } else if (!escaped && ch <= '\x1a') {
      key.name = String.fromCharCode(ch.charCodeAt(0) + 'a'.charCodeAt(0) - 1);
      key.ctrl = true;
    } else if (/^[0-9A-Za-z]$/.test(ch)) {
      key.name = ch.toLowerCase(); key.shift = /^[A-Z]$/.test(ch); key.meta = escaped;
    } else if (escaped) {
      key.name = ch.length ? undefined : 'escape'; key.meta = true;
    }

    key.sequence = s;
    if (s.length !== 0 && (key.name !== undefined || escaped)) {
      stream.emit('keypress', escaped ? undefined : s, key);
    } else if (s.length === 1) {
      stream.emit('keypress', s, key);
    }
  }
}

const _KEYPRESS_DECODER = Symbol('keypress-decoder');
const _ESCAPE_DECODER   = Symbol('escape-decoder');

/**
 * Attach a 'data' listener to `stream` that parses raw bytes into 'keypress'
 * events.  Idempotent — calling twice on the same stream is a no-op.
 * Ported from refs/node/lib/internal/readline/emitKeypressEvents.js.
 */
export function emitKeypressEvents(stream: Readable & Record<symbol, unknown>, iface: { escapeCodeTimeout?: number } = {}): void {
  if ((stream as any)[_KEYPRESS_DECODER]) return;

  (stream as any)[_KEYPRESS_DECODER] = new StringDecoder('utf8');
  (stream as any)[_ESCAPE_DECODER] = emitKeys(stream as any);
  (stream as any)[_ESCAPE_DECODER].next(); // prime the generator

  const escTimeout = iface.escapeCodeTimeout ?? ESCAPE_CODE_TIMEOUT;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const triggerEscape = () => (stream as any)[_ESCAPE_DECODER].next('');

  function onData(input: Buffer | string): void {
    if ((stream as any).listenerCount('keypress') > 0) {
      const str: string = (stream as any)[_KEYPRESS_DECODER].write(
        typeof input === 'string' ? Buffer.from(input) : input,
      );
      if (str) {
        clearTimeout(timeoutId);
        for (const ch of str) {
          try {
            (stream as any)[_ESCAPE_DECODER].next(ch);
            if (ch === '\x1b') timeoutId = setTimeout(triggerEscape, escTimeout);
          } catch {
            (stream as any)[_ESCAPE_DECODER] = emitKeys(stream as any);
            (stream as any)[_ESCAPE_DECODER].next();
          }
        }
      }
    } else {
      (stream as any).removeListener('data', onData);
      delete (stream as any)[_KEYPRESS_DECODER];
      delete (stream as any)[_ESCAPE_DECODER];
    }
  }

  (stream as any).on('data', onData);
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
