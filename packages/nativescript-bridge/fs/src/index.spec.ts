// @gjsify/native-fs-bridge — unit tests
// Tests run on GJS (and Node) where neither java nor NSFileManager is present,
// so every function must throw 'Platform not supported'.

import { describe, it, expect } from '@gjsify/unit';

import { readFile, writeFile, readdir, stat, mkdir, unlink, exists } from './index.js';

export default async () => {
    await describe('@gjsify/native-fs-bridge outside NativeScript', async () => {
        await it('readFile throws Platform not supported', async () => {
            expect(() => readFile('/tmp/test.txt')).toThrow('Platform not supported');
        });

        await it('writeFile throws Platform not supported', async () => {
            expect(() => writeFile('/tmp/test.txt', 'hello')).toThrow('Platform not supported');
        });

        await it('readdir throws Platform not supported', async () => {
            expect(() => readdir('/tmp')).toThrow('Platform not supported');
        });

        await it('stat throws Platform not supported', async () => {
            expect(() => stat('/tmp')).toThrow('Platform not supported');
        });

        await it('mkdir throws Platform not supported', async () => {
            expect(() => mkdir('/tmp/newdir')).toThrow('Platform not supported');
        });

        await it('unlink throws Platform not supported', async () => {
            expect(() => unlink('/tmp/test.txt')).toThrow('Platform not supported');
        });

        await it('exists throws Platform not supported', async () => {
            expect(() => exists('/tmp/test.txt')).toThrow('Platform not supported');
        });
    });
};
