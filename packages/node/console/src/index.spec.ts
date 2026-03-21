import { describe, it, expect } from '@gjsify/unit';
import console, { Console, log, warn, error, info } from "console"

export default async () => {
	await describe('console: default import', async () => {
		await it('should be an object', async () => {
			expect(console instanceof Object).toBeTruthy();
		});

		await it('should have log method', async () => {
			expect(typeof console.log).toBe('function');
		});

		await it('should have warn method', async () => {
			expect(typeof console.warn).toBe('function');
		});

		await it('should have error method', async () => {
			expect(typeof console.error).toBe('function');
		});

		await it('should have info method', async () => {
			expect(typeof console.info).toBe('function');
		});

		await it('should have debug method', async () => {
			expect(typeof console.debug).toBe('function');
		});

		await it('should have table method', async () => {
			expect(typeof console.table).toBe('function');
		});

		await it('should have time method', async () => {
			expect(typeof console.time).toBe('function');
		});

		await it('should have timeEnd method', async () => {
			expect(typeof console.timeEnd).toBe('function');
		});

		await it('should have trace method', async () => {
			expect(typeof console.trace).toBe('function');
		});

		await it('should have assert method', async () => {
			expect(typeof console.assert).toBe('function');
		});

		await it('should have clear method', async () => {
			expect(typeof console.clear).toBe('function');
		});

		await it('should have count method', async () => {
			expect(typeof console.count).toBe('function');
		});

		await it('should have countReset method', async () => {
			expect(typeof console.countReset).toBe('function');
		});

		await it('should have group method', async () => {
			expect(typeof console.group).toBe('function');
		});

		await it('should have groupEnd method', async () => {
			expect(typeof console.groupEnd).toBe('function');
		});
	});

	await describe('console: named exports', async () => {
		await it('should export log function', async () => {
			expect(typeof log).toBe('function');
		});

		await it('should export warn function', async () => {
			expect(typeof warn).toBe('function');
		});

		await it('should export error function', async () => {
			expect(typeof error).toBe('function');
		});

		await it('should export info function', async () => {
			expect(typeof info).toBe('function');
		});
	});

	await describe('console: Console class', async () => {
		await it('should export Console constructor', async () => {
			expect(typeof Console).toBe('function');
		});

		await it('should be an instance of Console when constructed', async () => {
			const output: string[] = [];
			const customConsole = new Console({
				write: (data: string) => { output.push(data); }
			});
			expect(customConsole instanceof Console).toBeTruthy();
		});

		await it('should be constructable with stream-like objects', async () => {
			// The Console constructor signature accepts stdout/stderr streams.
			// On Node.js, streams need full Writable interface;
			// on GJS our implementation accepts simpler objects.
			// Just verify it constructs without errors.
			const customConsole = new Console({
				write: () => true,
				removeListener: () => {},
				on: () => {},
				once: () => {},
				emit: () => {},
			} as any);
			expect(customConsole instanceof Console).toBeTruthy();
		});

		await it('should have all standard methods', async () => {
			const customConsole = new Console({
				write: () => {}
			});
			expect(typeof customConsole.log).toBe('function');
			expect(typeof customConsole.warn).toBe('function');
			expect(typeof customConsole.error).toBe('function');
			expect(typeof customConsole.info).toBe('function');
			expect(typeof customConsole.debug).toBe('function');
			expect(typeof customConsole.time).toBe('function');
			expect(typeof customConsole.timeEnd).toBe('function');
			expect(typeof customConsole.count).toBe('function');
			expect(typeof customConsole.countReset).toBe('function');
			expect(typeof customConsole.group).toBe('function');
			expect(typeof customConsole.groupEnd).toBe('function');
		});
	});
}
