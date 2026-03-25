// Ported from refs/node-test/parallel/test-events-*.js
// Original: MIT license, Node.js contributors

import { describe, it, expect } from '@gjsify/unit';
import 'abort-controller'; // Registers AbortController/AbortSignal globals on GJS; no-op on Node.js

import { EventEmitter } from 'node:events';

export default async () => {

	await describe('EventEmitter: constructor', async () => {
		await it('should create an instance', async () => {
			const emitter = new EventEmitter();
			expect(emitter).toBeDefined();
			expect(emitter instanceof EventEmitter).toBeTruthy();
		});

		await it('should have default max listeners of 10', async () => {
			const emitter = new EventEmitter();
			expect(emitter.getMaxListeners()).toBe(10);
		});
	});

	await describe('EventEmitter: emit', async () => {
		await it('should call listeners when event is emitted', async () => {
			const emitter = new EventEmitter();
			let called = false;
			emitter.on('test', () => { called = true; });
			emitter.emit('test');
			expect(called).toBeTruthy();
		});

		await it('should call multiple listeners in order', async () => {
			const emitter = new EventEmitter();
			const order: number[] = [];
			emitter.on('test', () => order.push(1));
			emitter.on('test', () => order.push(2));
			emitter.emit('test');
			expect(order.length).toBe(2);
			expect(order[0]).toBe(1);
			expect(order[1]).toBe(2);
		});

		await it('should pass arguments to listeners', async () => {
			const emitter = new EventEmitter();
			let received: any[] = [];
			emitter.on('test', (...args) => { received = args; });
			emitter.emit('test', 'a', 'b', 'c');
			expect(received.length).toBe(3);
			expect(received[0]).toBe('a');
			expect(received[1]).toBe('b');
			expect(received[2]).toBe('c');
		});

		await it('should return true when listeners exist', async () => {
			const emitter = new EventEmitter();
			emitter.on('test', () => {});
			expect(emitter.emit('test')).toBeTruthy();
		});

		await it('should return false when no listeners exist', async () => {
			const emitter = new EventEmitter();
			expect(emitter.emit('test')).toBeFalsy();
		});

		await it('should throw on unhandled error event', async () => {
			const emitter = new EventEmitter();
			expect(() => {
				emitter.emit('error', new Error('test error'));
			}).toThrow();
		});

		await it('should not throw on error event with listener', async () => {
			const emitter = new EventEmitter();
			let caught = false;
			emitter.on('error', () => { caught = true; });
			emitter.emit('error', new Error('test error'));
			expect(caught).toBeTruthy();
		});
	});

	await describe('EventEmitter: on / addListener', async () => {
		await it('should add a listener', async () => {
			const emitter = new EventEmitter();
			const fn = () => {};
			emitter.on('test', fn);
			expect(emitter.listenerCount('test')).toBe(1);
		});

		await it('should return this for chaining', async () => {
			const emitter = new EventEmitter();
			const result = emitter.on('test', () => {});
			expect(result).toBe(emitter);
		});

		await it('addListener should be an alias for on', async () => {
			const emitter = new EventEmitter();
			let count = 0;
			emitter.addListener('test', () => { count++; });
			emitter.emit('test');
			expect(count).toBe(1);
		});
	});

	await describe('EventEmitter: once', async () => {
		await it('should fire listener only once', async () => {
			const emitter = new EventEmitter();
			let count = 0;
			emitter.once('test', () => { count++; });
			emitter.emit('test');
			emitter.emit('test');
			expect(count).toBe(1);
		});

		await it('should remove listener after first call', async () => {
			const emitter = new EventEmitter();
			emitter.once('test', () => {});
			expect(emitter.listenerCount('test')).toBe(1);
			emitter.emit('test');
			expect(emitter.listenerCount('test')).toBe(0);
		});

		await it('should pass arguments correctly', async () => {
			const emitter = new EventEmitter();
			let received: any;
			emitter.once('test', (val) => { received = val; });
			emitter.emit('test', 42);
			expect(received).toBe(42);
		});
	});

	await describe('EventEmitter: removeListener / off', async () => {
		await it('should remove a specific listener', async () => {
			const emitter = new EventEmitter();
			const fn = () => {};
			emitter.on('test', fn);
			expect(emitter.listenerCount('test')).toBe(1);
			emitter.removeListener('test', fn);
			expect(emitter.listenerCount('test')).toBe(0);
		});

		await it('off should be an alias for removeListener', async () => {
			const emitter = new EventEmitter();
			const fn = () => {};
			emitter.on('test', fn);
			emitter.off('test', fn);
			expect(emitter.listenerCount('test')).toBe(0);
		});

		await it('should return this for chaining', async () => {
			const emitter = new EventEmitter();
			const fn = () => {};
			emitter.on('test', fn);
			const result = emitter.removeListener('test', fn);
			expect(result).toBe(emitter);
		});

		await it('should not fail when removing non-existent listener', async () => {
			const emitter = new EventEmitter();
			emitter.removeListener('nonexistent', () => {});
			expect(emitter.listenerCount('nonexistent')).toBe(0);
		});

		await it('should only remove the last matching listener', async () => {
			const emitter = new EventEmitter();
			const fn = () => {};
			emitter.on('test', fn);
			emitter.on('test', fn);
			emitter.removeListener('test', fn);
			expect(emitter.listenerCount('test')).toBe(1);
		});
	});

	await describe('EventEmitter: removeAllListeners', async () => {
		await it('should remove all listeners for an event', async () => {
			const emitter = new EventEmitter();
			emitter.on('test', () => {});
			emitter.on('test', () => {});
			emitter.removeAllListeners('test');
			expect(emitter.listenerCount('test')).toBe(0);
		});

		await it('should remove all listeners for all events when no arg', async () => {
			const emitter = new EventEmitter();
			emitter.on('a', () => {});
			emitter.on('b', () => {});
			emitter.removeAllListeners();
			expect(emitter.eventNames().length).toBe(0);
		});
	});

	await describe('EventEmitter: prependListener', async () => {
		await it('should add listener at the beginning', async () => {
			const emitter = new EventEmitter();
			const order: number[] = [];
			emitter.on('test', () => order.push(1));
			emitter.prependListener('test', () => order.push(0));
			emitter.emit('test');
			expect(order[0]).toBe(0);
			expect(order[1]).toBe(1);
		});
	});

	await describe('EventEmitter: prependOnceListener', async () => {
		await it('should add once listener at the beginning', async () => {
			const emitter = new EventEmitter();
			const order: number[] = [];
			emitter.on('test', () => order.push(1));
			emitter.prependOnceListener('test', () => order.push(0));
			emitter.emit('test');
			emitter.emit('test');
			expect(order.length).toBe(3);
			expect(order[0]).toBe(0);
			expect(order[1]).toBe(1);
			expect(order[2]).toBe(1);
		});
	});

	await describe('EventEmitter: listeners', async () => {
		await it('should return array of listeners', async () => {
			const emitter = new EventEmitter();
			const fn1 = () => {};
			const fn2 = () => {};
			emitter.on('test', fn1);
			emitter.on('test', fn2);
			const listeners = emitter.listeners('test');
			expect(listeners.length).toBe(2);
			expect(listeners[0]).toBe(fn1);
			expect(listeners[1]).toBe(fn2);
		});

		await it('should return empty array for non-existent event', async () => {
			const emitter = new EventEmitter();
			const listeners = emitter.listeners('test');
			expect(listeners.length).toBe(0);
		});

		await it('should unwrap once listeners', async () => {
			const emitter = new EventEmitter();
			const fn = () => {};
			emitter.once('test', fn);
			const listeners = emitter.listeners('test');
			expect(listeners[0]).toBe(fn);
		});
	});

	await describe('EventEmitter: rawListeners', async () => {
		await it('should return wrapped once listeners', async () => {
			const emitter = new EventEmitter();
			const fn = () => {};
			emitter.once('test', fn);
			const raw = emitter.rawListeners('test');
			expect(raw.length).toBe(1);
			// Raw listener should have .listener property pointing to original
			expect((raw[0] as any).listener).toBe(fn);
		});
	});

	await describe('EventEmitter: listenerCount', async () => {
		await it('should return count of listeners', async () => {
			const emitter = new EventEmitter();
			expect(emitter.listenerCount('test')).toBe(0);
			emitter.on('test', () => {});
			expect(emitter.listenerCount('test')).toBe(1);
			emitter.on('test', () => {});
			expect(emitter.listenerCount('test')).toBe(2);
		});
	});

	await describe('EventEmitter: eventNames', async () => {
		await it('should return array of event names', async () => {
			const emitter = new EventEmitter();
			emitter.on('foo', () => {});
			emitter.on('bar', () => {});
			const names = emitter.eventNames();
			expect(names.length).toBe(2);
			expect(names).toContain('foo');
			expect(names).toContain('bar');
		});

		await it('should return empty array when no listeners', async () => {
			const emitter = new EventEmitter();
			expect(emitter.eventNames().length).toBe(0);
		});

		await it('should support symbol event names', async () => {
			const emitter = new EventEmitter();
			const sym = Symbol('test');
			emitter.on(sym, () => {});
			const names = emitter.eventNames();
			expect(names.length).toBe(1);
			// Use typeof check since toBe cannot compare Symbols
			expect(typeof names[0]).toBe('symbol');
		});
	});

	await describe('EventEmitter: setMaxListeners / getMaxListeners', async () => {
		await it('should set and get max listeners', async () => {
			const emitter = new EventEmitter();
			emitter.setMaxListeners(20);
			expect(emitter.getMaxListeners()).toBe(20);
		});

		await it('should allow 0 for unlimited', async () => {
			const emitter = new EventEmitter();
			emitter.setMaxListeners(0);
			expect(emitter.getMaxListeners()).toBe(0);
		});

		await it('should throw for negative values', async () => {
			const emitter = new EventEmitter();
			expect(() => emitter.setMaxListeners(-1)).toThrow();
		});
	});

	await describe('EventEmitter: newListener event', async () => {
		await it('should emit newListener when adding a listener', async () => {
			const emitter = new EventEmitter();
			let eventName: string | undefined;
			emitter.on('newListener', (name: string) => {
				eventName = name;
			});
			emitter.on('test', () => {});
			expect(eventName).toBe('test');
		});
	});

	await describe('EventEmitter: removeListener event', async () => {
		await it('should emit removeListener when removing a listener', async () => {
			const emitter = new EventEmitter();
			let eventName: string | undefined;
			emitter.on('removeListener', (name: string) => {
				eventName = name;
			});
			const fn = () => {};
			emitter.on('test', fn);
			emitter.removeListener('test', fn);
			expect(eventName).toBe('test');
		});
	});

	await describe('EventEmitter.once (static)', async () => {
		await it('should return a promise that resolves on event', async () => {
			const emitter = new EventEmitter();
			const promise = EventEmitter.once(emitter, 'test');
			emitter.emit('test', 'value');
			const result = await promise;
			expect(result.length).toBe(1);
			expect(result[0]).toBe('value');
		});

		await it('should reject on error event', async () => {
			const emitter = new EventEmitter();
			const promise = EventEmitter.once(emitter, 'test');
			const error = new Error('test error');
			emitter.emit('error', error);
			try {
				await promise;
				// Should not reach here
				expect(false).toBeTruthy();
			} catch (err) {
				expect(err).toBe(error);
			}
		});

		await it('should pass multiple args as array', async () => {
			const emitter = new EventEmitter();
			const promise = EventEmitter.once(emitter, 'test');
			emitter.emit('test', 1, 2, 3);
			const result = await promise;
			expect(result.length).toBe(3);
			expect(result[0]).toBe(1);
			expect(result[1]).toBe(2);
			expect(result[2]).toBe(3);
		});
	});

	await describe('EventEmitter.on (static)', async () => {
		await it('should return an async iterator', async () => {
			const emitter = new EventEmitter();
			const iterator = EventEmitter.on(emitter, 'data');
			expect(iterator).toBeDefined();
			expect(typeof iterator[Symbol.asyncIterator]).toBe('function');

			// Emit some data then end iterator
			emitter.emit('data', 1);
			emitter.emit('data', 2);

			const first = await iterator.next();
			expect(first.done).toBeFalsy();
			expect(first.value[0]).toBe(1);

			const second = await iterator.next();
			expect(second.done).toBeFalsy();
			expect(second.value[0]).toBe(2);

			await iterator.return!();
		});
	});

	await describe('EventEmitter.listenerCount (static)', async () => {
		await it('should return listener count', async () => {
			const emitter = new EventEmitter();
			emitter.on('test', () => {});
			emitter.on('test', () => {});
			expect(EventEmitter.listenerCount(emitter, 'test')).toBe(2);
		});
	});

	await describe('EventEmitter.getEventListeners (static)', async () => {
		await it('should return listeners array', async () => {
			const emitter = new EventEmitter();
			const fn = () => {};
			emitter.on('test', fn);
			const listeners = EventEmitter.getEventListeners(emitter, 'test');
			expect(listeners.length).toBe(1);
			expect(listeners[0]).toBe(fn);
		});
	});

	await describe('EventEmitter: error handling', async () => {
		await it('should throw generic error when emitting error with no listener and no Error arg', async () => {
			const emitter = new EventEmitter();
			expect(() => {
				emitter.emit('error', 'string error');
			}).toThrow();
		});

		await it('should throw with context for non-Error arguments', async () => {
			const emitter = new EventEmitter();
			try {
				emitter.emit('error', 'string error');
				expect(false).toBeTruthy();
			} catch (err: any) {
				expect(err.context).toBe('string error');
			}
		});
	});

	// ==================== additional tests ported from refs/node ====================

	await describe('EventEmitter: defaultMaxListeners static', async () => {
		await it('should have defaultMaxListeners property', async () => {
			expect(typeof EventEmitter.defaultMaxListeners).toBe('number');
			expect(EventEmitter.defaultMaxListeners).toBe(10);
		});
	});

	await describe('EventEmitter: Symbol event names', async () => {
		await it('should support Symbol as event name', async () => {
			const emitter = new EventEmitter();
			const sym = Symbol('myEvent');
			let called = false;
			emitter.on(sym, () => { called = true; });
			emitter.emit(sym);
			expect(called).toBeTruthy();
		});

		await it('should support removing Symbol listeners', async () => {
			const emitter = new EventEmitter();
			const sym = Symbol('myEvent');
			const fn = () => {};
			emitter.on(sym, fn);
			expect(emitter.listenerCount(sym)).toBe(1);
			emitter.removeListener(sym, fn);
			expect(emitter.listenerCount(sym)).toBe(0);
		});
	});

	await describe('EventEmitter: removeAllListeners', async () => {
		await it('should remove all listeners for a specific event', async () => {
			const emitter = new EventEmitter();
			emitter.on('test', () => {});
			emitter.on('test', () => {});
			emitter.on('other', () => {});
			emitter.removeAllListeners('test');
			expect(emitter.listenerCount('test')).toBe(0);
			expect(emitter.listenerCount('other')).toBe(1);
		});

		await it('should remove all listeners when no event specified', async () => {
			const emitter = new EventEmitter();
			emitter.on('test', () => {});
			emitter.on('other', () => {});
			emitter.removeAllListeners();
			expect(emitter.eventNames().length).toBe(0);
		});

		await it('should return this for chaining', async () => {
			const emitter = new EventEmitter();
			const result = emitter.removeAllListeners();
			expect(result).toBe(emitter);
		});
	});

	await describe('EventEmitter: listener removal during emit', async () => {
		await it('should not skip listeners when one removes itself', async () => {
			const emitter = new EventEmitter();
			const calls: number[] = [];
			const fn1 = () => {
				calls.push(1);
				emitter.removeListener('test', fn1);
			};
			const fn2 = () => { calls.push(2); };
			emitter.on('test', fn1);
			emitter.on('test', fn2);
			emitter.emit('test');
			expect(calls.length).toBe(2);
			expect(calls[0]).toBe(1);
			expect(calls[1]).toBe(2);
		});
	});

	await describe('EventEmitter: off alias', async () => {
		await it('off should be an alias for removeListener', async () => {
			const emitter = new EventEmitter();
			const fn = () => {};
			emitter.on('test', fn);
			expect(emitter.listenerCount('test')).toBe(1);
			emitter.off('test', fn);
			expect(emitter.listenerCount('test')).toBe(0);
		});
	});

	// Keep original tests for backwards compatibility
	await describe('events.EventEmitter: emit (original)', async () => {
		await it('1. Add two listeners on a single event and emit the event', async () => {
			const emitter = new EventEmitter();
			let count = 0;

			function functionA() { count++; }
			function functionB() { count++ }

			emitter.on('test2', functionA);
			emitter.on('test2', functionB);

			emitter.emit('test2');

			expect(count).toBe(2);
		});

		await it('2. Add two listeners on a single event and emit the event twice', async () => {
			const emitter = new EventEmitter();
			let count = 0;

			function functionA() { count++ }
			function functionB() { count++ }

			emitter.on('test2', functionA);
			emitter.on('test2', functionB);

			emitter.emit('test2');
			emitter.emit('test2');

			expect(count).toBe(4);
		});

		await it('3. Add two listeners on a single event and emit the event with a parameter', async () => {
			const emitter = new EventEmitter();
			let count = 0;

			function functionA(value1: string) {
				count++;
				expect(typeof value1).toBe('string');
			}

			function functionB(value1: string) {
				count++;
				expect(typeof value1).toBe('string');
			}

			emitter.on('test2', functionA);
			emitter.on('test2', functionB);

			emitter.emit('test2', 'Hello, Node');

			expect(count).toBe(2);
		});

		await it(`4. Add two listeners on an single event and emit the event twice with a parameter.`, async () => {
			const emitter = new EventEmitter();
			let count = 0;

			function functionA(value1: string) {
				count++;
				expect(typeof value1).toBe('string');
			}

			function functionB(value1: string) {
				count++;
				expect(typeof value1).toBe('string');
			}

			emitter.on('test2', functionA);
			emitter.on('test2', functionB);

			emitter.emit('test2', 'Hello, Node1');
			emitter.emit('test2', 'Hello, Node2');

			expect(count).toBe(4);
		});

		await it(`5. Add two listeners on an single event and emit the event twice with multiple parameters.`, async () => {
			const emitter = new EventEmitter();
			let count = 0;

			function functionA(value1: string, value2: string, value3: string) {
				count++;
				expect(typeof value1).toBe('string');
				expect(typeof value2).toBe('string');
				expect(typeof value3).toBe('string');
			}

			function functionB(value1: string, value2: string, value3: string) {
				count++;
				expect(typeof value1).toBe('string');
				expect(typeof value2).toBe('string');
				expect(typeof value3).toBe('string');
			}

			emitter.on('test2', functionA);
			emitter.on('test2', functionB);

			emitter.emit('test2', 'Hello, Node1', 'Hello, Node2', 'Hello, Node3');
			emitter.emit('test2', 'Hello, Node1', 'Hello, Node2', 'Hello, Node3');

			expect(count).toBe(4);
		});


		await it('6. Check return values of emit.', async () => {
			let count = 0;
			const emitter = new EventEmitter();

			function functionA() {
				count++;
			}

			emitter.on('test6', functionA);

			expect(emitter.emit('test6')).toBeTruthy();
			expect(emitter.emit('other')).toBeFalsy();

			expect(count).toBe(1);
		});

		await it('7. Emit event with more than 2 arguments', async () => {
			let count = 0;
			const emitter = new EventEmitter();

			emitter.on('test', function (x: number, y: number, z: number) {
				count++;
				expect(x).toBe(1);
				expect(y).toBe(2);
				expect(z).toBe(3);
			});

			emitter.emit('test', 1, 2, 3);
			expect(count).toBe(1);
		});

	});

	// ==================== expanded tests: setMaxListeners / getMaxListeners ====================

	await describe('EventEmitter: setMaxListeners / getMaxListeners (expanded)', async () => {
		await it('should return this from setMaxListeners for chaining', async () => {
			const emitter = new EventEmitter();
			const result = emitter.setMaxListeners(5);
			expect(result).toBe(emitter);
		});

		await it('should throw for NaN', async () => {
			const emitter = new EventEmitter();
			expect(() => emitter.setMaxListeners(NaN)).toThrow();
		});

		await it('should accept Infinity', async () => {
			const emitter = new EventEmitter();
			emitter.setMaxListeners(Infinity);
			expect(emitter.getMaxListeners()).toBe(Infinity);
		});

		await it('static setMaxListeners should set on multiple emitters', async () => {
			const ee1 = new EventEmitter();
			const ee2 = new EventEmitter();
			EventEmitter.setMaxListeners(42, ee1, ee2);
			expect(ee1.getMaxListeners()).toBe(42);
			expect(ee2.getMaxListeners()).toBe(42);
		});

		await it('static getMaxListeners should return max listeners for emitter', async () => {
			const ee = new EventEmitter();
			expect(EventEmitter.getMaxListeners(ee)).toBe(EventEmitter.defaultMaxListeners);
			ee.setMaxListeners(101);
			expect(EventEmitter.getMaxListeners(ee)).toBe(101);
		});

		await it('static setMaxListeners with no emitters should set defaultMaxListeners', async () => {
			const original = EventEmitter.defaultMaxListeners;
			try {
				EventEmitter.setMaxListeners(99);
				expect(EventEmitter.defaultMaxListeners).toBe(99);
			} finally {
				EventEmitter.defaultMaxListeners = original;
			}
		});
	});

	// ==================== expanded tests: errorMonitor ====================

	await describe('EventEmitter: errorMonitor symbol', async () => {
		await it('should emit to errorMonitor before throwing', async () => {
			const emitter = new EventEmitter();
			let monitorCalled = false;
			let monitorError: Error | undefined;
			emitter.on(EventEmitter.errorMonitor, (err: Error) => {
				monitorCalled = true;
				monitorError = err;
			});
			const testErr = new Error('monitored');
			try {
				emitter.emit('error', testErr);
			} catch {
				// expected
			}
			expect(monitorCalled).toBeTruthy();
			expect(monitorError).toBe(testErr);
		});

		await it('should emit to errorMonitor even when error listener exists', async () => {
			const emitter = new EventEmitter();
			let monitorCalled = false;
			let errorCalled = false;
			emitter.on(EventEmitter.errorMonitor, () => { monitorCalled = true; });
			emitter.on('error', () => { errorCalled = true; });
			emitter.emit('error', new Error('test'));
			expect(monitorCalled).toBeTruthy();
			expect(errorCalled).toBeTruthy();
		});

		await it('errorMonitor should be a symbol', async () => {
			expect(typeof EventEmitter.errorMonitor).toBe('symbol');
		});
	});

	// ==================== expanded tests: captureRejections ====================

	await describe('EventEmitter: captureRejections', async () => {
		await it('should have captureRejectionSymbol static property', async () => {
			expect(EventEmitter.captureRejectionSymbol).toBeDefined();
			expect(typeof EventEmitter.captureRejectionSymbol).toBe('symbol');
		});

		await it('should default captureRejections to false', async () => {
			expect(EventEmitter.captureRejections).toBe(false);
		});

		await it('should accept captureRejections in constructor options', async () => {
			const emitter = new EventEmitter({ captureRejections: true });
			// The emitter was created with captureRejections enabled
			// (internal state, no public getter — just ensure no error thrown)
			expect(emitter).toBeDefined();
		});

		await it('captureRejections should route async errors to error event', async () => {
			const emitter = new EventEmitter({ captureRejections: true });
			let caughtErr: Error | undefined;
			const expectedErr = new Error('async failure');
			emitter.on('error', (err: Error) => { caughtErr = err; });
			emitter.on('test', async () => {
				throw expectedErr;
			});
			emitter.emit('test');
			// Wait for the microtask to propagate
			await new Promise(r => setTimeout(r, 50));
			expect(caughtErr).toBe(expectedErr);
		});
	});

	// ==================== expanded tests: getEventListeners static ====================

	await describe('EventEmitter.getEventListeners (expanded)', async () => {
		await it('should return empty array for non-existent event', async () => {
			const emitter = new EventEmitter();
			const listeners = EventEmitter.getEventListeners(emitter, 'nonexistent');
			expect(listeners.length).toBe(0);
		});

		await it('should return correct listeners for multiple events', async () => {
			const emitter = new EventEmitter();
			const fn1 = () => {};
			const fn2 = () => {};
			emitter.on('foo', fn1);
			emitter.on('foo', fn2);
			emitter.on('baz', fn1);
			const fooListeners = EventEmitter.getEventListeners(emitter, 'foo');
			expect(fooListeners.length).toBe(2);
			expect(fooListeners[0]).toBe(fn1);
			expect(fooListeners[1]).toBe(fn2);
			const bazListeners = EventEmitter.getEventListeners(emitter, 'baz');
			expect(bazListeners.length).toBe(1);
			expect(bazListeners[0]).toBe(fn1);
		});

		await it('should unwrap once listeners', async () => {
			const emitter = new EventEmitter();
			const fn = () => {};
			emitter.once('test', fn);
			const listeners = EventEmitter.getEventListeners(emitter, 'test');
			expect(listeners.length).toBe(1);
			expect(listeners[0]).toBe(fn);
		});
	});

	// ==================== expanded tests: listenerCount static ====================

	await describe('EventEmitter.listenerCount static (expanded)', async () => {
		await it('should return 0 for no listeners', async () => {
			const emitter = new EventEmitter();
			expect(EventEmitter.listenerCount(emitter, 'test')).toBe(0);
		});

		await it('should count once listeners', async () => {
			const emitter = new EventEmitter();
			emitter.once('test', () => {});
			expect(EventEmitter.listenerCount(emitter, 'test')).toBe(1);
		});

		await it('should count mixed on and once listeners', async () => {
			const emitter = new EventEmitter();
			emitter.on('test', () => {});
			emitter.once('test', () => {});
			emitter.on('test', () => {});
			expect(EventEmitter.listenerCount(emitter, 'test')).toBe(3);
		});
	});

	// ==================== expanded tests: once static (promise-based) ====================

	await describe('EventEmitter.once static (expanded)', async () => {
		await it('should resolve with empty array when event has no args', async () => {
			const emitter = new EventEmitter();
			const promise = EventEmitter.once(emitter, 'test');
			emitter.emit('test');
			const result = await promise;
			expect(result.length).toBe(0);
		});

		await it('should clean up listeners after resolving', async () => {
			const emitter = new EventEmitter();
			const promise = EventEmitter.once(emitter, 'test');
			emitter.emit('test', 'value');
			await promise;
			expect(emitter.listenerCount('test')).toBe(0);
			expect(emitter.listenerCount('error')).toBe(0);
		});

		await it('should clean up listeners after error rejection', async () => {
			const emitter = new EventEmitter();
			const promise = EventEmitter.once(emitter, 'test');
			emitter.emit('error', new Error('fail'));
			try {
				await promise;
			} catch {
				// expected
			}
			expect(emitter.listenerCount('test')).toBe(0);
			expect(emitter.listenerCount('error')).toBe(0);
		});

		await it('should resolve when listening for error event itself', async () => {
			const emitter = new EventEmitter();
			const expectedErr = new Error('expected');
			const promise = EventEmitter.once(emitter, 'error');
			emitter.emit('error', expectedErr);
			const [err] = await promise;
			expect(err).toBe(expectedErr);
		});

		await it('should reject with AbortError when signal is already aborted', async () => {
			const emitter = new EventEmitter();
			const abortedSignal = AbortSignal.abort();
			try {
				await EventEmitter.once(emitter, 'test', { signal: abortedSignal });
				expect(false).toBeTruthy();
			} catch (err: any) {
				expect(err.name).toBe('AbortError');
			}
		});

		await it('should reject when abort signal fires after call', async () => {
			const emitter = new EventEmitter();
			const ac = new AbortController();
			const promise = EventEmitter.once(emitter, 'test', { signal: ac.signal });
			ac.abort();
			try {
				await promise;
				expect(false).toBeTruthy();
			} catch (err: any) {
				expect(err.name).toBe('AbortError');
			}
		});
	});

	// ==================== expanded tests: prependListener / prependOnceListener ====================

	await describe('EventEmitter: prependListener (expanded)', async () => {
		await it('should return this for chaining', async () => {
			const emitter = new EventEmitter();
			const result = emitter.prependListener('test', () => {});
			expect(result).toBe(emitter);
		});

		await it('should prepend multiple listeners in correct order', async () => {
			const emitter = new EventEmitter();
			const order: number[] = [];
			emitter.on('test', () => order.push(1));
			emitter.prependListener('test', () => order.push(2));
			emitter.prependListener('test', () => order.push(3));
			emitter.emit('test');
			// Last prepended is first
			expect(order[0]).toBe(3);
			expect(order[1]).toBe(2);
			expect(order[2]).toBe(1);
		});
	});

	await describe('EventEmitter: prependOnceListener (expanded)', async () => {
		await it('should return this for chaining', async () => {
			const emitter = new EventEmitter();
			const result = emitter.prependOnceListener('test', () => {});
			expect(result).toBe(emitter);
		});

		await it('should only fire once and then be removed', async () => {
			const emitter = new EventEmitter();
			let count = 0;
			emitter.prependOnceListener('test', () => { count++; });
			emitter.emit('test');
			emitter.emit('test');
			expect(count).toBe(1);
			expect(emitter.listenerCount('test')).toBe(0);
		});
	});

	// ==================== expanded tests: eventNames ====================

	await describe('EventEmitter: eventNames (expanded)', async () => {
		await it('should reflect removal of events', async () => {
			const emitter = new EventEmitter();
			const fn = () => {};
			emitter.on('foo', () => {});
			emitter.on('bar', fn);
			expect(emitter.eventNames().length).toBe(2);
			emitter.removeListener('bar', fn);
			const names = emitter.eventNames();
			expect(names.length).toBe(1);
			expect(names[0]).toBe('foo');
		});

		await it('should list symbol event names alongside string names', async () => {
			const emitter = new EventEmitter();
			const sym = Symbol('s');
			emitter.on('foo', () => {});
			emitter.on(sym, () => {});
			const names = emitter.eventNames();
			expect(names.length).toBe(2);
			expect(names[0]).toBe('foo');
			expect(typeof names[1]).toBe('symbol');
		});
	});

	// ==================== expanded tests: rawListeners ====================

	await describe('EventEmitter: rawListeners (expanded)', async () => {
		await it('should return unwrapped functions for on listeners', async () => {
			const emitter = new EventEmitter();
			const fn = () => {};
			emitter.on('test', fn);
			const raw = emitter.rawListeners('test');
			expect(raw.length).toBe(1);
			expect(raw[0]).toBe(fn);
		});

		await it('should return empty array for non-existent event', async () => {
			const emitter = new EventEmitter();
			const raw = emitter.rawListeners('nonexistent');
			expect(raw.length).toBe(0);
		});

		await it('raw once listeners should be callable and remove themselves', async () => {
			const emitter = new EventEmitter();
			let called = false;
			emitter.once('test', () => { called = true; });
			const raw = emitter.rawListeners('test');
			expect(raw.length).toBe(1);
			// Call the raw (wrapped) listener directly
			raw[0]();
			expect(called).toBeTruthy();
			// After calling, the once listener should be removed
			expect(emitter.listenerCount('test')).toBe(0);
		});
	});

	// ==================== expanded tests: removeAllListeners with specific event ====================

	await describe('EventEmitter: removeAllListeners specific (expanded)', async () => {
		await it('should not affect other events when removing specific event', async () => {
			const emitter = new EventEmitter();
			emitter.on('a', () => {});
			emitter.on('a', () => {});
			emitter.on('b', () => {});
			emitter.on('c', () => {});
			emitter.removeAllListeners('a');
			expect(emitter.listenerCount('a')).toBe(0);
			expect(emitter.listenerCount('b')).toBe(1);
			expect(emitter.listenerCount('c')).toBe(1);
		});

		await it('should emit removeListener for each removed listener', async () => {
			const emitter = new EventEmitter();
			const removed: string[] = [];
			emitter.on('removeListener', (name: string) => { removed.push(name); });
			emitter.on('data', () => {});
			emitter.on('data', () => {});
			emitter.removeAllListeners('data');
			expect(removed.length).toBe(2);
			expect(removed[0]).toBe('data');
			expect(removed[1]).toBe('data');
		});
	});

	// ==================== expanded tests: error handling ====================

	await describe('EventEmitter: error handling (expanded)', async () => {
		await it('should throw the Error object directly when emitting error', async () => {
			const emitter = new EventEmitter();
			const err = new Error('direct throw');
			try {
				emitter.emit('error', err);
				expect(false).toBeTruthy();
			} catch (caught) {
				expect(caught).toBe(err);
			}
		});

		await it('should throw generic error when emitting error with no args', async () => {
			const emitter = new EventEmitter();
			try {
				emitter.emit('error');
				expect(false).toBeTruthy();
			} catch (err: any) {
				expect(err instanceof Error).toBeTruthy();
				expect(err.message).toMatch('Unhandled error');
			}
		});

		await it('should throw wrapped error when emitting non-Error error arg', async () => {
			const emitter = new EventEmitter();
			try {
				emitter.emit('error', 42);
				expect(false).toBeTruthy();
			} catch (err: any) {
				expect(err.context).toBe(42);
			}
		});
	});

	// ==================== expanded tests: emit returns boolean ====================

	await describe('EventEmitter: emit return value (expanded)', async () => {
		await it('should return true when once listener exists', async () => {
			const emitter = new EventEmitter();
			emitter.once('test', () => {});
			expect(emitter.emit('test')).toBeTruthy();
		});

		await it('should return false after once listener consumed', async () => {
			const emitter = new EventEmitter();
			emitter.once('test', () => {});
			emitter.emit('test');
			expect(emitter.emit('test')).toBeFalsy();
		});

		await it('should return true for each emit when persistent listener exists', async () => {
			const emitter = new EventEmitter();
			emitter.on('test', () => {});
			expect(emitter.emit('test')).toBeTruthy();
			expect(emitter.emit('test')).toBeTruthy();
		});
	});

	// ==================== expanded tests: Symbol events ====================

	await describe('EventEmitter: Symbol events (expanded)', async () => {
		await it('should pass arguments with Symbol events', async () => {
			const emitter = new EventEmitter();
			const sym = Symbol('data');
			let received: unknown;
			emitter.on(sym, (val: unknown) => { received = val; });
			emitter.emit(sym, 'hello');
			expect(received).toBe('hello');
		});

		await it('should support once with Symbol events', async () => {
			const emitter = new EventEmitter();
			const sym = Symbol('once');
			let count = 0;
			emitter.once(sym, () => { count++; });
			emitter.emit(sym);
			emitter.emit(sym);
			expect(count).toBe(1);
		});

		await it('should support removeAllListeners with Symbol events', async () => {
			const emitter = new EventEmitter();
			const sym = Symbol('rem');
			emitter.on(sym, () => {});
			emitter.on(sym, () => {});
			emitter.removeAllListeners(sym);
			expect(emitter.listenerCount(sym)).toBe(0);
		});

		await it('should support prependListener with Symbol events', async () => {
			const emitter = new EventEmitter();
			const sym = Symbol('prepend');
			const order: number[] = [];
			emitter.on(sym, () => order.push(1));
			emitter.prependListener(sym, () => order.push(0));
			emitter.emit(sym);
			expect(order[0]).toBe(0);
			expect(order[1]).toBe(1);
		});
	});

	// ==================== expanded tests: multiple listeners ordering ====================

	await describe('EventEmitter: multiple listeners ordering (expanded)', async () => {
		await it('should call listeners in registration order', async () => {
			const emitter = new EventEmitter();
			const order: number[] = [];
			for (let i = 0; i < 5; i++) {
				const val = i;
				emitter.on('test', () => order.push(val));
			}
			emitter.emit('test');
			expect(order.length).toBe(5);
			for (let i = 0; i < 5; i++) {
				expect(order[i]).toBe(i);
			}
		});

		await it('should maintain order with mixed on and once', async () => {
			const emitter = new EventEmitter();
			const order: number[] = [];
			emitter.on('test', () => order.push(1));
			emitter.once('test', () => order.push(2));
			emitter.on('test', () => order.push(3));
			emitter.emit('test');
			expect(order.length).toBe(3);
			expect(order[0]).toBe(1);
			expect(order[1]).toBe(2);
			expect(order[2]).toBe(3);
		});

		await it('should maintain order with prepend mixed in', async () => {
			const emitter = new EventEmitter();
			const order: number[] = [];
			emitter.on('test', () => order.push(1));
			emitter.on('test', () => order.push(2));
			emitter.prependListener('test', () => order.push(0));
			emitter.prependOnceListener('test', () => order.push(-1));
			emitter.emit('test');
			expect(order.length).toBe(4);
			expect(order[0]).toBe(-1);
			expect(order[1]).toBe(0);
			expect(order[2]).toBe(1);
			expect(order[3]).toBe(2);
		});
	});

	// ==================== expanded tests: on async iterator ====================

	await describe('EventEmitter.on async iterator (expanded)', async () => {
		await it('should be an async iterable', async () => {
			const emitter = new EventEmitter();
			const iterator = EventEmitter.on(emitter, 'data');
			expect(typeof iterator[Symbol.asyncIterator]).toBe('function');
			expect(iterator[Symbol.asyncIterator]()).toBe(iterator);
			await iterator.return!();
		});

		await it('should buffer events emitted before consumption', async () => {
			const emitter = new EventEmitter();
			const iterator = EventEmitter.on(emitter, 'data');
			emitter.emit('data', 'a');
			emitter.emit('data', 'b');
			emitter.emit('data', 'c');

			const r1 = await iterator.next();
			expect(r1.done).toBeFalsy();
			expect(r1.value[0]).toBe('a');

			const r2 = await iterator.next();
			expect(r2.done).toBeFalsy();
			expect(r2.value[0]).toBe('b');

			const r3 = await iterator.next();
			expect(r3.done).toBeFalsy();
			expect(r3.value[0]).toBe('c');

			await iterator.return!();
		});

		await it('should clean up listeners after return', async () => {
			const emitter = new EventEmitter();
			const iterator = EventEmitter.on(emitter, 'data');
			expect(emitter.listenerCount('data')).toBe(1);
			await iterator.return!();
			expect(emitter.listenerCount('data')).toBe(0);
		});

		await it('should yield multiple arguments as array', async () => {
			const emitter = new EventEmitter();
			const iterator = EventEmitter.on(emitter, 'data');
			emitter.emit('data', 1, 2, 3);
			const result = await iterator.next();
			expect(result.value.length).toBe(3);
			expect(result.value[0]).toBe(1);
			expect(result.value[1]).toBe(2);
			expect(result.value[2]).toBe(3);
			await iterator.return!();
		});

		await it('return should signal done', async () => {
			const emitter = new EventEmitter();
			const iterator = EventEmitter.on(emitter, 'data');
			const result = await iterator.return!();
			expect(result.done).toBeTruthy();
		});
	});

	// ==================== expanded tests: newListener and removeListener events ====================

	await describe('EventEmitter: newListener event (expanded)', async () => {
		await it('should receive the listener function as second arg', async () => {
			const emitter = new EventEmitter();
			let receivedFn: unknown;
			const fn = () => {};
			emitter.on('newListener', (_name: string, listener: unknown) => {
				receivedFn = listener;
			});
			emitter.on('test', fn);
			expect(receivedFn).toBe(fn);
		});

		await it('should fire for once listeners with original function', async () => {
			const emitter = new EventEmitter();
			let receivedFn: unknown;
			const fn = () => {};
			emitter.on('newListener', (_name: string, listener: unknown) => {
				if (_name === 'test') receivedFn = listener;
			});
			emitter.once('test', fn);
			expect(receivedFn).toBe(fn);
		});

		await it('should not emit newListener for newListener itself', async () => {
			const emitter = new EventEmitter();
			const names: string[] = [];
			emitter.on('newListener', (name: string) => { names.push(name); });
			emitter.on('foo', () => {});
			emitter.on('bar', () => {});
			expect(names.length).toBe(2);
			expect(names[0]).toBe('foo');
			expect(names[1]).toBe('bar');
		});
	});

	await describe('EventEmitter: removeListener event (expanded)', async () => {
		await it('should fire when once listener is removed by emit', async () => {
			const emitter = new EventEmitter();
			const removed: string[] = [];
			emitter.on('removeListener', (name: string) => { removed.push(name); });
			emitter.once('test', () => {});
			emitter.emit('test');
			expect(removed).toContain('test');
		});

		await it('should fire for each removed listener from removeAllListeners', async () => {
			const emitter = new EventEmitter();
			let removeCount = 0;
			emitter.on('removeListener', () => { removeCount++; });
			emitter.on('test', () => {});
			emitter.on('test', () => {});
			emitter.on('test', () => {});
			emitter.removeAllListeners('test');
			expect(removeCount).toBe(3);
		});
	});

	// ==================== expanded tests: EventEmitter.EventEmitter backward compat ====================

	await describe('EventEmitter: backward compatibility', async () => {
		await it('EventEmitter.EventEmitter should reference itself', async () => {
			expect((EventEmitter as any).EventEmitter).toBe(EventEmitter);
		});
	});

	// ==================== expanded tests: listeners copy behavior ====================

	await describe('EventEmitter: listeners returns a copy', async () => {
		await it('should return a copy, not a reference', async () => {
			const emitter = new EventEmitter();
			const fn = () => {};
			emitter.on('test', fn);
			const list1 = emitter.listeners('test');
			const list2 = emitter.listeners('test');
			// They should be different array objects
			expect(list1.length).toBe(list2.length);
			expect(list1[0]).toBe(list2[0]);
			// Mutating one should not affect the other
			list1.push(() => {});
			expect(list2.length).toBe(1);
		});
	});

	// ==================== expanded tests: addListener chaining ====================

	await describe('EventEmitter: chaining', async () => {
		await it('should support fluent chaining of multiple methods', async () => {
			const emitter = new EventEmitter();
			let count = 0;
			emitter
				.on('a', () => { count++; })
				.on('b', () => { count++; })
				.once('c', () => { count++; });
			emitter.emit('a');
			emitter.emit('b');
			emitter.emit('c');
			expect(count).toBe(3);
		});
	});

	// ==================== expanded tests: this binding in listeners ====================

	await describe('EventEmitter: this in listeners', async () => {
		await it('should bind this to the emitter in on listeners', async () => {
			const emitter = new EventEmitter();
			let self: unknown;
			emitter.on('test', function(this: unknown) { self = this; });
			emitter.emit('test');
			expect(self).toBe(emitter);
		});

		await it('should bind this to the emitter in once listeners', async () => {
			const emitter = new EventEmitter();
			let self: unknown;
			emitter.once('test', function(this: unknown) { self = this; });
			emitter.emit('test');
			expect(self).toBe(emitter);
		});
	});

	// ==================== expanded tests: listener validation ====================

	await describe('EventEmitter: listener validation', async () => {
		await it('should throw TypeError for non-function listener on on()', async () => {
			const emitter = new EventEmitter();
			expect(() => emitter.on('test', 'notfn' as any)).toThrow();
		});

		await it('should throw TypeError for non-function listener on once()', async () => {
			const emitter = new EventEmitter();
			expect(() => emitter.once('test', 42 as any)).toThrow();
		});

		await it('should throw TypeError for non-function listener on removeListener()', async () => {
			const emitter = new EventEmitter();
			expect(() => emitter.removeListener('test', null as any)).toThrow();
		});
	});
}
