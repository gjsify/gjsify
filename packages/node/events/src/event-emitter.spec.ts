import { describe, it, expect } from '@gjsify/unit';

import { EventEmitter } from 'events';

export default async () => {

	// Credits https://github.com/EventEmitter2/EventEmitter2/blob/master/test/simple/emit.js
	// TODO port more tests

	await describe('events.EventEmitter: emit', async () => {
		await it('1. Add two listeners on a single event and emit the event', async () => {
			var emitter = new EventEmitter({ verbose: true } as any);
			let count = 0;

			function functionA() { count++; }
			function functionB() { count++ }

			emitter.on('test2', functionA);
			emitter.on('test2', functionB);

			emitter.emit('test2');

			expect(count).toBe(2);
		});

		await it('2. Add two listeners on a single event and emit the event twice', async () => {
			var emitter = new EventEmitter({ verbose: true } as any);
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
			var emitter = new EventEmitter({ verbose: true } as any);
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
			var emitter = new EventEmitter({ verbose: true } as any);
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

			var emitter = new EventEmitter({ verbose: true } as any);
			let count = 0;

			function functionA(value1: string, value2: string, value3: string) {
				count++;
				expect(true).toBeTruthy(); // 'The event was raised';
				expect(typeof value1).toBe('string');
				expect(typeof value2).toBe('string');
				expect(typeof value3).toBe('string');
			}

			function functionB(value1: string, value2: string, value3: string) {
				count++;
				expect(true).toBeTruthy(); // 'The event was raised';
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
			var emitter = new EventEmitter({ verbose: true } as any);

			function functionA() {
				count++;
				expect(true).toBeTruthy(); // 'The event was raised'
			}

			emitter.on('test6', functionA);

			expect(emitter.emit('test6')).toBeTruthy(); // 'emit should return true after calling a listener'
			expect(emitter.emit('other')).toBeFalsy(); // 'emit should return false when no listener was called'

			// The original implementation has no onAny method
			expect(() => {
				(emitter as any).onAny(functionA);
			}).toThrow();

			expect(emitter.emit('other')).toBeFalsy(); // 'emit should return false without the onAny() listener'

			expect(count).toBe(1);
		});

		await it('7. Emit event with more than 2 arguments', async () => {
			let count = 0;
			var emitter = new EventEmitter({ verbose: true } as any);

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
