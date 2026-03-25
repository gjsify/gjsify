import { describe, it, expect } from '@gjsify/unit';

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
}
