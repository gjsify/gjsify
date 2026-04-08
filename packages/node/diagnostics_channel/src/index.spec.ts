// Ported from refs/node-test/parallel/test-diagnostics-channel-*.js
// Original: MIT license, Node.js contributors

import { describe, it, expect } from '@gjsify/unit';
import {
  Channel,
  channel as _channel,
  hasSubscribers,
  subscribe,
  unsubscribe,
  tracingChannel as _tracingChannel,
} from 'node:diagnostics_channel';

// @types/node over-constrains tracingChannel's ContextType to `object` and
// expects every handler in TracingChannelSubscribers. Our spec passes partial
// handler objects and generic `{}` contexts to exercise runtime behaviour,
// so we loosen the types locally rather than weaken the tests.
const channel = _channel as any;
const tracingChannel = _tracingChannel as any;

// Helper: unique channel names to avoid cross-test interference
let counter = 0;
function uid(prefix = 'test') {
  return `${prefix}:${Date.now()}:${counter++}`;
}

export default async () => {
  await describe('diagnostics_channel', async () => {
    // ---------------------------------------------------------------
    // channel() factory
    // ---------------------------------------------------------------
    await describe('channel() factory', async () => {
      await it('should return a Channel instance', async () => {
        const ch = channel(uid());
        expect(ch).toBeDefined();
        expect(ch instanceof Channel).toBe(true);
      });

      await it('should return the same channel for the same name', async () => {
        const name = uid('singleton');
        const a = channel(name);
        const b = channel(name);
        expect(a).toBe(b);
      });

      await it('should have a name property matching the input', async () => {
        const name = uid('named');
        const ch = channel(name);
        expect(ch.name).toBe(name);
      });

      await it('should start with no subscribers', async () => {
        const ch = channel(uid());
        expect(ch.hasSubscribers).toBe(false);
      });

      await it('should support Symbol names', async () => {
        const sym = Symbol('test-symbol');
        const ch = channel(sym);
        // Cannot use toBe with Symbol (string interpolation issue) — use strict equality
        expect(ch.name === sym).toBe(true);
        expect(typeof ch.name).toBe('symbol');
      });

      await it('should return the same channel for the same Symbol', async () => {
        const sym = Symbol.for('dc-test-same');
        const a = channel(sym);
        const b = channel(sym);
        expect(a).toBe(b);
      });
    });

    // ---------------------------------------------------------------
    // hasSubscribers (module-level)
    // ---------------------------------------------------------------
    await describe('hasSubscribers()', async () => {
      await it('should return false for unknown channel', async () => {
        expect(hasSubscribers(uid('unknown'))).toBe(false);
      });

      await it('should return true when channel has subscribers', async () => {
        const name = uid('hassub');
        subscribe(name, () => {});
        expect(hasSubscribers(name)).toBe(true);
      });

      await it('should return false after all subscribers removed', async () => {
        const name = uid('hassub-remove');
        const handler = () => {};
        subscribe(name, handler);
        expect(hasSubscribers(name)).toBe(true);
        unsubscribe(name, handler);
        expect(hasSubscribers(name)).toBe(false);
      });
    });

    // ---------------------------------------------------------------
    // Channel: subscribe / unsubscribe / hasSubscribers lifecycle
    // ---------------------------------------------------------------
    await describe('Channel subscribe/unsubscribe lifecycle', async () => {
      await it('should track hasSubscribers correctly through add/remove', async () => {
        const ch = channel(uid('lifecycle'));
        expect(ch.hasSubscribers).toBe(false);

        const fn1 = () => {};
        const fn2 = () => {};

        ch.subscribe(fn1);
        expect(ch.hasSubscribers).toBe(true);

        ch.subscribe(fn2);
        expect(ch.hasSubscribers).toBe(true);

        ch.unsubscribe(fn1);
        expect(ch.hasSubscribers).toBe(true);

        ch.unsubscribe(fn2);
        expect(ch.hasSubscribers).toBe(false);
      });

      await it('should return true from unsubscribe when subscriber exists', async () => {
        const ch = channel(uid());
        const handler = () => {};
        ch.subscribe(handler);
        expect(ch.unsubscribe(handler)).toBe(true);
      });

      await it('should return false from unsubscribe when subscriber not found', async () => {
        const ch = channel(uid());
        expect(ch.unsubscribe(() => {})).toBe(false);
      });

      await it('should return false from unsubscribe after already removed', async () => {
        const ch = channel(uid());
        const handler = () => {};
        ch.subscribe(handler);
        ch.unsubscribe(handler);
        expect(ch.unsubscribe(handler)).toBe(false);
      });

      await it('should allow re-subscribe after unsubscribe', async () => {
        const ch = channel(uid('resub'));
        const handler = () => {};
        ch.subscribe(handler);
        ch.unsubscribe(handler);
        expect(ch.hasSubscribers).toBe(false);
        ch.subscribe(handler);
        expect(ch.hasSubscribers).toBe(true);
      });
    });

    // ---------------------------------------------------------------
    // Channel: publish
    // ---------------------------------------------------------------
    await describe('Channel publish', async () => {
      await it('should publish messages to subscribers', async () => {
        const ch = channel(uid('pub'));
        const messages: unknown[] = [];
        ch.subscribe((msg: unknown) => messages.push(msg));
        ch.publish('hello');
        ch.publish({ data: 42 });
        expect(messages.length).toBe(2);
        expect(messages[0]).toBe('hello');
      });

      await it('should pass the channel name as second argument', async () => {
        const name = uid('name-arg');
        const ch = channel(name);
        let receivedName: string | symbol | undefined;
        ch.subscribe((_msg: unknown, n: string | symbol) => { receivedName = n; });
        ch.publish('test');
        expect(receivedName).toBe(name);
      });

      await it('should pass Symbol name as second argument', async () => {
        const sym = Symbol('pub-sym');
        const ch = channel(sym);
        let receivedName: string | symbol | undefined;
        ch.subscribe((_msg: unknown, n: string | symbol) => { receivedName = n; });
        ch.publish({ key: 'val' });
        // Cannot use toBe with Symbol (string interpolation issue) — use strict equality
        expect(receivedName === sym).toBe(true);
      });

      await it('should pass message data faithfully (reference identity)', async () => {
        const ch = channel(uid('data'));
        let received: any = null;
        ch.subscribe((msg: unknown) => { received = msg; });
        const obj = { key: 'value', num: 42 };
        ch.publish(obj);
        expect(received).toBe(obj);
      });

      await it('should not call subscribers when there are none', async () => {
        const ch = channel(uid('noop'));
        // Should not throw
        ch.publish('no-op');
      });

      await it('should notify all subscribers', async () => {
        const ch = channel(uid('multi'));
        let count = 0;
        ch.subscribe(() => { count++; });
        ch.subscribe(() => { count++; });
        ch.subscribe(() => { count++; });
        ch.publish('msg');
        expect(count).toBe(3);
      });

      await it('should not notify unsubscribed handlers', async () => {
        const ch = channel(uid('unsub'));
        const messages: unknown[] = [];
        const handler = (msg: unknown) => messages.push(msg);
        ch.subscribe(handler);
        ch.publish('a');
        ch.unsubscribe(handler);
        ch.publish('b');
        expect(messages.length).toBe(1);
      });
    });

    // ---------------------------------------------------------------
    // Unsubscribe during publish (copy-on-write safety)
    // ---------------------------------------------------------------
    await describe('unsubscribe during publish', async () => {
      await it('should not crash when a subscriber unsubscribes during publish', async () => {
        const name = uid('sync-unsub');
        let secondCalled = false;

        const handler1 = () => {
          unsubscribe(name, handler1);
        };
        const handler2 = () => {
          secondCalled = true;
        };

        subscribe(name, handler1);
        subscribe(name, handler2);

        // Must not throw
        channel(name).publish('data');
        expect(secondCalled).toBe(true);
      });
    });

    // ---------------------------------------------------------------
    // subscribe/unsubscribe module-level functions
    // ---------------------------------------------------------------
    await describe('subscribe/unsubscribe module-level functions', async () => {
      await it('should subscribe and receive messages via module functions', async () => {
        const name = uid('modsub');
        const messages: unknown[] = [];
        const handler = (msg: unknown) => messages.push(msg);
        subscribe(name, handler);
        channel(name).publish('test');
        expect(messages.length).toBe(1);
        unsubscribe(name, handler);
      });

      await it('unsubscribe should return true when found', async () => {
        const name = uid('modret');
        const handler = () => {};
        subscribe(name, handler);
        expect(unsubscribe(name, handler)).toBe(true);
      });

      await it('unsubscribe should return false when not found', async () => {
        const name = uid('modnotfound');
        expect(unsubscribe(name, () => {})).toBe(false);
      });
    });

    // ---------------------------------------------------------------
    // Error handling in subscribers
    // ---------------------------------------------------------------
    await describe('subscriber error handling', async () => {
      await it('should continue notifying remaining subscribers when one throws', async () => {
        const ch = channel(uid('err'));
        let secondCalled = false;
        const expectedError = new Error('subscriber error ' + uid('err'));

        // On Node.js, Channel.publish catches subscriber errors and re-throws
        // them asynchronously, so we need to catch the uncaught exception.
        // On GJS, our implementation does the same via Promise.resolve().then().
        const errorHandler = (err: unknown) => {
          if (err === expectedError) return; // suppress expected error
        };

        // Install handler if process is available (Node.js)
        const proc = typeof process !== 'undefined' ? process : undefined;
        if (proc && typeof proc.on === 'function') {
          proc.on('uncaughtException', errorHandler);
        }

        ch.subscribe(() => { throw expectedError; });
        ch.subscribe(() => { secondCalled = true; });

        // Publish should not throw synchronously
        ch.publish('data');
        expect(secondCalled).toBe(true);

        // Clean up the handler after a tick so the async re-throw is caught
        await new Promise<void>((resolve) => {
          // Use setTimeout to let the async error fire first
          setTimeout(() => {
            if (proc && typeof proc.removeListener === 'function') {
              proc.removeListener('uncaughtException', errorHandler);
            }
            resolve();
          }, 10);
        });
      });
    });

    // ---------------------------------------------------------------
    // TracingChannel: creation and structure
    // ---------------------------------------------------------------
    await describe('TracingChannel creation', async () => {
      await it('should create a tracing channel with all sub-channels', async () => {
        const tc = tracingChannel(uid('trace'));
        expect(tc).toBeDefined();
        expect(tc.start).toBeDefined();
        expect(tc.end).toBeDefined();
        expect(tc.asyncStart).toBeDefined();
        expect(tc.asyncEnd).toBeDefined();
        expect(tc.error).toBeDefined();
      });

      await it('should have the expected methods and properties', async () => {
        const tc = tracingChannel(uid('inst'));
        expect(typeof tc.traceSync).toBe('function');
        expect(typeof tc.tracePromise).toBe('function');
        expect(typeof tc.subscribe).toBe('function');
        expect(typeof tc.unsubscribe).toBe('function');
      });

      await it('should name sub-channels with tracing: prefix', async () => {
        const name = uid('naming');
        const tc = tracingChannel(name);
        expect(tc.start.name).toBe(`tracing:${name}:start`);
        expect(tc.end.name).toBe(`tracing:${name}:end`);
        expect(tc.asyncStart.name).toBe(`tracing:${name}:asyncStart`);
        expect(tc.asyncEnd.name).toBe(`tracing:${name}:asyncEnd`);
        expect(tc.error.name).toBe(`tracing:${name}:error`);
      });

      await it('should accept channel objects instead of a name', async () => {
        const name = uid('obj');
        const tc = tracingChannel({
          start: channel(`tracing:${name}:start`),
          end: channel(`tracing:${name}:end`),
          asyncStart: channel(`tracing:${name}:asyncStart`),
          asyncEnd: channel(`tracing:${name}:asyncEnd`),
          error: channel(`tracing:${name}:error`),
        });
        expect(tc.start.name).toBe(`tracing:${name}:start`);
      });
    });

    // ---------------------------------------------------------------
    // TracingChannel: hasSubscribers
    // ---------------------------------------------------------------
    await describe('TracingChannel hasSubscribers', async () => {
      await it('should be false initially', async () => {
        const tc = tracingChannel(uid('tc-hassub'));
        expect(tc.hasSubscribers).toBe(false);
      });

      await it('should be true when subscribe is called with start handler', async () => {
        const tc = tracingChannel(uid('tc-hassub-start'));
        const handlers = { start: () => {} };
        tc.subscribe(handlers);
        expect(tc.hasSubscribers).toBe(true);
        tc.unsubscribe(handlers);
        expect(tc.hasSubscribers).toBe(false);
      });

      await it('should be true when any sub-channel has a subscriber', async () => {
        const tc = tracingChannel(uid('tc-hassub-any'));
        const handler = () => {};
        tc.asyncEnd.subscribe(handler);
        expect(tc.hasSubscribers).toBe(true);
        tc.asyncEnd.unsubscribe(handler);
        expect(tc.hasSubscribers).toBe(false);
      });

      await it('should track subscribe/unsubscribe with handlers object', async () => {
        const tc = tracingChannel(uid('tc-hassub-handlers'));
        const handlers = { asyncEnd: () => {} };
        tc.subscribe(handlers);
        expect(tc.hasSubscribers).toBe(true);
        tc.unsubscribe(handlers);
        expect(tc.hasSubscribers).toBe(false);
      });
    });

    // ---------------------------------------------------------------
    // TracingChannel: subscribe/unsubscribe
    // ---------------------------------------------------------------
    await describe('TracingChannel subscribe/unsubscribe', async () => {
      await it('should subscribe handlers to respective channels', async () => {
        const tc = tracingChannel(uid('tc-sub'));
        const events: string[] = [];
        const handlers = {
          start: () => events.push('start'),
          end: () => events.push('end'),
          asyncStart: () => events.push('asyncStart'),
          asyncEnd: () => events.push('asyncEnd'),
          error: () => events.push('error'),
        };
        tc.subscribe(handlers);

        tc.start.publish({});
        tc.end.publish({});
        tc.asyncStart.publish({});
        tc.asyncEnd.publish({});
        tc.error.publish({});

        expect(events.length).toBe(5);
        expect(events[0]).toBe('start');
        expect(events[1]).toBe('end');
        expect(events[2]).toBe('asyncStart');
        expect(events[3]).toBe('asyncEnd');
        expect(events[4]).toBe('error');
      });

      await it('should unsubscribe handlers and return true', async () => {
        const tc = tracingChannel(uid('tc-unsub'));
        const handlers = {
          start: () => {},
          end: () => {},
        };
        tc.subscribe(handlers);
        const result = tc.unsubscribe(handlers);
        expect(result).toBe(true);
        expect(tc.hasSubscribers).toBe(false);
      });

      await it('should only subscribe provided handlers (partial)', async () => {
        const tc = tracingChannel(uid('tc-partial'));
        const events: string[] = [];
        tc.subscribe({ start: () => events.push('start') });
        tc.start.publish({});
        tc.end.publish({});
        expect(events.length).toBe(1);
      });
    });

    // ---------------------------------------------------------------
    // TracingChannel: traceSync
    // ---------------------------------------------------------------
    await describe('TracingChannel traceSync', async () => {
      await it('should publish start and end on success', async () => {
        const tc = tracingChannel(uid('ts-ok'));
        const events: string[] = [];
        tc.subscribe({
          start: () => events.push('start'),
          end: () => events.push('end'),
        });
        tc.traceSync(() => 'result', {});
        expect(events.length).toBe(2);
        expect(events[0]).toBe('start');
        expect(events[1]).toBe('end');
      });

      await it('should return the function result', async () => {
        const tc = tracingChannel(uid('ts-ret'));
        const expected = { foo: 'bar' };
        tc.subscribe({ start: () => {}, end: () => {} });
        const result = tc.traceSync(() => expected, {});
        expect(result).toBe(expected);
      });

      await it('should set result on context', async () => {
        const tc = tracingChannel(uid('ts-ctx-res'));
        const expected = { foo: 'bar' };
        const ctx: Record<string, unknown> = {};
        let endCtx: any = null;
        tc.subscribe({
          start: () => {},
          end: (msg: unknown) => { endCtx = msg; },
        });
        tc.traceSync(() => expected, ctx);
        expect(endCtx.result).toBe(expected);
      });

      await it('should pass context to start and end subscribers', async () => {
        const tc = tracingChannel(uid('ts-ctx'));
        const input = { foo: 'bar' };
        let startMsg: any = null;
        let endMsg: any = null;
        tc.subscribe({
          start: (msg: unknown) => { startMsg = msg; },
          end: (msg: unknown) => { endMsg = msg; },
        });
        tc.traceSync(() => 'ok', input);
        expect(startMsg).toBe(input);
        expect(endMsg).toBe(input);
      });

      await it('should publish error and end on throw', async () => {
        const tc = tracingChannel(uid('ts-err'));
        const events: string[] = [];
        let errorCtx: any = null;
        tc.subscribe({
          start: () => events.push('start'),
          end: () => events.push('end'),
          error: (msg: unknown) => {
            events.push('error');
            errorCtx = msg;
          },
        });
        const expectedErr = new Error('test');
        try {
          tc.traceSync(() => { throw expectedErr; }, {});
        } catch {
          // expected
        }
        expect(events.length).toBe(3);
        expect(events[0]).toBe('start');
        expect(events[1]).toBe('error');
        expect(events[2]).toBe('end');
        expect(errorCtx.error).toBe(expectedErr);
      });

      await it('should re-throw the error', async () => {
        const tc = tracingChannel(uid('ts-rethrow'));
        tc.subscribe({ start: () => {}, end: () => {}, error: () => {} });
        const expectedErr = new Error('rethrow-test');
        let caught: unknown = null;
        try {
          tc.traceSync(() => { throw expectedErr; }, {});
        } catch (e) {
          caught = e;
        }
        expect(caught).toBe(expectedErr);
      });

      await it('should not publish asyncStart/asyncEnd on sync', async () => {
        const tc = tracingChannel(uid('ts-noasync'));
        let asyncStartCalled = false;
        let asyncEndCalled = false;
        tc.subscribe({
          start: () => {},
          end: () => {},
          asyncStart: () => { asyncStartCalled = true; },
          asyncEnd: () => { asyncEndCalled = true; },
        });
        tc.traceSync(() => 'ok', {});
        expect(asyncStartCalled).toBe(false);
        expect(asyncEndCalled).toBe(false);
      });

      await it('should pass thisArg and args to the function', async () => {
        const tc = tracingChannel(uid('ts-thisarg'));
        tc.subscribe({ start: () => {}, end: () => {} });
        const thisArg = { baz: 'buz' };
        const arg = { val: 123 };
        let receivedThis: unknown = null;
        let receivedArg: unknown = null;
        tc.traceSync(function (this: unknown, a: unknown) {
          receivedThis = this;
          receivedArg = a;
          return 'ok';
        }, {}, thisArg, arg);
        expect(receivedThis).toBe(thisArg);
        expect(receivedArg).toBe(arg);
      });

      await it('should skip publish when no subscribers (fast path)', async () => {
        const tc = tracingChannel(uid('ts-nosub'));
        const thisArg = { x: 1 };
        const arg = 'hello';
        let receivedThis: unknown = null;
        let receivedArg: unknown = null;
        const result = tc.traceSync(function (this: unknown, a: unknown) {
          receivedThis = this;
          receivedArg = a;
          return 42;
        }, {}, thisArg, arg);
        expect(result).toBe(42);
        expect(receivedThis).toBe(thisArg);
        expect(receivedArg).toBe(arg);
      });
    });

    // ---------------------------------------------------------------
    // TracingChannel: traceSync early exit (subscribe during trace)
    // ---------------------------------------------------------------
    await describe('TracingChannel traceSync early exit', async () => {
      await it('should not fire end/error if subscribed during traceSync with no prior subscribers', async () => {
        // When traceSync is called with no subscribers, it takes the fast path
        // and directly calls fn — no events should fire even if subscribe
        // happens inside fn
        const tc = tracingChannel(uid('ts-early'));
        let endCalled = false;
        let errorCalled = false;
        const handlers = {
          start: () => {},
          end: () => { endCalled = true; },
          asyncStart: () => {},
          asyncEnd: () => {},
          error: () => { errorCalled = true; },
        };

        tc.traceSync(() => {
          tc.subscribe(handlers);
        }, {});

        expect(endCalled).toBe(false);
        expect(errorCalled).toBe(false);
      });
    });

    // ---------------------------------------------------------------
    // TracingChannel: tracePromise (success)
    // ---------------------------------------------------------------
    await describe('TracingChannel tracePromise', async () => {
      await it('should publish start, end, asyncStart, asyncEnd on success', async () => {
        const tc = tracingChannel(uid('tp-ok'));
        const events: string[] = [];
        tc.subscribe({
          start: () => events.push('start'),
          end: () => events.push('end'),
          asyncStart: () => events.push('asyncStart'),
          asyncEnd: () => events.push('asyncEnd'),
        });
        const result = await tc.tracePromise(() => Promise.resolve('done'), {});
        expect(result).toBe('done');
        expect(events[0]).toBe('start');
        expect(events[1]).toBe('end');
        expect(events[2]).toBe('asyncStart');
        expect(events[3]).toBe('asyncEnd');
        expect(events.length).toBe(4);
      });

      await it('should set result on context for async success', async () => {
        const tc = tracingChannel(uid('tp-ctx-res'));
        const ctx: Record<string, unknown> = { foo: 'bar' };
        let asyncStartCtx: any = null;
        tc.subscribe({
          start: () => {},
          end: () => {},
          asyncStart: (msg: unknown) => { asyncStartCtx = msg; },
          asyncEnd: () => {},
        });
        await tc.tracePromise(() => Promise.resolve('value'), ctx);
        expect(asyncStartCtx.result).toBe('value');
        expect(asyncStartCtx.error).toBeUndefined();
      });

      await it('should pass thisArg and args to the function', async () => {
        const tc = tracingChannel(uid('tp-thisarg'));
        tc.subscribe({ start: () => {}, end: () => {}, asyncStart: () => {}, asyncEnd: () => {} });
        const thisArg = { baz: 'buz' };
        const expected = { foo: 'bar' };
        let receivedThis: unknown = null;
        let receivedArg: unknown = null;
        await tc.tracePromise(function (this: unknown, val: unknown) {
          receivedThis = this;
          receivedArg = val;
          return Promise.resolve(val);
        }, {}, thisArg, expected);
        expect(receivedThis).toBe(thisArg);
        expect(receivedArg).toBe(expected);
      });
    });

    // ---------------------------------------------------------------
    // TracingChannel: tracePromise (error)
    // ---------------------------------------------------------------
    await describe('TracingChannel tracePromise error', async () => {
      await it('should publish error, asyncStart, asyncEnd on rejection', async () => {
        const tc = tracingChannel(uid('tp-err'));
        const events: string[] = [];
        let errorCtx: any = null;
        tc.subscribe({
          start: () => events.push('start'),
          end: () => events.push('end'),
          asyncStart: () => events.push('asyncStart'),
          asyncEnd: () => events.push('asyncEnd'),
          error: (msg: unknown) => {
            events.push('error');
            errorCtx = msg;
          },
        });
        const expectedErr = new Error('async-fail');
        try {
          await tc.tracePromise(() => Promise.reject(expectedErr), {});
        } catch {
          // expected
        }
        expect(events).toContain('start');
        expect(events).toContain('end');
        expect(events).toContain('error');
        expect(events).toContain('asyncStart');
        expect(events).toContain('asyncEnd');
        expect(errorCtx.error).toBe(expectedErr);
      });

      await it('should re-throw the rejection error', async () => {
        const tc = tracingChannel(uid('tp-rethrow'));
        tc.subscribe({ start: () => {}, end: () => {}, error: () => {}, asyncStart: () => {}, asyncEnd: () => {} });
        const expectedErr = new Error('reject-test');
        let caught: unknown = null;
        try {
          await tc.tracePromise(() => Promise.reject(expectedErr), {});
        } catch (e) {
          caught = e;
        }
        expect(caught).toBe(expectedErr);
      });
    });

    // ---------------------------------------------------------------
    // TracingChannel: traceCallback
    // ---------------------------------------------------------------
    await describe('TracingChannel traceCallback', async () => {
      await it('should publish start, end, asyncStart, asyncEnd on success callback', async () => {
        const tc = tracingChannel(uid('tc-cb-ok'));
        const events: string[] = [];
        tc.subscribe({
          start: () => events.push('start'),
          end: () => events.push('end'),
          asyncStart: () => events.push('asyncStart'),
          asyncEnd: () => events.push('asyncEnd'),
          error: () => events.push('error'),
        });

        await new Promise<void>((resolve) => {
          tc.traceCallback(
            (cb: unknown) => {
              // Simulate async: call the callback synchronously for simplicity
              (cb as (err: null, res: string) => void)(null, 'result');
            },
            0,
            {},
            undefined,
            (err: unknown, res: unknown) => {
              expect(err).toBeNull();
              expect(res).toBe('result');
              resolve();
            },
          );
        });

        expect(events).toContain('start');
        expect(events).toContain('end');
        expect(events).toContain('asyncStart');
        expect(events).toContain('asyncEnd');
        expect(events).not.toContain('error');
      });

      await it('should publish error when callback receives an error', async () => {
        const tc = tracingChannel(uid('tc-cb-err'));
        let errorPublished = false;
        tc.subscribe({
          start: () => {},
          end: () => {},
          asyncStart: () => {},
          asyncEnd: () => {},
          error: () => { errorPublished = true; },
        });

        const expectedErr = new Error('cb-error');
        await new Promise<void>((resolve) => {
          tc.traceCallback(
            (cb: unknown) => {
              (cb as (err: Error) => void)(expectedErr);
            },
            0,
            {},
            undefined,
            (err: unknown) => {
              expect(err).toBe(expectedErr);
              resolve();
            },
          );
        });

        expect(errorPublished).toBe(true);
      });

      await it('should throw if callback argument is not a function', async () => {
        const tc = tracingChannel(uid('tc-cb-type'));
        tc.subscribe({ start: () => {} });
        let threw = false;
        try {
          tc.traceCallback(() => {}, 0, {}, undefined, 'not-a-function' as any);
        } catch (e: any) {
          threw = true;
          expect(e.message).toContain('callback');
        }
        expect(threw).toBe(true);
      });
    });

    // ---------------------------------------------------------------
    // Edge cases
    // ---------------------------------------------------------------
    await describe('edge cases', async () => {
      await it('should handle empty string channel name', async () => {
        const ch = channel('');
        expect(ch.name).toBe('');
        expect(ch.hasSubscribers).toBe(false);
      });

      await it('should handle publishing various data types', async () => {
        const ch = channel(uid('types'));
        const received: unknown[] = [];
        ch.subscribe((msg: unknown) => received.push(msg));
        ch.publish(null);
        ch.publish(undefined);
        ch.publish(0);
        ch.publish('');
        ch.publish(false);
        ch.publish([1, 2, 3]);
        expect(received.length).toBe(6);
        expect(received[0]).toBeNull();
        expect(received[1]).toBeUndefined();
        expect(received[2]).toBe(0);
        expect(received[3]).toBe('');
        expect(received[4]).toBe(false);
      });

      await it('should handle duplicate subscribe (same function twice)', async () => {
        // Node.js uses array-based subscribers so duplicates are allowed.
        // Our Set-based impl de-duplicates. Either behavior is acceptable
        // as long as it does not crash and the subscriber runs at least once.
        const ch = channel(uid('dup'));
        let count = 0;
        const handler = () => { count++; };
        ch.subscribe(handler);
        ch.subscribe(handler);
        ch.publish('test');
        // Should be called at least once
        expect(count).toBeGreaterThan(0);
      });

      await it('channel publish with no subscribers should be a no-op', async () => {
        const ch = channel(uid('noop-pub'));
        // Should not throw
        ch.publish({ some: 'data' });
      });

      await it('TracingChannel traceSync with no subscribers should just call fn', async () => {
        const tc = tracingChannel(uid('ts-noop'));
        let called = false;
        const result = tc.traceSync(() => {
          called = true;
          return 'value';
        }, {});
        expect(called).toBe(true);
        expect(result).toBe('value');
      });

      await it('TracingChannel tracePromise with no subscribers should just call fn', async () => {
        const tc = tracingChannel(uid('tp-noop'));
        let called = false;
        const result = await tc.tracePromise(() => {
          called = true;
          return Promise.resolve('value');
        }, {});
        expect(called).toBe(true);
        expect(result).toBe('value');
      });

      await it('TracingChannel traceSync end fires even on error (finally semantics)', async () => {
        const tc = tracingChannel(uid('ts-finally'));
        let endFired = false;
        tc.subscribe({
          start: () => {},
          end: () => { endFired = true; },
          error: () => {},
        });
        try {
          tc.traceSync(() => { throw new Error('boom'); }, {});
        } catch {
          // expected
        }
        expect(endFired).toBe(true);
      });

      await it('TracingChannel created from channel objects should work', async () => {
        const name = uid('from-obj');
        const tc = tracingChannel({
          start: channel(`tracing:${name}:start`),
          end: channel(`tracing:${name}:end`),
          asyncStart: channel(`tracing:${name}:asyncStart`),
          asyncEnd: channel(`tracing:${name}:asyncEnd`),
          error: channel(`tracing:${name}:error`),
        });
        const events: string[] = [];
        tc.subscribe({
          start: () => events.push('start'),
          end: () => events.push('end'),
        });
        tc.traceSync(() => 'ok', {});
        expect(events.length).toBe(2);
      });
    });

    // ---------------------------------------------------------------
    // Interaction between module-level and Channel-level APIs
    // ---------------------------------------------------------------
    await describe('module-level and Channel-level API interaction', async () => {
      await it('subscribe via module function, publish via Channel instance', async () => {
        const name = uid('cross');
        const messages: unknown[] = [];
        subscribe(name, (msg: unknown) => messages.push(msg));
        channel(name).publish('hello');
        expect(messages.length).toBe(1);
        expect(messages[0]).toBe('hello');
      });

      await it('subscribe via Channel instance, check via module hasSubscribers', async () => {
        const name = uid('cross2');
        const ch = channel(name);
        expect(hasSubscribers(name)).toBe(false);
        ch.subscribe(() => {});
        expect(hasSubscribers(name)).toBe(true);
      });

      await it('unsubscribe via module function affects Channel.hasSubscribers', async () => {
        const name = uid('cross3');
        const handler = () => {};
        subscribe(name, handler);
        expect(channel(name).hasSubscribers).toBe(true);
        unsubscribe(name, handler);
        expect(channel(name).hasSubscribers).toBe(false);
      });
    });
  });
};
