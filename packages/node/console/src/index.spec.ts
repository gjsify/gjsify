// Ported from refs/node-test/ and refs/node/test/parallel/test-console-*.js
// Original: MIT license, Node.js contributors
import { describe, it, expect, on } from '@gjsify/unit';
import console, { Console, log, warn, error, info } from 'node:console';
import { Writable } from 'node:stream';

/** An Error subclass that assigns `name` and carries an extra own enumerable
 * property — the shape whose message and stack `JSON.stringify` dropped. */
class TaggedError extends Error {
    code: string;
    constructor(message: string, code: string) {
        super(message);
        this.name = 'GtkHostError';
        this.code = code;
    }
}

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
            const stdoutStream = new Writable({
                write(_chunk, _enc, cb) {
                    cb();
                },
            });
            const customConsole = new Console(stdoutStream);
            expect(customConsole instanceof Console).toBeTruthy();
        });

        await it('should be constructable with stdout and stderr streams', async () => {
            const stdoutStream = new Writable({
                write(_chunk, _enc, cb) {
                    cb();
                },
            });
            const stderrStream = new Writable({
                write(_chunk, _enc, cb) {
                    cb();
                },
            });
            const customConsole = new Console(stdoutStream, stderrStream);
            expect(customConsole instanceof Console).toBeTruthy();
        });

        await it('should be constructable with options object', async () => {
            const stdoutStream = new Writable({
                write(_chunk, _enc, cb) {
                    cb();
                },
            });
            const stderrStream = new Writable({
                write(_chunk, _enc, cb) {
                    cb();
                },
            });
            const customConsole = new Console({ stdout: stdoutStream, stderr: stderrStream });
            expect(customConsole instanceof Console).toBeTruthy();
        });

        await it('should have all standard methods', async () => {
            const stdoutStream = new Writable({
                write(_chunk, _enc, cb) {
                    cb();
                },
            });
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
            expect(() =>
                console.table([
                    { a: 1, b: 2 },
                    { a: 3, b: 4 },
                ]),
            ).not.toThrow();
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
                write(chunk, _enc, cb) {
                    output.push(chunk.toString());
                    cb();
                },
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
                write(chunk, _enc, cb) {
                    stdoutOutput.push(chunk.toString());
                    cb();
                },
            });
            const stderrStream = new Writable({
                write(chunk, _enc, cb) {
                    stderrOutput.push(chunk.toString());
                    cb();
                },
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
                write(chunk, _enc, cb) {
                    stdoutOutput.push(chunk.toString());
                    cb();
                },
            });
            const stderrStream = new Writable({
                write(chunk, _enc, cb) {
                    stderrOutput.push(chunk.toString());
                    cb();
                },
            });
            const c = new Console(stdoutStream, stderrStream);
            c.warn('warn msg');
            expect(stderrOutput.length).toBeGreaterThan(0);
            expect(stderrOutput[0]).toContain('warn msg');
        });

        await it('info should write to stdout stream', async () => {
            const output: string[] = [];
            const stdoutStream = new Writable({
                write(chunk, _enc, cb) {
                    output.push(chunk.toString());
                    cb();
                },
            });
            const c = new Console(stdoutStream);
            c.info('info msg');
            expect(output.length).toBeGreaterThan(0);
            expect(output[0]).toContain('info msg');
        });

        await it('debug should write to stdout stream', async () => {
            const output: string[] = [];
            const stdoutStream = new Writable({
                write(chunk, _enc, cb) {
                    output.push(chunk.toString());
                    cb();
                },
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
                write(chunk, _enc, cb) {
                    output.push(chunk.toString());
                    cb();
                },
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
                write(chunk, _enc, cb) {
                    output.push(chunk.toString());
                    cb();
                },
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
                write(chunk, _enc, cb) {
                    output.push(chunk.toString());
                    cb();
                },
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
            const indentedLine = output.find((l) => l.includes('indented')) || '';
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
                write(_chunk, _enc, cb) {
                    cb();
                },
            });
            const stderrStream = new Writable({
                write(chunk, _enc, cb) {
                    stderrOutput.push(chunk.toString());
                    cb();
                },
            });
            const c = new Console(stdoutStream, stderrStream);
            expect(() => c.assert(false, 'test assertion')).not.toThrow();
            expect(stderrOutput.length).toBeGreaterThan(0);
            expect(stderrOutput[0]).toContain('Assertion failed');
        });

        await it('assert with true should not write anything', async () => {
            const stderrOutput: string[] = [];
            const stdoutStream = new Writable({
                write(_chunk, _enc, cb) {
                    cb();
                },
            });
            const stderrStream = new Writable({
                write(chunk, _enc, cb) {
                    stderrOutput.push(chunk.toString());
                    cb();
                },
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
                write(_chunk, _enc, cb) {
                    cb();
                },
            });
            const stderrStream = new Writable({
                write(chunk, _enc, cb) {
                    stderrOutput.push(chunk.toString());
                    cb();
                },
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
                write(chunk, _enc, cb) {
                    output.push(chunk.toString());
                    cb();
                },
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

    // Rendering an Error through this module used to go through `JSON.stringify`,
    // which keeps only own ENUMERABLE properties — `message` and `stack` are
    // neither — so `console.error(new Error('boom'))` printed `{}`, and a subclass
    // carrying a code printed `{"name":"GtkHostError","code":"unknown-tag"}`: the
    // code and nothing else. Everything here goes through the custom-stream path,
    // the only one that reaches our formatter — with no stream the Node leg
    // delegates straight to the host console.
    //
    // This describe holds what is true of NODE's console as well as ours, so the
    // Node leg proves the assertions describe real console behaviour. Our own
    // rendering VOCABULARY (JSON, not util.inspect) is pinned in the `on('Gjs')`
    // block below.
    await describe('console: Error formatting', async () => {
        const capture = () => {
            const lines: string[] = [];
            const stream = new Writable({
                write(chunk, _enc, cb) {
                    lines.push(chunk.toString());
                    cb();
                },
            });
            return { lines, console: new Console(stream, stream) };
        };
        // Non-empty rendered lines, so the trailing newline never counts as one.
        const renderedLines = (chunk: string) => chunk.split('\n').filter((l) => l.length > 0);

        await it('should render name, message and stack of an Error', async () => {
            const c = capture();
            c.console.error(new Error('boom'));
            expect(c.lines.length).toBe(1);
            const lines = renderedLines(c.lines[0]);
            expect(lines[0]).toBe('Error: boom');
            // The stack follows. V8 prefixes `err.stack` with `Name: message`,
            // SpiderMonkey does not — frames only, measured on gjs 1.88.1 — so a
            // renderer that just prints `err.stack` drops the message there.
            expect(lines.length).toBeGreaterThan(1);
        });

        await it('should render an Error whose stack is absent', async () => {
            const err = new Error('stackless');
            err.stack = undefined;
            const c = capture();
            c.console.error(err);
            expect(c.lines[0]).toContain('Error');
            expect(c.lines[0]).toContain('stackless');
        });

        await it('should keep extra own enumerable properties of an Error subclass', async () => {
            const c = capture();
            c.console.error(new TaggedError('No descriptor registered for <div>', 'unknown-tag'));
            const rendered = c.lines[0];
            expect(rendered).toContain('GtkHostError');
            // The MESSAGE is what the old formatter dropped while keeping the code.
            expect(rendered).toContain('No descriptor registered for <div>');
            expect(rendered).toContain('code');
            expect(rendered).toContain('unknown-tag');
        });

        await it('should render an Error passed after a message', async () => {
            const c = capture();
            c.console.error('context:', new Error('boom'));
            expect(c.lines[0]).toContain('context: Error: boom');
        });

        await it('should render an Error nested in an array', async () => {
            const c = capture();
            c.console.log([new Error('inner')]);
            expect(c.lines[0]).toContain('Error: inner');
        });

        await it('should render an Error nested in an object', async () => {
            const c = capture();
            c.console.log({ err: new Error('inner') });
            expect(c.lines[0]).toContain('Error: inner');
        });

        await it('should render error.cause', async () => {
            const c = capture();
            c.console.error(new Error('outer', { cause: new Error('root cause') }));
            const rendered = c.lines[0];
            expect(rendered).toContain('Error: outer');
            expect(rendered).toContain('[cause]');
            expect(rendered).toContain('Error: root cause');
        });

        await it('should render the errors of an AggregateError', async () => {
            const c = capture();
            c.console.error(new AggregateError([new Error('first'), new Error('second')], 'all failed'));
            const rendered = c.lines[0];
            expect(rendered).toContain('AggregateError: all failed');
            expect(rendered).toContain('[errors]');
            expect(rendered).toContain('Error: first');
            expect(rendered).toContain('Error: second');
        });

        await it('should not hang on a cyclic cause chain', async () => {
            const a = new Error('A');
            const b = new Error('B');
            a.cause = b;
            b.cause = a;
            const c = capture();
            c.console.error(a);
            const rendered = c.lines[0];
            expect(rendered).toContain('Error: A');
            expect(rendered).toContain('Error: B');
            expect(rendered).toContain('Circular');
        });

        await it('should survive a circular plain object instead of throwing', async () => {
            const cyclic: Record<string, unknown> = {};
            cyclic.self = cyclic;
            const c = capture();
            // A console that throws while reporting is worse than one that reports
            // imprecisely; `JSON.stringify` throws TypeError on this input.
            expect(() => c.console.log(cyclic)).not.toThrow();
            expect(c.lines.length).toBe(1);
        });

        await it('should render an Error for the %s specifier', async () => {
            const c = capture();
            c.console.log('%s', new Error('spec-s'));
            const lines = renderedLines(c.lines[0]);
            expect(lines[0]).toBe('Error: spec-s');
            // Node prints the STACK for `%s` of an Error, not `String(err)`.
            expect(lines.length).toBeGreaterThan(1);
        });

        await it('should render an Error for the %o and %O specifiers', async () => {
            const lower = capture();
            lower.console.log('%o', new Error('spec-o'));
            expect(lower.lines[0]).toContain('Error: spec-o');
            const upper = capture();
            upper.console.log('%O', new Error('spec-O'));
            expect(upper.lines[0]).toContain('Error: spec-O');
        });

        await it('should render a repeated Error in full, not as circular', async () => {
            const err = new Error('twice');
            const c = capture();
            c.console.log([err, err]);
            const occurrences = c.lines[0].split('Error: twice').length - 1;
            expect(occurrences).toBe(2);
        });
    });

    await on('Gjs', async () => {
        // The exact rendering vocabulary of THIS implementation: JSON for values,
        // `Name: message` + stack + own-property JSON for an Error. Node's console
        // renders through `util.inspect` instead, so these shapes can only be
        // pinned on the GJS leg — where `node:console` IS this package.
        await describe('console: Error rendering shape', async () => {
            const render = (...args: unknown[]) => {
                const lines: string[] = [];
                const stream = new Writable({
                    write(chunk, _enc, cb) {
                        lines.push(chunk.toString());
                        cb();
                    },
                });
                new Console(stream, stream).error(...args);
                return lines[0].replace(/\n$/, '');
            };

            await it('should head the render with `Name: message`', async () => {
                const rendered = render(new TaggedError('No descriptor registered for <div>', 'unknown-tag'));
                expect(rendered.split('\n')[0]).toBe('GtkHostError: No descriptor registered for <div>');
            });

            await it('should append only the extra own properties as JSON', async () => {
                const rendered = render(new TaggedError('No descriptor registered for <div>', 'unknown-tag'));
                expect(rendered).toContain('{"code":"unknown-tag"}');
                // `name` belongs to the header; repeating it in the property object
                // is the shape the old formatter produced INSTEAD of the message.
                expect(rendered).not.toContain('"name":"GtkHostError"');
            });

            await it('should mark each aggregated error with its index', async () => {
                const rendered = render(new AggregateError([new Error('first'), new Error('second')], 'all failed'));
                expect(rendered).toContain('[errors][0]:');
                expect(rendered).toContain('[errors][1]:');
            });

            await it('should name the error a cyclic cause chain returns to', async () => {
                const a = new Error('A');
                const b = new Error('B');
                a.cause = b;
                b.cause = a;
                expect(render(a)).toContain('[Circular Error: A]');
            });

            await it('should report an unserializable value as such', async () => {
                const cyclic: Record<string, unknown> = {};
                cyclic.self = cyclic;
                expect(render(cyclic)).toContain('[unserializable');
            });

            // Compatibility ratchet: the Error fix must leave every other value
            // type byte-identical. These are the shapes the module produced before.
            await it('should JSON-render objects, arrays and primitives unchanged', async () => {
                expect(render({ a: 1, b: [1, 2] })).toBe('{"a":1,"b":[1,2]}');
                expect(render([1, 'two', null])).toBe('[1,"two",null]');
                expect(render(42)).toBe('42');
                expect(render(null)).toBe('null');
                expect(render(true)).toBe('true');
                expect(render('plain')).toBe('plain');
                expect(render('a', { b: 2 }, 'c')).toBe('a {"b":2} c');
            });

            await it('should keep the numeric and object specifiers unchanged', async () => {
                expect(render('%d', 3.7)).toBe('3');
                expect(render('%i', 3.7)).toBe('3');
                expect(render('%f', '2.5')).toBe('2.5');
                expect(render('%s', 42)).toBe('42');
                expect(render('%o', { a: 1 })).toBe('{"a":1}');
                expect(render('%c', 'color:red')).toBe('');
            });
        });
    });
};
