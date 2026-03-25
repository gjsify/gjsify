import { describe, it, expect } from '@gjsify/unit';
import { FormData, File, formDataToBlob } from 'formdata';

export default async () => {
    await describe('FormData', async () => {
        await describe('constructor', async () => {
            await it('should create an empty FormData', async () => {
                const fd = new FormData();
                expect([...fd.entries()].length).toBe(0);
            });
        });

        await describe('append and get', async () => {
            await it('should append and get string values', async () => {
                const fd = new FormData();
                fd.append('key', 'value');
                expect(fd.get('key')).toBe('value');
            });

            await it('should append multiple values for same key', async () => {
                const fd = new FormData();
                fd.append('key', 'a');
                fd.append('key', 'b');
                const all = fd.getAll('key');
                expect(all.length).toBe(2);
                expect(all[0]).toBe('a');
                expect(all[1]).toBe('b');
            });

            await it('should return null for missing key', async () => {
                const fd = new FormData();
                expect(fd.get('missing')).toBe(null);
            });

            await it('should return empty array for missing key with getAll', async () => {
                const fd = new FormData();
                expect(fd.getAll('missing').length).toBe(0);
            });
        });

        await describe('set', async () => {
            await it('should set a value replacing previous', async () => {
                const fd = new FormData();
                fd.append('key', 'a');
                fd.append('key', 'b');
                fd.set('key', 'c');
                expect(fd.getAll('key').length).toBe(1);
                expect(fd.get('key')).toBe('c');
            });

            await it('should add if key does not exist', async () => {
                const fd = new FormData();
                fd.set('key', 'value');
                expect(fd.get('key')).toBe('value');
            });
        });

        await describe('delete', async () => {
            await it('should remove all entries for a key', async () => {
                const fd = new FormData();
                fd.append('key', 'a');
                fd.append('key', 'b');
                fd.append('other', 'c');
                fd.delete('key');
                expect(fd.has('key')).toBe(false);
                expect(fd.has('other')).toBe(true);
            });
        });

        await describe('has', async () => {
            await it('should return true for existing key', async () => {
                const fd = new FormData();
                fd.append('key', 'value');
                expect(fd.has('key')).toBe(true);
            });

            await it('should return false for missing key', async () => {
                const fd = new FormData();
                expect(fd.has('key')).toBe(false);
            });
        });

        await describe('iterators', async () => {
            await it('should iterate entries', async () => {
                const fd = new FormData();
                fd.append('a', '1');
                fd.append('b', '2');
                const entries = [...fd.entries()];
                expect(entries.length).toBe(2);
                expect(entries[0][0]).toBe('a');
                expect(entries[0][1]).toBe('1');
                expect(entries[1][0]).toBe('b');
                expect(entries[1][1]).toBe('2');
            });

            await it('should iterate keys', async () => {
                const fd = new FormData();
                fd.append('a', '1');
                fd.append('b', '2');
                const keys = [...fd.keys()];
                expect(keys.length).toBe(2);
                expect(keys[0]).toBe('a');
                expect(keys[1]).toBe('b');
            });

            await it('should iterate values', async () => {
                const fd = new FormData();
                fd.append('a', '1');
                fd.append('b', '2');
                const values = [...fd.values()];
                expect(values.length).toBe(2);
                expect(values[0]).toBe('1');
                expect(values[1]).toBe('2');
            });

            await it('should work with for...of', async () => {
                const fd = new FormData();
                fd.append('x', 'y');
                let count = 0;
                for (const [key, val] of fd) {
                    expect(key).toBe('x');
                    expect(val).toBe('y');
                    count++;
                }
                expect(count).toBe(1);
            });
        });

        await describe('forEach', async () => {
            await it('should call callback for each entry', async () => {
                const fd = new FormData();
                fd.append('a', '1');
                fd.append('b', '2');
                const results: [string, string][] = [];
                fd.forEach((value, key) => {
                    results.push([key, value as string]);
                });
                expect(results.length).toBe(2);
                expect(results[0][0]).toBe('a');
                expect(results[1][0]).toBe('b');
            });
        });

        await describe('Symbol.toStringTag', async () => {
            await it('should return FormData', async () => {
                const fd = new FormData();
                expect(Object.prototype.toString.call(fd)).toBe('[object FormData]');
            });
        });
    });

    await describe('File', async () => {
        await it('should create a File with name', async () => {
            const f = new File(['hello'], 'test.txt', { type: 'text/plain' });
            expect(f.name).toBe('test.txt');
            expect(f.type).toBe('text/plain');
            expect(f.size).toBe(5);
        });

        await it('should have lastModified', async () => {
            const now = Date.now();
            const f = new File(['data'], 'file.bin');
            expect(f.lastModified >= now - 1000).toBeTruthy();
        });

        await it('should accept custom lastModified', async () => {
            const f = new File(['data'], 'file.bin', { lastModified: 12345 });
            expect(f.lastModified).toBe(12345);
        });

        await it('should have correct Symbol.toStringTag', async () => {
            const f = new File([], 'empty');
            expect(Object.prototype.toString.call(f)).toBe('[object File]');
        });
    });

    await describe('FormData with Blob/File', async () => {
        await it('should wrap Blob in File when appending', async () => {
            const fd = new FormData();
            const blob = new Blob(['data'], { type: 'text/plain' });
            fd.append('file', blob, 'test.txt');
            const val = fd.get('file');
            expect(val instanceof File).toBeTruthy();
            expect((val as File).name).toBe('test.txt');
        });

        await it('should keep File as File', async () => {
            const fd = new FormData();
            const file = new File(['data'], 'original.txt');
            fd.append('file', file);
            const val = fd.get('file');
            expect(val instanceof File).toBeTruthy();
            expect((val as File).name).toBe('original.txt');
        });
    });

    await describe('formDataToBlob', async () => {
        await it('should create a Blob from FormData', async () => {
            const fd = new FormData();
            fd.append('name', 'world');
            const blob = formDataToBlob(fd);
            expect(blob instanceof Blob).toBeTruthy();
            expect(blob.type.startsWith('multipart/form-data; boundary=')).toBeTruthy();
            const text = await blob.text();
            expect(text.includes('name="name"')).toBeTruthy();
            expect(text.includes('world')).toBeTruthy();
        });

        await it('should include file entries', async () => {
            const fd = new FormData();
            fd.append('doc', new File(['content'], 'doc.txt', { type: 'text/plain' }));
            const blob = formDataToBlob(fd);
            const text = await blob.text();
            expect(text.includes('filename="doc.txt"')).toBeTruthy();
            expect(text.includes('Content-Type: text/plain')).toBeTruthy();
            expect(text.includes('content')).toBeTruthy();
        });
    });
};
