// The commonest error in a GTK app, and the one the formatter served worst.
//
// Its own file, and the `.gjs.spec.ts` suffix is load-bearing rather than
// cosmetic: `scripts/audit-runtimes.mjs` skips that suffix precisely because
// "specs are allowed to exercise GJS-only paths", and scans every other `.ts`.
// With these cases inside `index.spec.ts`, the `await import('gi://…')` counted
// as a source signal and the auditor reported this package's declared triplet as
// drifting to `node:partial, browser:partial` — a required check, red, for a
// test.

import { describe, expect, it, on } from '@gjsify/unit';
import console, { Console } from 'node:console';
import { Writable } from 'node:stream';

/**
 * The slice of GLib/Gio the GError suite needs, typed by hand: this package's
 * tsconfig deliberately keeps `@girs/*` out of scope so the Node bundle stays clean,
 * so the modules are loaded at runtime and cast — the same shape `@gjsify/http2`'s
 * GJS-only spec uses. `domain` and `code` are the two facts that identify a GError.
 */
type GError = Error & { domain: number; code: number };
type GLibModule = { Error: new (domain: unknown, code: number, message: string) => GError };
type GioModule = {
    IOErrorEnum: { NOT_FOUND: number };
    File: { new_for_path(path: string): { read(cancellable: null): unknown } };
};

export default async () => {
    await on('Gjs', async () => {
        // The commonest error in a GTK app, and the one the formatter served worst.
        // GJS-only by construction: a GError needs GLib.
        await describe('console: GError rendering', async () => {
            const GLib = (await import('gi://GLib?version=2.0' as string)).default as GLibModule;
            const Gio = (await import('gi://Gio?version=2.0' as string)).default as GioModule;

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
            const gerror = () => new GLib.Error(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND, 'no such file');

            await it('should be an Error only by brand, not by instanceof', async () => {
                // `Error.isError` is the ONLY reason a GError reaches the Error path at
                // all — measured on gjs 1.88.1. A regression to `instanceof` would send
                // every GError back through `JSON.stringify`.
                const err = gerror();
                expect(err instanceof Error).toBe(false);
                expect(Error.isError(err)).toBe(true);
            });

            await it('should head a GError with its domain, not the literal `Error`', async () => {
                // `err.name` is `undefined` on a GError — `Error.prototype` is not on
                // its prototype chain — so the old `'Error'` fallback printed
                // `Error: no such file` for what `String(err)` calls
                // `Gio.IOErrorEnum: no such file`.
                const err = gerror();
                expect(err.name).toBe(undefined);
                expect(render(err).split('\n')[0]).toBe(String(err));
                expect(render(err).split('\n')[0]).toBe('Gio.IOErrorEnum: no such file');
            });

            await it('should carry the domain and code of a GError', async () => {
                // Both are readable but NOT own properties, so `Object.keys` — the only
                // source the extras had — reached neither.
                const err = gerror();
                expect(Object.prototype.hasOwnProperty.call(err, 'domain')).toBe(false);
                expect(Object.prototype.hasOwnProperty.call(err, 'code')).toBe(false);
                expect(err.code).toBe(Gio.IOErrorEnum.NOT_FOUND);
                const rendered = render(err);
                expect(rendered).toContain(`"domain":${err.domain}`);
                expect(rendered).toContain(`"code":${err.code}`);
            });

            await it('should not carry the four position fields of a GError', async () => {
                // `Object.keys(gerror)` is ["stack","fileName","lineNumber",
                // "columnNumber"] — all four own-ENUMERABLE, unlike on a plain Error —
                // so every GError render used to end in
                // `{"fileName":"file:///…","lineNumber":9,"columnNumber":5}`.
                const err = gerror();
                expect(Object.keys(err)).toContain('fileName');
                const rendered = render(err);
                expect(rendered).not.toContain('"fileName"');
                expect(rendered).not.toContain('"lineNumber"');
                expect(rendered).not.toContain('"columnNumber"');
                expect(rendered).not.toContain('"stack"');
            });

            await it('should keep a GError identifiable through cause and nesting', async () => {
                const nested = render(new Error('outer', { cause: gerror() }));
                expect(nested).toContain('[cause]: Gio.IOErrorEnum: no such file');
                expect(render([gerror()])).toContain('Gio.IOErrorEnum: no such file');
            });

            await it('should name the domain of a GError raised by a real Gio call', async () => {
                let caught: unknown;
                try {
                    Gio.File.new_for_path('/definitely/not/here').read(null);
                } catch (thrown) {
                    caught = thrown;
                }
                expect(Error.isError(caught)).toBe(true);
                const rendered = render(caught);
                expect(rendered.split('\n')[0].startsWith('Gio.IOErrorEnum: ')).toBe(true);
                expect(rendered).toContain(`"code":${Gio.IOErrorEnum.NOT_FOUND}`);
            });
        });
    });
};
