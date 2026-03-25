import { describe, it, expect } from '@gjsify/unit';
import console, { Console, log, warn, error, info } from "node:console"

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

	// ==================== behavioral tests ====================

	await describe('console: assert behavior', async () => {
		await it('should not throw on truthy assertion', async () => {
			expect(() => console.assert(true)).not.toThrow();
			expect(() => console.assert(1)).not.toThrow();
			expect(() => console.assert('non-empty')).not.toThrow();
		});
	});

	await describe('console: count/countReset behavior', async () => {
		await it('count should not throw', async () => {
			expect(() => console.count('test-label')).not.toThrow();
			expect(() => console.count('test-label')).not.toThrow();
		});

		await it('countReset should not throw', async () => {
			expect(() => console.countReset('test-label')).not.toThrow();
		});
	});

	await describe('console: time/timeEnd behavior', async () => {
		await it('time and timeEnd should not throw', async () => {
			expect(() => console.time('test-timer')).not.toThrow();
			expect(() => console.timeEnd('test-timer')).not.toThrow();
		});

		await it('timeEnd without time should not throw', async () => {
			expect(() => console.timeEnd('nonexistent-timer')).not.toThrow();
		});
	});

	await describe('console: group/groupEnd behavior', async () => {
		await it('group and groupEnd should not throw', async () => {
			expect(() => console.group('test-group')).not.toThrow();
			expect(() => console.groupEnd()).not.toThrow();
		});

		await it('nested groups should not throw', async () => {
			expect(() => {
				console.group('outer');
				console.group('inner');
				console.groupEnd();
				console.groupEnd();
			}).not.toThrow();
		});
	});

	await describe('console: log/warn/error should not throw', async () => {
		await it('log should handle various argument types', async () => {
			expect(() => console.log('string')).not.toThrow();
			expect(() => console.log(42)).not.toThrow();
			expect(() => console.log({ key: 'value' })).not.toThrow();
			expect(() => console.log(null)).not.toThrow();
			expect(() => console.log(undefined)).not.toThrow();
			expect(() => console.log([1, 2, 3])).not.toThrow();
		});

		await it('log should handle multiple arguments', async () => {
			expect(() => console.log('a', 'b', 'c')).not.toThrow();
		});

		await it('warn should not throw', async () => {
			expect(() => console.warn('warning')).not.toThrow();
		});

		await it('error should not throw', async () => {
			expect(() => console.error('error')).not.toThrow();
		});
	});

	await describe('console: dir should not throw', async () => {
		await it('should accept objects', async () => {
			expect(() => console.dir({ key: 'value' })).not.toThrow();
		});
	});

	await describe('console: clear should not throw', async () => {
		await it('should not throw', async () => {
			expect(() => console.clear()).not.toThrow();
		});
	});
}
