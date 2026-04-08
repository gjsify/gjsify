// Legacy `.call(this)` + `util.inherits(Sub, EventEmitter)` compatibility tests.
//
// Regression coverage for the `makeCallable` Proxy wrapper in @gjsify/utils:
// `EventEmitter.call(this)` from CJS consumers must not throw
// "TypeError: Class constructor EventEmitter cannot be invoked without 'new'".
//
// Ported from refs/node-test/parallel/test-util-inherits.js
// Original: MIT license, Node.js contributors
// Modifications: adapted to @gjsify/unit, scoped to EventEmitter.

import { describe, it, expect } from '@gjsify/unit';
import { EventEmitter } from 'node:events';
import { inherits } from 'node:util';

export default async () => {
	await describe('EventEmitter.makeCallable: new invocation still works', async () => {
		await it('new EventEmitter() returns a valid instance', async () => {
			const ee = new EventEmitter();
			expect(typeof ee.on).toBe('function');
			expect(typeof ee.emit).toBe('function');
			expect(typeof ee.removeListener).toBe('function');
			expect(ee instanceof EventEmitter).toBe(true);
		});

		await it('instance methods are available after new', async () => {
			const ee = new EventEmitter();
			const results: string[] = [];
			ee.on('data', (v: string) => results.push(v));
			ee.emit('data', 'hello');
			expect(results).toEqualArray(['hello']);
		});

		await it('EventEmitter.prototype is accessible', async () => {
			expect(typeof (EventEmitter as any).prototype).toBe('object');
			expect(typeof (EventEmitter as any).prototype.on).toBe('function');
			expect(typeof (EventEmitter as any).prototype.emit).toBe('function');
		});

		await it('instanceof works after new', async () => {
			const ee = new EventEmitter();
			expect(ee instanceof EventEmitter).toBe(true);
		});
	});

	await describe('EventEmitter.makeCallable: EventEmitter.call(this)', async () => {
		await it('EventEmitter.call(plain) assigns EventEmitter state', async () => {
			const plain: any = Object.create((EventEmitter as any).prototype);
			(EventEmitter as any).call(plain);
			// After .call(), the instance should be usable as an EventEmitter
			let received: string | undefined;
			plain.on('ping', (msg: string) => { received = msg; });
			plain.emit('ping', 'pong');
			expect(received).toBe('pong');
		});

		await it('EventEmitter.call(this) does not throw', async () => {
			let threw = false;
			try {
				const ctx: any = Object.create((EventEmitter as any).prototype);
				(EventEmitter as any).call(ctx);
			} catch {
				threw = true;
			}
			expect(threw).toBe(false);
		});

		await it('EventEmitter.call(this) — resulting object has on/emit/removeListener', async () => {
			const ctx: any = Object.create((EventEmitter as any).prototype);
			(EventEmitter as any).call(ctx);
			expect(typeof ctx.on).toBe('function');
			expect(typeof ctx.emit).toBe('function');
			expect(typeof ctx.removeListener).toBe('function');
		});
	});

	await describe('EventEmitter.makeCallable: util.inherits pattern', async () => {
		await it('util.inherits(Sub, EventEmitter) + Sub.call pattern', async () => {
			function MyEmitter(this: any) {
				(EventEmitter as any).call(this);
				this.name = 'my-emitter';
			}
			inherits(MyEmitter as any, EventEmitter as any);

			const ee: any = new (MyEmitter as any)();
			expect(ee.name).toBe('my-emitter');
			expect(typeof ee.on).toBe('function');
			expect(typeof ee.emit).toBe('function');
			expect(ee instanceof EventEmitter).toBe(true);
		});

		await it('events emitted by inherits-based subclass work correctly', async () => {
			function Counter(this: any) {
				(EventEmitter as any).call(this);
				this.count = 0;
			}
			inherits(Counter as any, EventEmitter as any);
			(Counter.prototype as any).increment = function(this: any) {
				this.count++;
				this.emit('incremented', this.count);
			};

			const c: any = new (Counter as any)();
			const received: number[] = [];
			c.on('incremented', (n: number) => received.push(n));
			c.increment();
			c.increment();
			c.increment();
			expect(c.count).toBe(3);
			expect(received).toEqualArray([1, 2, 3]);
		});

		await it('multi-level inherits (A extends EE, B extends A)', async () => {
			function A(this: any) {
				(EventEmitter as any).call(this);
				this.levelA = true;
			}
			inherits(A as any, EventEmitter as any);

			function B(this: any) {
				(A as any).call(this);
				this.levelB = true;
			}
			inherits(B as any, A as any);

			const b: any = new (B as any)();
			expect(b.levelA).toBe(true);
			expect(b.levelB).toBe(true);
			expect(typeof b.on).toBe('function');
			expect(b instanceof EventEmitter).toBe(true);
		});

		await it('once() works on inherits-based subclass', async () => {
			function OneShot(this: any) {
				(EventEmitter as any).call(this);
			}
			inherits(OneShot as any, EventEmitter as any);

			const os: any = new (OneShot as any)();
			let callCount = 0;
			os.once('event', () => callCount++);
			os.emit('event');
			os.emit('event'); // second emit should be ignored
			expect(callCount).toBe(1);
		});
	});
};
