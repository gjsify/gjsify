// @gjsify/native-fs-bridge — unit tests
// Tests run on GJS (and Node) where neither java nor NSFileManager is present,
// so every function must throw 'Platform not supported'.

import { describe, it, expect } from '@gjsify/unit';

import fsPromisesDefault from './promises.js';
import fsDefault, {
    promises,
    readFile,
    writeFile,
    readdir,
    stat,
    mkdir,
    unlink,
    exists,
    openSync,
    readSync,
    fstatSync,
    closeSync,
} from './index.js';

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

        await it('openSync throws Platform not supported', async () => {
            expect(() => openSync('/tmp/test.txt')).toThrow('Platform not supported');
        });

        await it('readSync, fstatSync and closeSync throw Platform not supported', async () => {
            expect(() => readSync(3, new Uint8Array(1))).toThrow('Platform not supported');
            expect(() => closeSync(3)).toThrow('Platform not supported');
            expect(() => fstatSync(3)).toThrow('Platform not supported');
        });

        await it('default export carries the fs and fs/promises surface', async () => {
            expect(typeof fsDefault.readFile).toBe('function');
            expect(typeof fsDefault.writeFile).toBe('function');
            expect(typeof fsDefault.readdir).toBe('function');
            expect(typeof fsDefault.stat).toBe('function');
            expect(typeof fsDefault.mkdir).toBe('function');
            expect(typeof fsDefault.unlink).toBe('function');
            expect(typeof fsDefault.openSync).toBe('function');
            expect(fsDefault.readFile).toBe(readFile);
            expect(fsDefault.promises).toBe(promises);
            expect(promises.readFile).toBe(readFile);
            expect(fsPromisesDefault).toBe(promises);
        });

        await it('exists throws Platform not supported', async () => {
            expect(() => exists('/tmp/test.txt')).toThrow('Platform not supported');
        });
    });
};
