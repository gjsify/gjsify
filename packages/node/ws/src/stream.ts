// Reference: refs/ws/lib/stream.js
// Copyright (c) 2011 Einar Otto Stangvik <einaros@gmail.com>. MIT.
// Adapted for @gjsify/ws — WebSocket → Node.js Duplex bridge without _socket dependency.

import { Duplex } from 'node:stream';

function emitClose(stream: Duplex): void {
  stream.emit('close');
}

function duplexOnEnd(this: Duplex): void {
  if (!this.destroyed && (this as any)._writableState.finished) {
    this.destroy();
  }
}

function duplexOnError(this: Duplex, err: Error): void {
  this.removeListener('error', duplexOnError);
  this.destroy();
  if (this.listenerCount('error') === 0) {
    this.emit('error', err);
  }
}

export function createWebSocketStream(ws: any, options: Record<string, unknown> = {}): Duplex {
  let terminateOnDestroy = true;

  const duplex = new Duplex({
    ...options,
    autoDestroy: false,
    emitClose: false,
    objectMode: false,
    writableObjectMode: false,
  });

  ws.on('message', (msg: Buffer | string, isBinary: boolean) => {
    let data: Buffer | string;
    if (isBinary || duplex.readableObjectMode) {
      data = msg;
    } else {
      data = typeof msg === 'string' ? Buffer.from(msg) : msg;
    }
    if (!duplex.push(data) && typeof ws.pause === 'function') ws.pause();
  });

  ws.once('error', (err: Error) => {
    if (duplex.destroyed) return;
    terminateOnDestroy = false;
    duplex.destroy(err);
  });

  ws.once('close', () => {
    if (duplex.destroyed) return;
    duplex.push(null);
  });

  (duplex as any)._destroy = function (err: Error | null, callback: (err: Error | null) => void): void {
    if (ws.readyState === ws.CLOSED) {
      callback(err);
      process.nextTick(emitClose, duplex);
      return;
    }

    let called = false;

    ws.once('error', (e: Error) => {
      called = true;
      callback(e);
    });

    ws.once('close', () => {
      if (!called) callback(err);
      process.nextTick(emitClose, duplex);
    });

    if (terminateOnDestroy) ws.terminate();
  };

  (duplex as any)._final = function (callback: () => void): void {
    if (ws.readyState === ws.CONNECTING) {
      ws.once('open', () => (duplex as any)._final(callback));
      return;
    }
    if (ws.readyState === ws.CLOSED || ws.readyState === ws.CLOSING) {
      callback();
      return;
    }
    ws.once('close', callback);
    ws.close();
  };

  duplex._read = function (): void {
    if (typeof ws.resume === 'function') ws.resume();
  };

  duplex._write = function (chunk: Buffer | string, _encoding: BufferEncoding, callback: (err?: Error) => void): void {
    if (ws.readyState === ws.CONNECTING) {
      ws.once('open', () => duplex._write(chunk, _encoding, callback));
      return;
    }
    ws.send(chunk, callback);
  };

  duplex.on('end', duplexOnEnd);
  duplex.on('error', duplexOnError);
  return duplex;
}
