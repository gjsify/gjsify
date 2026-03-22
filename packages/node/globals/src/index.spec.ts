import { describe, it, expect } from '@gjsify/unit';

export default async () => {
	await describe('global', async () => {
		await it('should be the same as globalThis', async () => {
			expect((globalThis as any).global).toBe(globalThis);
		});
	});

	await describe('process', async () => {
		await it('should be defined on globalThis', async () => {
			expect(typeof (globalThis as any).process).toBe('object');
		});

		await it('should have env', async () => {
			expect(typeof (globalThis as any).process.env).toBe('object');
		});

		await it('should have cwd function', async () => {
			expect(typeof (globalThis as any).process.cwd).toBe('function');
		});
	});

	await describe('Buffer', async () => {
		await it('should be defined on globalThis', async () => {
			expect(typeof (globalThis as any).Buffer).toBe('function');
		});

		await it('should create a buffer from string', async () => {
			const buf = (globalThis as any).Buffer.from('hello');
			expect(buf.toString()).toBe('hello');
		});
	});

	await describe('setImmediate', async () => {
		await it('should be a function', async () => {
			expect(typeof setImmediate).toBe('function');
		});

		await it('should call the callback asynchronously', async () => {
			const result = await new Promise<string>((resolve) => {
				setImmediate(() => resolve('called'));
			});
			expect(result).toBe('called');
		});

		await it('should pass arguments to callback', async () => {
			const result = await new Promise<number>((resolve) => {
				setImmediate((a: number, b: number) => resolve(a + b), 2, 3);
			});
			expect(result).toBe(5);
		});
	});

	await describe('clearImmediate', async () => {
		await it('should be a function', async () => {
			expect(typeof clearImmediate).toBe('function');
		});

		await it('should cancel a pending setImmediate', async () => {
			let called = false;
			const id = setImmediate(() => { called = true; });
			clearImmediate(id);
			await new Promise<void>((resolve) => setTimeout(resolve, 10));
			expect(called).toBe(false);
		});
	});

	await describe('queueMicrotask', async () => {
		await it('should be a function', async () => {
			expect(typeof queueMicrotask).toBe('function');
		});

		await it('should execute callback as a microtask', async () => {
			const result = await new Promise<string>((resolve) => {
				queueMicrotask(() => resolve('microtask'));
			});
			expect(result).toBe('microtask');
		});
	});

	await describe('Error.captureStackTrace', async () => {
		await it('should be a function', async () => {
			expect(typeof (Error as any).captureStackTrace).toBe('function');
		});

		await it('should add a stack property to the target object', async () => {
			const obj: any = {};
			(Error as any).captureStackTrace(obj);
			expect(typeof obj.stack).toBe('string');
		});
	});
};
