// Browser-target spec for @gjsify/os.
//
// The standard `index.spec.ts` asserts host-OS-specific values (platform() ===
// 'linux', type() === 'Linux', cpus().length > 0, totalmem() > 0, real signal
// numbers, …) that only hold under Node/GJS on a real machine. The browser
// entry (`./browser.ts`) is intentionally constant — there is no POSIX uname /
// sysctl / /proc surface in a browser, so platform/arch are 'browser', cpus()
// is `[]`, mem readings are 0, hostname is 'localhost', etc.
//
// This reduced spec therefore imports the browser impl directly and only
// asserts what is actually true under `gjsify build --app browser`: the public
// API shape, types, and the documented browser constants.

import { describe, it, expect } from '@gjsify/unit';
import * as os from './browser.js';

export default async () => {
    await describe('os (browser): constants', async () => {
        await it('EOL should be \\n', async () => {
            expect(os.EOL).toBe('\n');
        });

        await it('devNull should be /dev/null', async () => {
            expect(os.devNull).toBe('/dev/null');
        });
    });

    await describe('os (browser): identity readings', async () => {
        await it('platform() should be "browser"', async () => {
            expect(os.platform()).toBe('browser');
        });

        await it('arch() should be "browser"', async () => {
            expect(os.arch()).toBe('browser');
        });

        await it('type() should be "Browser"', async () => {
            expect(os.type()).toBe('Browser');
        });

        await it('machine() should be "browser"', async () => {
            expect(os.machine()).toBe('browser');
        });

        await it('release() should be an empty string', async () => {
            expect(os.release()).toBe('');
        });

        await it('version() should be an empty string', async () => {
            expect(os.version()).toBe('');
        });
    });

    await describe('os (browser): paths', async () => {
        await it('homedir() should be "/"', async () => {
            expect(os.homedir()).toBe('/');
        });

        await it('hostname() should be "localhost"', async () => {
            expect(os.hostname()).toBe('localhost');
        });

        await it('tmpdir() should be "/tmp"', async () => {
            expect(os.tmpdir()).toBe('/tmp');
        });
    });

    await describe('os (browser): endianness', async () => {
        await it('should return BE or LE', async () => {
            const endianness = os.endianness();
            expect(endianness === 'BE' || endianness === 'LE').toBeTruthy();
        });
    });

    await describe('os (browser): cpus / memory / load', async () => {
        await it('cpus() should be an empty array', async () => {
            const cpus = os.cpus();
            expect(Array.isArray(cpus)).toBeTruthy();
            expect(cpus.length).toBe(0);
        });

        await it('totalmem() should be 0', async () => {
            expect(os.totalmem()).toBe(0);
        });

        await it('freemem() should be 0', async () => {
            expect(os.freemem()).toBe(0);
        });

        await it('loadavg() should be [0, 0, 0]', async () => {
            const avg = os.loadavg();
            expect(avg.length).toBe(3);
            expect(avg[0]).toBe(0);
            expect(avg[1]).toBe(0);
            expect(avg[2]).toBe(0);
        });

        await it('uptime() should be 0', async () => {
            expect(os.uptime()).toBe(0);
        });
    });

    await describe('os (browser): availableParallelism', async () => {
        await it('should return a positive number', async () => {
            const n = os.availableParallelism();
            expect(typeof n).toBe('number');
            expect(n > 0).toBeTruthy();
        });
    });

    await describe('os (browser): userInfo', async () => {
        await it('should describe the browser user', async () => {
            const info = os.userInfo();
            expect(info.uid).toBe(-1);
            expect(info.gid).toBe(-1);
            expect(info.username).toBe('browser');
            expect(info.homedir).toBe('/');
            expect(info.shell).toBe('');
        });
    });

    await describe('os (browser): networkInterfaces', async () => {
        await it('should return an empty object', async () => {
            const ifaces = os.networkInterfaces();
            expect(typeof ifaces).toBe('object');
            expect(Object.keys(ifaces).length).toBe(0);
        });
    });

    await describe('os (browser): priority no-ops', async () => {
        await it('getPriority() should return 0', async () => {
            expect(os.getPriority()).toBe(0);
        });

        await it('setPriority() should not throw', async () => {
            const fn = () => os.setPriority(0, 0);
            expect(fn).not.toThrow();
        });
    });

    await describe('os (browser): constants shape', async () => {
        await it('constants.signals should be an object', async () => {
            expect(typeof os.constants.signals).toBe('object');
        });

        await it('constants.errno should be an object', async () => {
            expect(typeof os.constants.errno).toBe('object');
        });

        await it('constants.UV_UDP_REUSEADDR should be a number', async () => {
            expect(typeof os.constants.UV_UDP_REUSEADDR).toBe('number');
        });

        await it('constants.priority should expose the standard levels', async () => {
            expect(os.constants.priority.PRIORITY_NORMAL).toBe(0);
            expect(os.constants.priority.PRIORITY_LOW).toBe(19);
            expect(os.constants.priority.PRIORITY_HIGHEST).toBe(-20);
        });
    });
};
