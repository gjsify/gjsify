// Browser-target spec for @gjsify/process.
//
// The standard `index.spec.ts` / `extended.spec.ts` assert host-process values
// (pid > 0, version starts with 'v', process.env.PATH defined, memoryUsage().rss
// > 0, chdir() round-trips, EventEmitter actually emits, …) that only hold under
// Node/GJS. The browser entry (`./browser.ts`) is the minimal defunctzombie-style
// shim: pid/ppid are 0, version/env are empty, platform/arch are 'browser', cwd()
// is '/', chdir()/exit()/abort() throw, the EventEmitter surface is a no-op, and
// the stream stubs only expose a structural subset.
//
// This reduced spec imports the browser impl directly and asserts only what is
// true under `gjsify build --app browser`.

import { describe, it, expect } from '@gjsify/unit';
import process from './browser.js';

export default async () => {
    await describe('process (browser): identity', async () => {
        await it('platform should be "browser"', async () => {
            expect(process.platform).toBe('browser');
        });

        await it('arch should be "browser"', async () => {
            expect(process.arch).toBe('browser');
        });

        await it('browser flag should be true', async () => {
            expect(process.browser).toBe(true);
        });

        await it('title should be "browser"', async () => {
            expect(process.title).toBe('browser');
        });

        await it('pid should be 0', async () => {
            expect(process.pid).toBe(0);
        });

        await it('ppid should be 0', async () => {
            expect(process.ppid).toBe(0);
        });

        await it('version should be an empty string', async () => {
            expect(process.version).toBe('');
        });

        await it('versions should be an empty object', async () => {
            expect(typeof process.versions).toBe('object');
            expect(Object.keys(process.versions).length).toBe(0);
        });

        await it('argv should be an empty array', async () => {
            expect(Array.isArray(process.argv)).toBeTruthy();
            expect(process.argv.length).toBe(0);
        });

        await it('execArgv should be an empty array', async () => {
            expect(Array.isArray(process.execArgv)).toBeTruthy();
            expect(process.execArgv.length).toBe(0);
        });

        await it('argv0 should be "browser"', async () => {
            expect(process.argv0).toBe('browser');
        });

        await it('execPath should be an empty string', async () => {
            expect(process.execPath).toBe('');
        });

        await it('config should be an object', async () => {
            expect(typeof process.config).toBe('object');
        });
    });

    await describe('process (browser): env', async () => {
        await it('env should be an (empty) object', async () => {
            expect(typeof process.env).toBe('object');
            expect(Object.keys(process.env).length).toBe(0);
        });

        await it('should set, read and delete env variables', async () => {
            process.env.TEST_GJSIFY_VAR = 'test_value';
            expect(process.env.TEST_GJSIFY_VAR).toBe('test_value');
            delete process.env.TEST_GJSIFY_VAR;
            expect(process.env.TEST_GJSIFY_VAR).toBeUndefined();
        });
    });

    await describe('process (browser): cwd / lifecycle', async () => {
        await it('cwd() should return "/"', async () => {
            expect(process.cwd()).toBe('/');
        });

        await it('umask() should return 0', async () => {
            expect(process.umask()).toBe(0);
        });

        await it('chdir() should throw (unsupported)', async () => {
            const fn = () => process.chdir('/tmp');
            expect(fn).toThrow();
        });

        await it('exit() should throw (unsupported)', async () => {
            const fn = () => process.exit(0);
            expect(fn).toThrow();
        });

        await it('abort() should throw (unsupported)', async () => {
            const fn = () => process.abort();
            expect(fn).toThrow();
        });

        await it('kill() should return false', async () => {
            expect(process.kill(0)).toBe(false);
        });

        await it('binding() should throw (unsupported)', async () => {
            const fn = () => process.binding('os');
            expect(fn).toThrow();
        });
    });

    await describe('process (browser): timing', async () => {
        await it('uptime() should be 0', async () => {
            expect(process.uptime()).toBe(0);
        });

        await it('hrtime() should return [0, 0]', async () => {
            const hr = process.hrtime();
            expect(Array.isArray(hr)).toBeTruthy();
            expect(hr.length).toBe(2);
            expect(hr[0]).toBe(0);
            expect(hr[1]).toBe(0);
        });

        await it('hrtime.bigint() should return 0n', async () => {
            expect(process.hrtime.bigint()).toBe(0n);
        });

        await it('memoryUsage() should return zeroed fields', async () => {
            const mem = process.memoryUsage();
            expect(mem.rss).toBe(0);
            expect(mem.heapTotal).toBe(0);
            expect(mem.heapUsed).toBe(0);
            expect(mem.external).toBe(0);
        });

        await it('cpuUsage() should return zeroed user/system', async () => {
            const usage = process.cpuUsage();
            expect(usage.user).toBe(0);
            expect(usage.system).toBe(0);
        });
    });

    await describe('process (browser): nextTick', async () => {
        await it('should be a function', async () => {
            expect(typeof process.nextTick).toBe('function');
        });

        await it('should be deferred, not synchronous', async () => {
            let ranInNextTick = false;
            process.nextTick(() => {
                ranInNextTick = true;
            });
            const ranSynchronously = !ranInNextTick;
            await new Promise<void>((resolve) => process.nextTick(resolve));
            expect(ranSynchronously).toBeTruthy();
            expect(ranInNextTick).toBeTruthy();
        });

        await it('should execute callbacks in FIFO order', async () => {
            const order: number[] = [];
            await new Promise<void>((resolve) => {
                process.nextTick(() => order.push(1));
                process.nextTick(() => order.push(2));
                process.nextTick(() => {
                    order.push(3);
                    resolve();
                });
            });
            expect(order[0]).toBe(1);
            expect(order[1]).toBe(2);
            expect(order[2]).toBe(3);
        });

        await it('should pass arguments to the callback', async () => {
            const result = await new Promise<string>((resolve) => {
                process.nextTick((a: string, b: string) => resolve(a + b), 'hello', ' world');
            });
            expect(result).toBe('hello world');
        });
    });

    await describe('process (browser): streams', async () => {
        await it('stdout/stderr/stdin should be defined', async () => {
            expect(process.stdout).toBeDefined();
            expect(process.stderr).toBeDefined();
            expect(process.stdin).toBeDefined();
        });

        await it('stdout.write should be a function returning true', async () => {
            expect(typeof process.stdout.write).toBe('function');
            expect(process.stdout.write('')).toBe(true);
        });

        await it('stderr.write should be a function', async () => {
            expect(typeof process.stderr.write).toBe('function');
        });

        await it('streams should report isTTY === false', async () => {
            expect(process.stdout.isTTY).toBe(false);
            expect(process.stderr.isTTY).toBe(false);
            expect(process.stdin.isTTY).toBe(false);
        });
    });

    await describe('process (browser): EventEmitter no-op surface', async () => {
        await it('should expose the listener registration methods', async () => {
            expect(typeof process.on).toBe('function');
            expect(typeof process.once).toBe('function');
            expect(typeof process.off).toBe('function');
            expect(typeof process.emit).toBe('function');
            expect(typeof process.removeListener).toBe('function');
            expect(typeof process.removeAllListeners).toBe('function');
        });

        await it('emit() should return false (never fires)', async () => {
            expect(process.emit('test-event')).toBe(false);
        });

        await it('listeners() should return an empty array', async () => {
            process.on('test-event', () => {});
            expect(process.listeners('test-event').length).toBe(0);
        });

        await it('listenerCount() should return 0', async () => {
            expect(process.listenerCount('test-event')).toBe(0);
        });
    });

    await describe('process (browser): misc functions', async () => {
        await it('emitWarning should be a function', async () => {
            expect(typeof process.emitWarning).toBe('function');
        });
    });
};
