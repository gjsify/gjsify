// SPDX-License-Identifier: MIT
// The files `gjsify-css-as-string` reads BEHIND the bundler's back.
//
// A stylesheet's `@import` chain and a Sass file's partials are read by us, not
// by the bundler, so no module graph names them. They are still inputs of the
// output: without a declaration, a consumer editing `base.css` in another
// workspace package rebuilds nothing and the next test run reports on the
// stylesheet as it was before the edit. `this.addWatchFile` is the contract that
// closes it, and these are the only assertions that it is actually called.

import { describe, it, expect } from '@gjsify/unit';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cssAsStringPlugin } from './css-as-string.js';

interface WatchContext {
    watched: string[];
    addWatchFile(id: string): void;
}

/** A context carrying ONLY `addWatchFile`, so an undeclared input cannot hide behind another hook. */
function watchContext(): WatchContext {
    const watched: string[] = [];
    return {
        watched,
        addWatchFile(id: string): void {
            watched.push(id);
        },
    };
}

type CssPlugin = ReturnType<typeof cssAsStringPlugin>;

async function loadEntry(plugin: CssPlugin, id: string): Promise<{ code: string; ctx: WatchContext }> {
    const hook = plugin.load as { handler: (this: unknown, id: string) => Promise<{ code: string }> };
    const ctx = watchContext();
    const result = await hook.handler.call(ctx, id);
    return { code: result.code, ctx };
}

function fixture(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), 'gjsify-css-inputs-'));
    for (const [rel, body] of Object.entries(files)) {
        const abs = join(root, ...rel.split('/'));
        mkdirSync(join(abs, '..'), { recursive: true });
        writeFileSync(abs, body, 'utf-8');
    }
    return root;
}

export default async () => {
    await describe('css-as-string — declared inputs', async () => {
        await it('declares the entry AND every stylesheet its @import chain reaches', async () => {
            const root = fixture({
                'src/index.css': '@import "./base.css";\n@import "./nested/deep.css";\n.themed { color: red; }\n',
                'src/base.css': '.base { color: black; }\n',
                'src/nested/deep.css': '.deep { color: blue; }\n',
            });
            try {
                const entry = join(root, 'src', 'index.css');
                const { code, ctx } = await loadEntry(cssAsStringPlugin(), entry);

                // The bundler made ONE module out of this. Everything else came
                // from our own reads.
                expect(ctx.watched).toContain(entry);
                expect(ctx.watched).toContain(join(root, 'src', 'base.css'));
                expect(ctx.watched).toContain(join(root, 'src', 'nested', 'deep.css'));
                // …and the flattening still happened, so the declaration did not
                // replace the work.
                expect(code).toContain('.base');
                expect(code).not.toContain('@import');
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('declares a Sass entry, and NOT a partial it cannot see', async () => {
            const root = fixture({
                'src/app.scss': '@use "./tokens";\n.a { color: tokens.$c; }\n',
                'src/_tokens.scss': '$c: red;\n',
            });
            try {
                const entry = join(root, 'src', 'app.scss');
                const { code, ctx } = await loadEntry(cssAsStringPlugin(), entry);
                expect(ctx.watched).toContain(entry);
                expect(code).toContain('color: red');
                // dart-sass resolves a relative `@use` through its own
                // filesystem importer BEFORE a custom importer is consulted
                // (measured with dart-sass 1.101: `findFileUrl` and
                // `canonicalize` are called zero times), so the partial's path
                // never reaches us. Asserted, not wished away, so a future
                // dart-sass that DOES call the hook makes this fail.
                expect(ctx.watched).not.toContain(join(root, 'src', '_tokens.scss'));
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('does NOT throw on an engine without addWatchFile, and says so once', async () => {
            // Measured: the engine the GJS CLI loads is resolved through several
            // anchors, and one of them answered with a build that has no such
            // method. A build must not fail over bookkeeping — but the reader
            // must not be left with prose, either.
            const root = fixture({ 'src/index.css': '.plain { color: red; }\n' });
            const entry = join(root, 'src', 'index.css');
            const hook = cssAsStringPlugin().load as { handler: (this: unknown, id: string) => Promise<unknown> };
            const seen: string[] = [];
            const original = console.warn;
            console.warn = (msg: string) => seen.push(msg);
            try {
                const result = await hook.handler.call({}, entry);
                expect(JSON.stringify(result)).toContain('plain');
            } finally {
                console.warn = original;
                rmSync(root, { recursive: true, force: true });
            }
            expect(seen.join('\n')).toContain('addWatchFile');
        });

        await it('declares nothing beyond the entry when there is no chain', async () => {
            const root = fixture({ 'src/plain.css': '.plain { color: red; }\n' });
            try {
                const entry = join(root, 'src', 'plain.css');
                const { ctx } = await loadEntry(cssAsStringPlugin(), entry);
                // The entry is a module of the graph already; declaring it costs
                // one stat and keeps the rule "declare what you read" uniform.
                expect(ctx.watched).toStrictEqual([entry]);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });
    });
};
