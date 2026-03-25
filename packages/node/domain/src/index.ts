// Reference: Node.js lib/domain.js — stub for GJS (deprecated)

import { EventEmitter } from 'events';

export class Domain extends EventEmitter {
  members: any[] = [];

  add(_emitter: EventEmitter): void {
    this.members.push(_emitter);
  }

  remove(_emitter: EventEmitter): void {
    this.members = this.members.filter((m) => m !== _emitter);
  }

  run<T>(fn: () => T): T {
    return fn();
  }

  bind<T extends Function>(fn: T): T {
    return fn;
  }

  intercept<T extends Function>(fn: T): T {
    return fn;
  }

  enter(): void {}

  exit(): void {}

  dispose(): void {
    this.emit('dispose');
  }
}

export function create(): Domain {
  return new Domain();
}

export default { Domain, create };
