import { describe, it, expect } from '@gjsify/unit';

import { EventEmitter } from 'events';

export default async () => {

	// Credits https://github.com/EventEmitter2/EventEmitter2/blob/master/test/simple/emit.js
	await describe('events.EventEmitter: emit', async () => {
		await it('1. Add two listeners on a single event and emit the event', async () => {
			var emitter = new EventEmitter();
			let count = 0;

			function functionA() { count++; }
			function functionB() { count++ }
		
			emitter.on('test2', functionA);
			emitter.on('test2', functionB);
		
			emitter.emit('test2');
		
			expect(count).toBe(2);
		});

		await it('2. Add two listeners on a single event and emit the event twice', async () => {
			var emitter = new EventEmitter();
			let count = 0;

			function functionA() {count++ }
			function functionB() { count++ }
		
			emitter.on('test2', functionA);
			emitter.on('test2', functionB);
		
			emitter.emit('test2');
			emitter.emit('test2');
		
			expect(count).toBe(4);
		});

		await it('3. Add two listeners on a single event and emit the event with a parameter', async () => {
			var emitter = new EventEmitter();
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
			var emitter = new EventEmitter();
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
	});
}
