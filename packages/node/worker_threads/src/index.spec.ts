// Ported from refs/node-test/parallel/test-worker-message-*.js
// Ported from refs/bun/test/js/node/worker_threads/worker_threads.test.ts
// Original: MIT license, Node.js contributors / Oven (oven-sh)

import { describe, it, expect } from '@gjsify/unit';
import {
  isMainThread,
  parentPort,
  workerData,
  threadId,
  resourceLimits,
  SHARE_ENV,
  Worker,
  MessageChannel,
  MessagePort,
  BroadcastChannel,
  receiveMessageOnPort,
  getEnvironmentData,
  setEnvironmentData,
  markAsUntransferable,
  moveMessagePortToContext,
} from 'node:worker_threads';

export default async () => {
  // --- Module exports ---

  await describe('worker_threads exports', async () => {
    await it('should export isMainThread as true', async () => {
      expect(isMainThread).toBe(true);
    });

    await it('should export parentPort as null', async () => {
      expect(parentPort).toBeNull();
    });

    await it('should export workerData as null or undefined', async () => {
      // Node.js returns undefined, our impl returns null — both are falsy
      expect(workerData == null).toBe(true);
    });

    await it('should export threadId as 0', async () => {
      expect(threadId).toBe(0);
    });

    await it('should export SHARE_ENV as a symbol', async () => {
      expect(typeof SHARE_ENV).toBe('symbol');
    });

    await it('should export resourceLimits as an object', async () => {
      expect(typeof resourceLimits).toBe('object');
    });

    await it('should export all expected classes and functions', async () => {
      expect(typeof Worker).toBe('function');
      expect(typeof MessageChannel).toBe('function');
      expect(typeof MessagePort).toBe('function');
      expect(typeof BroadcastChannel).toBe('function');
      expect(typeof receiveMessageOnPort).toBe('function');
      expect(typeof getEnvironmentData).toBe('function');
      expect(typeof setEnvironmentData).toBe('function');
      expect(typeof markAsUntransferable).toBe('function');
      expect(typeof moveMessagePortToContext).toBe('function');
    });
  });

  // --- MessageChannel ---

  await describe('MessageChannel', async () => {
    await it('should create port1 and port2 as MessagePort instances', async () => {
      const channel = new MessageChannel();
      expect(channel.port1).toBeDefined();
      expect(channel.port2).toBeDefined();
      expect(channel.port1 instanceof MessagePort).toBe(true);
      expect(channel.port2 instanceof MessagePort).toBe(true);
    });

    await it('should deliver string messages from port1 to port2', async () => {
      const channel = new MessageChannel();
      const received = await new Promise<unknown>((resolve) => {
        channel.port2.on('message', resolve);
        channel.port1.postMessage('hello');
      });
      expect(received).toBe('hello');
      channel.port1.close();
      channel.port2.close();
    });

    await it('should deliver messages from port2 to port1', async () => {
      const channel = new MessageChannel();
      const received = await new Promise<unknown>((resolve) => {
        channel.port1.on('message', resolve);
        channel.port2.postMessage('world');
      });
      expect(received).toBe('world');
      channel.port1.close();
      channel.port2.close();
    });

    await it('should clone object messages (not pass by reference)', async () => {
      const channel = new MessageChannel();
      const original = { key: 'value', nested: { a: 1 } };
      const received = await new Promise<unknown>((resolve) => {
        channel.port2.on('message', resolve);
        channel.port1.postMessage(original);
      });
      expect(JSON.stringify(received)).toBe(JSON.stringify(original));
      // Verify it's a clone, not the same reference
      expect(received !== original).toBe(true);
      channel.port1.close();
      channel.port2.close();
    });

    await it('should deliver multiple messages in order', async () => {
      const channel = new MessageChannel();
      const messages: unknown[] = [];
      const done = new Promise<void>((resolve) => {
        channel.port2.on('message', (msg) => {
          messages.push(msg);
          if (messages.length === 3) resolve();
        });
      });
      channel.port1.postMessage(1);
      channel.port1.postMessage(2);
      channel.port1.postMessage(3);
      await done;
      expect(messages.length).toBe(3);
      expect(messages[0]).toBe(1);
      expect(messages[1]).toBe(2);
      expect(messages[2]).toBe(3);
      channel.port1.close();
      channel.port2.close();
    });

    await it('should handle various data types', async () => {
      const channel = new MessageChannel();
      const values = [42, true, null, [1, 2, 3], { a: 'b' }];
      const received: unknown[] = [];
      const done = new Promise<void>((resolve) => {
        channel.port2.on('message', (msg) => {
          received.push(msg);
          if (received.length === values.length) resolve();
        });
      });
      for (const val of values) {
        channel.port1.postMessage(val);
      }
      await done;
      expect(received.length).toBe(values.length);
      expect(received[0]).toBe(42);
      expect(received[1]).toBe(true);
      expect(received[2]).toBeNull();
      expect(JSON.stringify(received[3])).toBe(JSON.stringify([1, 2, 3]));
      expect(JSON.stringify(received[4])).toBe(JSON.stringify({ a: 'b' }));
      channel.port1.close();
      channel.port2.close();
    });

    await it('should silently ignore messages after port is closed', async () => {
      const channel = new MessageChannel();
      let messageReceived = false;
      channel.port2.on('message', () => { messageReceived = true; });
      channel.port2.close();
      channel.port1.postMessage('should not arrive');
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(messageReceived).toBe(false);
    });
  });

  // --- MessagePort ---

  await describe('MessagePort', async () => {
    await it('should auto-start when on("message") is called', async () => {
      const channel = new MessageChannel();
      // Post before adding listener — message gets queued
      channel.port1.postMessage('queued');
      // Adding listener should auto-start and deliver queued message
      const received = await new Promise<unknown>((resolve) => {
        channel.port2.on('message', resolve);
      });
      expect(received).toBe('queued');
      channel.port1.close();
      channel.port2.close();
    });

    await it('should emit close event when closed', async () => {
      const channel = new MessageChannel();
      const closed = new Promise<void>((resolve) => {
        channel.port1.on('close', resolve);
      });
      channel.port1.close();
      await closed;
    });

    await it('ref() and unref() should not throw', async () => {
      const channel = new MessageChannel();
      const port = channel.port1;
      // Native Node.js ref/unref return undefined; our impl returns this
      // Just verify they don't throw
      port.ref();
      port.unref();
      channel.port1.close();
      channel.port2.close();
    });

    await it('should support once() for single message', async () => {
      const channel = new MessageChannel();
      const first = await new Promise<unknown>((resolve) => {
        channel.port2.once('message', resolve);
        channel.port1.postMessage('only-once');
      });
      expect(first).toBe('only-once');
      channel.port1.close();
      channel.port2.close();
    });
  });

  // --- receiveMessageOnPort ---

  await describe('receiveMessageOnPort', async () => {
    await it('should return undefined when no messages queued', async () => {
      const channel = new MessageChannel();
      const result = receiveMessageOnPort(channel.port2);
      expect(result).toBeUndefined();
      channel.port1.close();
      channel.port2.close();
    });

    await it('should return queued message synchronously', async () => {
      const channel = new MessageChannel();
      // Post a message — it gets queued because port2 hasn't started
      channel.port1.postMessage('sync-msg');
      const result = receiveMessageOnPort(channel.port2);
      expect(result).toBeDefined();
      expect((result as { message: unknown }).message).toBe('sync-msg');
      channel.port1.close();
      channel.port2.close();
    });

    await it('should dequeue messages one at a time in order', async () => {
      const channel = new MessageChannel();
      channel.port1.postMessage('first');
      channel.port1.postMessage('second');
      channel.port1.postMessage('third');

      const r1 = receiveMessageOnPort(channel.port2);
      expect((r1 as { message: unknown }).message).toBe('first');

      const r2 = receiveMessageOnPort(channel.port2);
      expect((r2 as { message: unknown }).message).toBe('second');

      const r3 = receiveMessageOnPort(channel.port2);
      expect((r3 as { message: unknown }).message).toBe('third');

      const r4 = receiveMessageOnPort(channel.port2);
      expect(r4).toBeUndefined();

      channel.port1.close();
      channel.port2.close();
    });
  });

  // --- BroadcastChannel ---

  await describe('BroadcastChannel', async () => {
    await it('should create a channel with a name', async () => {
      const bc = new BroadcastChannel('test-name');
      expect(bc.name).toBe('test-name');
      bc.close();
    });

    await it('should coerce name to string', async () => {
      const bc = new BroadcastChannel(42 as unknown as string);
      expect(bc.name).toBe('42');
      bc.close();
    });

    await it('should deliver messages to other channels with same name', async () => {
      const bc1 = new BroadcastChannel('bc-deliver');
      const bc2 = new BroadcastChannel('bc-deliver');

      const received = await new Promise<unknown>((resolve) => {
        bc2.onmessage = (event) => resolve(event.data);
        bc1.postMessage('broadcast-hello');
      });

      expect(received).toBe('broadcast-hello');
      bc1.close();
      bc2.close();
    });

    await it('should not deliver messages to self', async () => {
      const bc = new BroadcastChannel('bc-self');
      let received = false;
      bc.onmessage = () => { received = true; };
      bc.postMessage('self');
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(received).toBe(false);
      bc.close();
    });

    await it('should not deliver to channels with different name', async () => {
      const bc1 = new BroadcastChannel('bc-name-a');
      const bc2 = new BroadcastChannel('bc-name-b');
      let received = false;
      bc2.onmessage = () => { received = true; };
      bc1.postMessage('wrong-channel');
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(received).toBe(false);
      bc1.close();
      bc2.close();
    });

    await it('should throw when posting to a closed channel', async () => {
      const bc = new BroadcastChannel('bc-closed');
      bc.close();
      let threw = false;
      try {
        bc.postMessage('should-fail');
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    await it('should not deliver to closed receivers', async () => {
      const bc1 = new BroadcastChannel('bc-closed-recv');
      const bc2 = new BroadcastChannel('bc-closed-recv');
      let received = false;
      bc2.onmessage = () => { received = true; };
      bc2.close();
      bc1.postMessage('after-close');
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(received).toBe(false);
      bc1.close();
    });

    await it('should deliver to multiple receivers', async () => {
      const bc1 = new BroadcastChannel('bc-multi');
      const bc2 = new BroadcastChannel('bc-multi');
      const bc3 = new BroadcastChannel('bc-multi');

      let count = 0;
      const done = new Promise<void>((resolve) => {
        const handler = () => { count++; if (count === 2) resolve(); };
        bc2.onmessage = handler;
        bc3.onmessage = handler;
      });

      bc1.postMessage('to-all');
      await done;
      expect(count).toBe(2);

      bc1.close();
      bc2.close();
      bc3.close();
    });
  });

  // --- Environment Data ---

  await describe('environmentData', async () => {
    await it('should store and retrieve data', async () => {
      setEnvironmentData('testKey', 'testValue');
      expect(getEnvironmentData('testKey')).toBe('testValue');
    });

    await it('should return undefined for missing keys', async () => {
      expect(getEnvironmentData('nonexistent-key-12345')).toBeUndefined();
    });

    await it('should delete data when value is undefined', async () => {
      setEnvironmentData('toDelete', 'value');
      expect(getEnvironmentData('toDelete')).toBe('value');
      setEnvironmentData('toDelete', undefined);
      expect(getEnvironmentData('toDelete')).toBeUndefined();
    });
  });

  // --- Utility functions ---

  await describe('utility functions', async () => {
    await it('markAsUntransferable should not throw', async () => {
      markAsUntransferable({});
      markAsUntransferable(new ArrayBuffer(8));
    });

    await it('moveMessagePortToContext should be a function', async () => {
      // Native Node.js requires a vm.Context — just verify it's exported
      expect(typeof moveMessagePortToContext).toBe('function');
    });
  });

  // --- Structured clone (deep clone) ---

  await describe('MessageChannel structured clone', async () => {
    await it('should clone Date objects', async () => {
      const channel = new MessageChannel();
      const date = new Date('2026-01-15T12:00:00Z');
      const received = await new Promise<unknown>((resolve) => {
        channel.port2.on('message', resolve);
        channel.port1.postMessage(date);
      });
      expect(received instanceof Date).toBe(true);
      expect((received as Date).getTime()).toBe(date.getTime());
      channel.port1.close();
    });

    await it('should clone RegExp objects', async () => {
      const channel = new MessageChannel();
      const regex = /hello\d+/gi;
      const received = await new Promise<unknown>((resolve) => {
        channel.port2.on('message', resolve);
        channel.port1.postMessage(regex);
      });
      expect(received instanceof RegExp).toBe(true);
      expect((received as RegExp).source).toBe('hello\\d+');
      expect((received as RegExp).flags).toBe('gi');
      channel.port1.close();
    });

    await it('should clone Map objects', async () => {
      const channel = new MessageChannel();
      const map = new Map([['key1', 'value1'], ['key2', 'value2']]);
      const received = await new Promise<unknown>((resolve) => {
        channel.port2.on('message', resolve);
        channel.port1.postMessage(map);
      });
      expect(received instanceof Map).toBe(true);
      expect((received as Map<string, string>).get('key1')).toBe('value1');
      expect((received as Map<string, string>).get('key2')).toBe('value2');
      expect((received as Map<string, string>).size).toBe(2);
      channel.port1.close();
    });

    await it('should clone Set objects', async () => {
      const channel = new MessageChannel();
      const set = new Set([1, 2, 3]);
      const received = await new Promise<unknown>((resolve) => {
        channel.port2.on('message', resolve);
        channel.port1.postMessage(set);
      });
      expect(received instanceof Set).toBe(true);
      expect((received as Set<number>).has(1)).toBe(true);
      expect((received as Set<number>).has(2)).toBe(true);
      expect((received as Set<number>).has(3)).toBe(true);
      expect((received as Set<number>).size).toBe(3);
      channel.port1.close();
    });

    await it('should clone Error objects', async () => {
      const channel = new MessageChannel();
      const error = new Error('test error');
      error.name = 'CustomError';
      const received = await new Promise<unknown>((resolve) => {
        channel.port2.on('message', resolve);
        channel.port1.postMessage(error);
      });
      expect(received instanceof Error).toBe(true);
      expect((received as Error).message).toBe('test error');
      channel.port1.close();
    });

    await it('should clone Uint8Array', async () => {
      const channel = new MessageChannel();
      const arr = new Uint8Array([1, 2, 3, 4, 5]);
      const received = await new Promise<unknown>((resolve) => {
        channel.port2.on('message', resolve);
        channel.port1.postMessage(arr);
      });
      expect(received instanceof Uint8Array).toBe(true);
      expect((received as Uint8Array).length).toBe(5);
      expect((received as Uint8Array)[0]).toBe(1);
      expect((received as Uint8Array)[4]).toBe(5);
      channel.port1.close();
    });

    await it('should clone nested objects with complex types', async () => {
      const channel = new MessageChannel();
      const obj = {
        date: new Date('2026-03-25'),
        items: [1, 'two', { three: 3 }],
        nested: { deep: true },
      };
      const received = await new Promise<unknown>((resolve) => {
        channel.port2.on('message', resolve);
        channel.port1.postMessage(obj);
      });
      const r = received as any;
      expect(r.date instanceof Date).toBe(true);
      expect(r.items.length).toBe(3);
      expect(r.items[0]).toBe(1);
      expect(r.items[1]).toBe('two');
      expect(r.items[2].three).toBe(3);
      expect(r.nested.deep).toBe(true);
      channel.port1.close();
    });
  });
};
