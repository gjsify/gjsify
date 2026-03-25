// readline/promises — Promise-based readline API
// Reference: Node.js lib/readline/promises.js

import { Interface as BaseInterface, createInterface as baseCreateInterface } from './index.js';
import type { InterfaceOptions } from './index.js';
import type { Readable, Writable } from 'node:stream';

/**
 * Promise-based readline Interface.
 */
export class Interface extends BaseInterface {
  /** Ask a question and return the answer as a Promise. */
  question(query: string, options?: any): Promise<string> {
    return new Promise<string>((resolve) => {
      super.question(query, resolve);
    });
  }
}

/**
 * Create a promise-based readline Interface.
 */
export function createInterface(input?: Readable | InterfaceOptions, output?: Writable): Interface {
  if (typeof input === 'object' && input !== null && !('read' in input && typeof (input as any).read === 'function')) {
    const opts = input as InterfaceOptions;
    const rl = new Interface(opts);
    return rl;
  }
  return new Interface({ input: input as Readable, output });
}

export default {
  Interface,
  createInterface,
};
