export const isMainThread = true;
export const parentPort = null;
export const workerData = null;
export const threadId = 0;

export class Worker {
  constructor(_filename: string, _options?: any) {
    throw new Error('worker_threads is not supported in GJS');
  }
}

export class MessageChannel {
  port1: any = null;
  port2: any = null;
}

export class MessagePort {
  postMessage(_value: any): void {}

  on(_event: string, _listener: Function): this {
    return this;
  }

  close(): void {}
}

export class BroadcastChannel {
  constructor(_name: string) {}

  postMessage(_message: any): void {}

  close(): void {}
}

export function markAsUntransferable(_object: any): void {}

export function moveMessagePortToContext(_port: MessagePort, _context: any): MessagePort {
  return _port;
}

export function receiveMessageOnPort(_port: MessagePort): any {
  return undefined;
}

export function getEnvironmentData(_key: string): any {
  return undefined;
}

export function setEnvironmentData(_key: string, _value: any): void {}

export const resourceLimits = {};

export const SHARE_ENV = Symbol('worker_threads.SHARE_ENV');

export default {
  isMainThread,
  parentPort,
  workerData,
  threadId,
  Worker,
  MessageChannel,
  MessagePort,
  BroadcastChannel,
  markAsUntransferable,
  moveMessagePortToContext,
  receiveMessageOnPort,
  getEnvironmentData,
  setEnvironmentData,
  resourceLimits,
  SHARE_ENV,
};
