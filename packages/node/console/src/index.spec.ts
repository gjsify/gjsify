// Ported from refs/node-test/ and refs/node/test/parallel/test-console-*.js
// Original: MIT license, Node.js contributors
import { describe, it, expect } from '@gjsify/unit';
import console, { Console, log, warn, error, info } from "node:console"
import { Writable } from "node:stream"

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

		await it('should have timeLog method', async () => {
			expect(typeof console.timeLog).toBe('function');
		});

		await it('should have groupCollapsed method', async () => {
			expect(typeof console.groupCollapsed).toBe('function');
		});

		await it('should have dir method', async () => {
			expect(typeof console.dir).toBe('function');
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
			const stdoutStream = new Writable({ write(_chunk, _enc, cb) { cb(); } });
			const customConsole = new Console(stdoutStream);
			expect(customConsole instanceof Console).toBeTruthy();
		});

		await it('should be constructable with stdout and stderr streams', async () => {
			const stdoutStream = new Writable({ write(_chunk, _enc, cb) { cb(); } });
			const stderrStream = new Writable({ write(_chunk, _enc, cb) { cb(); } });
			const customConsole = new Console(stdoutStream, stderrStream);
			expect(customConsole instanceof Console).toBeTruthy();
		});

		await it('should be constructable with options object', async () => {
			const stdoutStream = new Writable({ write(_chunk, _enc, cb) { cb(); } });
			const stderrStream = new Writable({ write(_chunk, _enc, cb) { cb(); } });
			const customConsole = new Console({ stdout: stdoutStream, stderr: stderrStream });
			expect(customConsole instanceof Console).toBeTruthy();
		});

		await it('should have all standard methods', async () => {
			const stdoutStream = new Writable({ write(_chunk, _enc, cb) { cb(); } });
			const customConsole = new Console(stdoutStream);
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

		await it('should not throw on false assertion', async () => {
			// console.assert with falsy value logs an error but does not throw
			expect(() => console.assert(false)).not.toThrow();
		});

		await it('should not throw on false assertion with message args', async () => {
			expect(() => console.assert(false, 'expected to be true')).not.toThrow();
			expect(() => console.assert(false, 'msg', 42, { key: 'val' })).not.toThrow();
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

		await it('count with default label should not throw', async () => {
			expect(() => console.count()).not.toThrow();
			expect(() => console.countReset()).not.toThrow();
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

		await it('timeLog should not throw after time', async () => {
			console.time('timelog-timer');
			expect(() => console.timeLog('timelog-timer')).not.toThrow();
			console.timeEnd('timelog-timer');
		});

		await it('timeLog without matching time should not throw', async () => {
			expect(() => console.timeLog('nonexistent-timer-log')).not.toThrow();
		});

		await it('timeLog with extra args should not throw', async () => {
			console.time('timelog-extra');
			expect(() => console.timeLog('timelog-extra', 'extra', 42)).not.toThrow();
			console.timeEnd('timelog-extra');
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

		await it('groupCollapsed should not throw', async () => {
			expect(() => console.groupCollapsed('collapsed-group')).not.toThrow();
			expect(() => console.groupEnd()).not.toThrow();
		});

		await it('groupEnd without group should not throw', async () => {
			expect(() => console.groupEnd()).not.toThrow();
		});
	});

	await describe('console: log/warn/error with no args', async () => {
		await it('log with no args should not throw', async () => {
			expect(() => console.log()).not.toThrow();
		});

		await it('warn with no args should not throw', async () => {
			expect(() => console.warn()).not.toThrow();
		});

		await it('error with no args should not throw', async () => {
			expect(() => console.error()).not.toThrow();
		});

		await it('info with no args should not throw', async () => {
			expect(() => console.info()).not.toThrow();
		});

		await it('debug with no args should not throw', async () => {
			expect(() => console.debug()).not.toThrow();
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

	await describe('console: format specifiers', async () => {
		await it('log with %s string specifier should not throw', async () => {
			expect(() => console.log('hello %s', 'world')).not.toThrow();
		});

		await it('log with %d number specifier should not throw', async () => {
			expect(() => console.log('number: %d', 42)).not.toThrow();
		});

		await it('log with %i integer specifier should not throw', async () => {
			expect(() => console.log('integer: %i', 3.7)).not.toThrow();
		});

		await it('log with %o object specifier should not throw', async () => {
			expect(() => console.log('object: %o', { a: 1 })).not.toThrow();
		});

		await it('log with %j JSON specifier should not throw', async () => {
			expect(() => console.log('json: %j', { b: 2 })).not.toThrow();
		});

		await it('log with multiple specifiers should not throw', async () => {
			expect(() => console.log('%s has %d items', 'list', 5)).not.toThrow();
		});
	});

	await describe('console: table behavior', async () => {
		await it('table with array of objects should not throw', async () => {
			expect(() => console.table([{ a: 1, b: 2 }, { a: 3, b: 4 }])).not.toThrow();
		});

		await it('table with plain array should not throw', async () => {
			expect(() => console.table([1, 2, 3])).not.toThrow();
		});

		await it('table with single object should not throw', async () => {
			expect(() => console.table({ key: 'value', num: 42 })).not.toThrow();
		});
	});

	await describe('console: dir should not throw', async () => {
		await it('should accept objects', async () => {
			expect(() => console.dir({ key: 'value' })).not.toThrow();
		});

		await it('should accept options with depth', async () => {
			expect(() => console.dir({ nested: { deep: { val: 1 } } }, { depth: 0 })).not.toThrow();
		});

		await it('should accept options with colors', async () => {
			expect(() => console.dir({ key: 'value' }, { colors: false })).not.toThrow();
		});

		await it('should accept options with depth and colors', async () => {
			expect(() => console.dir({ a: 1 }, { depth: 2, colors: true })).not.toThrow();
		});
	});

	await describe('console: clear should not throw', async () => {
		await it('should not throw', async () => {
			expect(() => console.clear()).not.toThrow();
		});
	});

	await describe('console: trace behavior', async () => {
		await it('trace should not throw', async () => {
			expect(() => console.trace()).not.toThrow();
		});

		await it('trace with message should not throw', async () => {
			expect(() => console.trace('trace message')).not.toThrow();
		});

		await it('trace with multiple args should not throw', async () => {
			expect(() => console.trace('msg', 42, { key: 'val' })).not.toThrow();
		});
	});

	await describe('console: method aliases', async () => {
		await it('warn and error should both be functions', async () => {
			expect(typeof console.warn).toBe('function');
			expect(typeof console.error).toBe('function');
		});

		await it('info and log should both be functions', async () => {
			expect(typeof console.info).toBe('function');
			expect(typeof console.log).toBe('function');
		});

		await it('debug should be a function like log', async () => {
			expect(typeof console.debug).toBe('function');
		});
	});

	await describe('console: Console class stdout/stderr writing', async () => {
		await it('log should write to stdout stream', async () => {
			const output: string[] = [];
			const stdoutStream = new Writable({
				write(chunk, _enc, cb) { output.push(chunk.toString()); cb(); }
			});
			const c = new Console(stdoutStream);
			c.log('hello');
			expect(output.length).toBeGreaterThan(0);
			expect(output[0]).toContain('hello');
		});

		await it('error should write to stderr stream', async () => {
			const stdoutOutput: string[] = [];
			const stderrOutput: string[] = [];
			const stdoutStream = new Writable({
				write(chunk, _enc, cb) { stdoutOutput.push(chunk.toString()); cb(); }
			});
			const stderrStream = new Writable({
				write(chunk, _enc, cb) { stderrOutput.push(chunk.toString()); cb(); }
			});
			const c = new Console(stdoutStream, stderrStream);
			c.error('err msg');
			expect(stderrOutput.length).toBeGreaterThan(0);
			expect(stderrOutput[0]).toContain('err msg');
		});

		await it('warn should write to stderr stream', async () => {
			const stdoutOutput: string[] = [];
			const stderrOutput: string[] = [];
			const stdoutStream = new Writable({
				write(chunk, _enc, cb) { stdoutOutput.push(chunk.toString()); cb(); }
			});
			const stderrStream = new Writable({
				write(chunk, _enc, cb) { stderrOutput.push(chunk.toString()); cb(); }
			});
			const c = new Console(stdoutStream, stderrStream);
			c.warn('warn msg');
			expect(stderrOutput.length).toBeGreaterThan(0);
			expect(stderrOutput[0]).toContain('warn msg');
		});

		await it('info should write to stdout stream', async () => {
			const output: string[] = [];
			const stdoutStream = new Writable({
				write(chunk, _enc, cb) { output.push(chunk.toString()); cb(); }
			});
			const c = new Console(stdoutStream);
			c.info('info msg');
			expect(output.length).toBeGreaterThan(0);
			expect(output[0]).toContain('info msg');
		});

		await it('debug should write to stdout stream', async () => {
			const output: string[] = [];
			const stdoutStream = new Writable({
				write(chunk, _enc, cb) { output.push(chunk.toString()); cb(); }
			});
			const c = new Console(stdoutStream);
			c.debug('debug msg');
			expect(output.length).toBeGreaterThan(0);
			expect(output[0]).toContain('debug msg');
		});
	});

	await describe('console: Console class count behavior', async () => {
		await it('count should increment and write to stdout', async () => {
			const output: string[] = [];
			const stdoutStream = new Writable({
				write(chunk, _enc, cb) { output.push(chunk.toString()); cb(); }
			});
			const c = new Console(stdoutStream);
			c.count('myLabel');
			c.count('myLabel');
			expect(output.length).toBe(2);
			expect(output[0]).toContain('myLabel: 1');
			expect(output[1]).toContain('myLabel: 2');
		});

		await it('countReset should reset the counter', async () => {
			const output: string[] = [];
			const stdoutStream = new Writable({
				write(chunk, _enc, cb) { output.push(chunk.toString()); cb(); }
			});
			const c = new Console(stdoutStream);
			c.count('reset-test');
			c.count('reset-test');
			c.countReset('reset-test');
			c.count('reset-test');
			expect(output.length).toBe(3);
			expect(output[2]).toContain('reset-test: 1');
		});
	});

	await describe('console: Console class group indentation', async () => {
		await it('group should indent subsequent log output', async () => {
			const output: string[] = [];
			const stdoutStream = new Writable({
				write(chunk, _enc, cb) { output.push(chunk.toString()); cb(); }
			});
			const c = new Console(stdoutStream);
			c.log('before');
			c.group('g1');
			c.log('indented');
			c.groupEnd();
			c.log('after');
			// 'before' should not have leading spaces, 'indented' should
			expect(output[0]).toContain('before');
			// The indented line should have leading whitespace
			const indentedLine = output.find(l => l.includes('indented')) || '';
			expect(indentedLine.startsWith(' ')).toBeTruthy();
			// 'after' should not start with spaces
			const afterLine = output[output.length - 1];
			expect(afterLine).toContain('after');
		});
	});

	await describe('console: Console class assert behavior', async () => {
		await it('assert with false should write to stderr without throwing', async () => {
			const stderrOutput: string[] = [];
			const stdoutStream = new Writable({
				write(_chunk, _enc, cb) { cb(); }
			});
			const stderrStream = new Writable({
				write(chunk, _enc, cb) { stderrOutput.push(chunk.toString()); cb(); }
			});
			const c = new Console(stdoutStream, stderrStream);
			expect(() => c.assert(false, 'test assertion')).not.toThrow();
			expect(stderrOutput.length).toBeGreaterThan(0);
			expect(stderrOutput[0]).toContain('Assertion failed');
		});

		await it('assert with true should not write anything', async () => {
			const stderrOutput: string[] = [];
			const stdoutStream = new Writable({
				write(_chunk, _enc, cb) { cb(); }
			});
			const stderrStream = new Writable({
				write(chunk, _enc, cb) { stderrOutput.push(chunk.toString()); cb(); }
			});
			const c = new Console(stdoutStream, stderrStream);
			c.assert(true, 'should not appear');
			expect(stderrOutput.length).toBe(0);
		});
	});

	await describe('console: Console class trace behavior', async () => {
		await it('trace should write to stderr stream', async () => {
			const stderrOutput: string[] = [];
			const stdoutStream = new Writable({
				write(_chunk, _enc, cb) { cb(); }
			});
			const stderrStream = new Writable({
				write(chunk, _enc, cb) { stderrOutput.push(chunk.toString()); cb(); }
			});
			const c = new Console(stdoutStream, stderrStream);
			c.trace('trace test');
			expect(stderrOutput.length).toBeGreaterThan(0);
			expect(stderrOutput[0]).toContain('Trace');
		});
	});

	await describe('console: Console class time/timeLog behavior', async () => {
		await it('timeLog should write elapsed time to stdout', async () => {
			const output: string[] = [];
			const stdoutStream = new Writable({
				write(chunk, _enc, cb) { output.push(chunk.toString()); cb(); }
			});
			const c = new Console(stdoutStream);
			c.time('perf');
			c.timeLog('perf');
			c.timeEnd('perf');
			expect(output.length).toBe(2);
			expect(output[0]).toContain('perf:');
			expect(output[1]).toContain('perf:');
		});
	});
}
