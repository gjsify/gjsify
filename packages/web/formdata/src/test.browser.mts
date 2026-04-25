import { run, describe, it, expect } from '@gjsify/unit';

run({
    async FormDataTest() {
        await describe('FormData', async () => {
            await it('append and get', async () => {
                const fd = new FormData();
                fd.append('name', 'Alice');
                expect(fd.get('name')).toBe('Alice');
            });

            await it('getAll returns all values for a field', async () => {
                const fd = new FormData();
                fd.append('tag', 'a');
                fd.append('tag', 'b');
                expect(fd.getAll('tag')).toStrictEqual(['a', 'b']);
            });

            await it('set overwrites all values', async () => {
                const fd = new FormData();
                fd.append('x', '1');
                fd.append('x', '2');
                fd.set('x', 'new');
                expect(fd.getAll('x')).toStrictEqual(['new']);
            });

            await it('delete removes a field', async () => {
                const fd = new FormData();
                fd.append('x', '1');
                fd.delete('x');
                expect(fd.has('x')).toBe(false);
            });

            await it('has() checks existence', async () => {
                const fd = new FormData();
                fd.append('a', '1');
                expect(fd.has('a')).toBe(true);
                expect(fd.has('missing')).toBe(false);
            });

            await it('keys() iterates field names', async () => {
                const fd = new FormData();
                fd.append('a', '1');
                fd.append('b', '2');
                expect([...fd.keys()]).toStrictEqual(['a', 'b']);
            });

            await it('values() iterates field values', async () => {
                const fd = new FormData();
                fd.append('a', '1');
                fd.append('b', '2');
                expect([...fd.values()]).toStrictEqual(['1', '2']);
            });

            await it('entries() iterates [key, value] pairs', async () => {
                const fd = new FormData();
                fd.append('k', 'v');
                const entries = [...fd.entries()];
                expect(entries[0][0]).toBe('k');
                expect(entries[0][1]).toBe('v');
            });
        });

        await describe('File', async () => {
            await it('has name, type, and correct size', async () => {
                const f = new File(['hello'], 'test.txt', { type: 'text/plain' });
                expect(f.name).toBe('test.txt');
                expect(f.type).toBe('text/plain');
                expect(f.size).toBe(5);
            });

            await it('lastModified is a number', async () => {
                const f = new File(['data'], 'file.bin');
                expect(typeof f.lastModified).toBe('number');
            });

            await it('content can be read as text', async () => {
                const f = new File(['hello world'], 'test.txt');
                expect(await f.text()).toBe('hello world');
            });
        });
    },
});
