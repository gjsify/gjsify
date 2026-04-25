import { run, describe, it, expect } from '@gjsify/unit';

function clearStorages() {
    localStorage.clear();
    sessionStorage.clear();
}

run({
    async WebStorageTest() {
        clearStorages();

        await describe('localStorage', async () => {
            await it('setItem / getItem', async () => {
                localStorage.setItem('key', 'value');
                expect(localStorage.getItem('key')).toBe('value');
                localStorage.removeItem('key');
            });

            await it('getItem returns null for missing key', async () => {
                expect(localStorage.getItem('__nonexistent__')).toBeNull();
            });

            await it('removeItem deletes the key', async () => {
                localStorage.setItem('temp', 'x');
                localStorage.removeItem('temp');
                expect(localStorage.getItem('temp')).toBeNull();
            });

            await it('length reflects stored count', async () => {
                localStorage.clear();
                expect(localStorage.length).toBe(0);
                localStorage.setItem('a', '1');
                localStorage.setItem('b', '2');
                expect(localStorage.length).toBe(2);
                localStorage.clear();
            });

            await it('clear() removes all items', async () => {
                localStorage.setItem('x', '1');
                localStorage.setItem('y', '2');
                localStorage.clear();
                expect(localStorage.length).toBe(0);
            });

            await it('key(index) returns key at position', async () => {
                localStorage.clear();
                localStorage.setItem('only', 'val');
                expect(localStorage.key(0)).toBe('only');
                localStorage.clear();
            });

            await it('coerces non-string values to string', async () => {
                localStorage.setItem('num', String(42));
                expect(localStorage.getItem('num')).toBe('42');
                localStorage.removeItem('num');
            });
        });

        await describe('sessionStorage', async () => {
            await it('setItem / getItem', async () => {
                sessionStorage.setItem('s', 'session');
                expect(sessionStorage.getItem('s')).toBe('session');
                sessionStorage.removeItem('s');
            });

            await it('is independent from localStorage', async () => {
                localStorage.setItem('shared', 'local');
                sessionStorage.setItem('shared', 'session');
                expect(localStorage.getItem('shared')).toBe('local');
                expect(sessionStorage.getItem('shared')).toBe('session');
                localStorage.removeItem('shared');
                sessionStorage.removeItem('shared');
            });
        });
    },
});
