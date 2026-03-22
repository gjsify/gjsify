import { EventEmitter } from 'events';

export class Interface extends EventEmitter {
  constructor(_input?: any, _output?: any) {
    super();
  }

  close(): void {
    this.emit('close');
  }

  pause(): this {
    this.emit('pause');
    return this;
  }

  resume(): this {
    this.emit('resume');
    return this;
  }

  question(query: string, callback: (answer: string) => void): void {
    callback('');
  }

  prompt(_preserveCursor?: boolean): void {}

  write(_data: string): void {}

  setPrompt(_prompt: string): void {}

  getPrompt(): string {
    return '> ';
  }
}

export function createInterface(options?: any): Interface {
  return new Interface(options?.input, options?.output);
}

export function clearLine(_stream: any, _dir: number, _callback?: () => void): boolean {
  return true;
}

export function clearScreenDown(_stream: any, _callback?: () => void): boolean {
  return true;
}

export function cursorTo(
  _stream: any,
  _x: number,
  _y?: number,
  _callback?: () => void,
): boolean {
  return true;
}

export function moveCursor(
  _stream: any,
  _dx: number,
  _dy: number,
  _callback?: () => void,
): boolean {
  return true;
}

export function emitKeypressEvents(_stream: any): void {}

export default {
  Interface,
  createInterface,
  clearLine,
  clearScreenDown,
  cursorTo,
  moveCursor,
  emitKeypressEvents,
};
