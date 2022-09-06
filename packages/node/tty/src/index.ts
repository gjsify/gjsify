/**
 * based on:
 * - https://github.com/jvilk/bfs-process/blob/master/ts/tty.ts
 * - https://github.com/geut/brode/blob/main/packages/browser-node-core/src/tty.js
 */
// import '@gjsify/globals';
import { Writable, Readable } from 'stream';
import { warnNotImplemented } from '@gjsify/utils';
export class ReadStream extends Readable {
  isRaw = false;

  get isTTY() {
    return true
  }

  setRawMode(mode: boolean) {
    if (this.isRaw !== mode) {
      this.isRaw = mode
      this.emit('modeChange')
    }
  }
}

export class WriteStream extends Writable {

  isRaw = false;
  columns = 80;
  rows = 120;

  // TODO stdout / stderr
  protected _print = console.log;

  // TODO fd
  constructor(fd: number) {
    super();
  }

  get isTTY() {
    return true
  }

  clearLine(dir: number, callback?: () => void): boolean {
    warnNotImplemented("WriteStream.clearLine");
    if (callback) callback();
    return true;
  }


  clearScreenDown(callback?: () => void): boolean {
    warnNotImplemented("WriteStream.clearScreenDown");
    if (callback) callback();
    return true;
  }

  cursorTo(x: number, y: number, callback?: () => void): boolean {
    warnNotImplemented("WriteStream.cursorTo");
    if (callback) callback();
    return true;
  }

  getColorDepth(env: Record<string, string>) {
    warnNotImplemented("WriteStream.getColorDepth");
    return 8;
  }

  getWindowSize() {
    warnNotImplemented("WriteStream.getWindowSize");
    return [this.columns, this.rows]
  }

  hasColors(count = 16, env?: Record<string, string>) {
    switch (this.getColorDepth(env)) {
      case 1:
        return count >= 2
      case 4:
        return count >= 16
      case 8:
        return count >= 256
      case 24:
        return count >= 16777216
      default:
        return false
    }
  }

  setRawMode(mode: boolean) {
    if (this.isRaw !== mode) {
      this.isRaw = mode
      this.emit('modeChange')
    }
  }

  override _write (chunk, enc: string, cb: Function) {
    // TODO stderr / stdout
    this._print(enc === 'buffer' ? chunk.toString('utf-8') : chunk)
    cb(null)
  }

  _changeColumns(columns: number) {
    if (columns !== this.columns) {
      this.columns = columns
      this.emit('resize')
    }
  }

  _changeRows(rows: number) {
    if (rows !== this.rows) {
      this.rows = rows
      this.emit('resize')
    }
  }
}

export const isatty = (fd: ReadStream | WriteStream) => {
  return fd && (fd instanceof ReadStream || fd instanceof WriteStream)
}

export default {
  isatty,
  WriteStream,
  ReadStream
}