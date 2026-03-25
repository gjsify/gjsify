import { describe, it, expect, run } from '@gjsify/unit';
import { FormData, File, formDataToBlob } from 'formdata';

export default () => {
    describe('FormData', () => {
        describe('constructor', () => {
            it('should create an empty FormData', () => {
                const fd = new FormData();
                expect([...fd.entries()].length).toBe(0);
            });
        });

        describe('append and get', () => {
            it('should append and get string values', () => {
                const fd = new FormData();
                fd.append('key', 'value');
                expect(fd.get('key')).toBe('value');
            });

            it('should append multiple values for same key', () => {
                const fd = new FormData();
                fd.append('key', 'a');
                fd.append('key', 'b');
                const all = fd.getAll('key');
                expect(all.length).toBe(2);
                expect(all[0]).toBe('a');
                expect(all[1]).toBe('b');
            });

            it('should return null for missing key', () => {
                const fd = new FormData();
                expect(fd.get('missing')).toBe(null);
            });

            it('should return empty array for missing key with getAll', () => {
                const fd = new FormData();
                expect(fd.getAll('missing').length).toBe(0);
            });
        });

        describe('set', () => {
            it('should set a value replacing previous', () => {
                const fd = new FormData();
                fd.append('key', 'a');
                fd.append('key', 'b');
                fd.set('key', 'c');
                expect(fd.getAll('key').length).toBe(1);
                expect(fd.get('key')).toBe('c');
            });

            it('should add if key does not exist', () => {
                const fd = new FormData();
                fd.set('key', 'value');
                expect(fd.get('key')).toBe('value');
            });
        });

        describe('delete', () => {
            it('should remove all entries for a key', () => {
                const fd = new FormData();
                fd.append('key', 'a');
                fd.append('key', 'b');
                fd.append('other', 'c');
                fd.delete('key');
                expect(fd.has('key')).toBe(false);
                expect(fd.has('other')).toBe(true);
            });
        });

        describe('has', () => {
            it('should return true for existing key', () => {
                const fd = new FormData();
                fd.append('key', 'value');
                expect(fd.has('key')).toBe(true);
            });

            it('should return false for missing key', () => {
                const fd = new FormData();
                expect(fd.has('key')).toBe(false);
            });
        });

        describe('iterators', () => {
            it('should iterate entries', () => {
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

            it('should iterate keys', () => {
                const fd = new FormData();
                fd.append('a', '1');
                fd.append('b', '2');
                const keys = [...fd.keys()];
                expect(keys.length).toBe(2);
                expect(keys[0]).toBe('a');
                expect(keys[1]).toBe('b');
            });

            it('should iterate values', () => {
                const fd = new FormData();
                fd.append('a', '1');
                fd.append('b', '2');
                const values = [...fd.values()];
                expect(values.length).toBe(2);
                expect(values[0]).toBe('1');
                expect(values[1]).toBe('2');
            });

            it('should work with for...of', () => {
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

        describe('forEach', () => {
            it('should call callback for each entry', () => {
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

        describe('Symbol.toStringTag', () => {
            it('should return FormData', () => {
                const fd = new FormData();
                expect(Object.prototype.toString.call(fd)).toBe('[object FormData]');
            });
        });
    });

    describe('File', () => {
        it('should create a File with name', () => {
            const f = new File(['hello'], 'test.txt', { type: 'text/plain' });
            expect(f.name).toBe('test.txt');
            expect(f.type).toBe('text/plain');
            expect(f.size).toBe(5);
        });

        it('should have lastModified', () => {
            const now = Date.now();
            const f = new File(['data'], 'file.bin');
            expect(f.lastModified >= now - 1000).toBeTruthy();
        });

        it('should accept custom lastModified', () => {
            const f = new File(['data'], 'file.bin', { lastModified: 12345 });
            expect(f.lastModified).toBe(12345);
        });

        it('should have correct Symbol.toStringTag', () => {
            const f = new File([], 'empty');
            expect(Object.prototype.toString.call(f)).toBe('[object File]');
        });
    });

    describe('FormData with Blob/File', () => {
        it('should wrap Blob in File when appending', () => {
            const fd = new FormData();
            const blob = new Blob(['data'], { type: 'text/plain' });
            fd.append('file', blob, 'test.txt');
            const val = fd.get('file');
            expect(val instanceof File).toBeTruthy();
            expect((val as File).name).toBe('test.txt');
        });

        it('should keep File as File', () => {
            const fd = new FormData();
            const file = new File(['data'], 'original.txt');
            fd.append('file', file);
            const val = fd.get('file');
            expect(val instanceof File).toBeTruthy();
            expect((val as File).name).toBe('original.txt');
        });
    });

    describe('formDataToBlob', () => {
        it('should create a Blob from FormData', async () => {
            const fd = new FormData();
            fd.append('name', 'world');
            const blob = formDataToBlob(fd);
            expect(blob instanceof Blob).toBeTruthy();
            expect(blob.type.startsWith('multipart/form-data; boundary=')).toBeTruthy();
            const text = await blob.text();
            expect(text.includes('name="name"')).toBeTruthy();
            expect(text.includes('world')).toBeTruthy();
        });

        it('should include file entries', async () => {
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
