// SPDX-License-Identifier: MIT
// The two suffix chains and the one plugin that walks them (ADR 0032 § 9).
//
// WHAT IS ACTUALLY BEING PINNED. Not "does a `.gtk` file resolve" — that is one
// `this.resolve` call — but the ORDER, and the two exclusions that look like
// oversights. `.gtk` before `.<os>` before `.desktop` is a decision, `.native`
// and `.web` being absent is a decision, and both are the kind of decision the
// next reader "fixes". The disjointness row below iterates the REAL suffix map,
// so adding a `web` row to it turns this suite red rather than quietly widening
// the chain.
//
// NOTHING HERE ASSERTS WHICH OS THE TEST RUNS ON. `desktopOsSuffix` takes the
// platform token as a parameter, so all three OS legs are exercised on every
// host by injection; the only row that touches the real host asserts a PROPERTY
// (the answer is one of the three, or undefined) and never a value. A vector in
// this repository once asserted a URI scheme was openable — true on a desktop,
// false on a headless CI shard — and that is the shape being avoided.
//
// Tested from @gjsify/cli's harness because the plugin package has no
// `test:node` script of its own — same placement rationale as
// `unresolved-workspace-import.spec.ts` / `externals-plugin.spec.ts`.

import { describe, expect, it } from '@gjsify/unit';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    DESKTOP_OS_SUFFIXES,
    DESKTOP_REFUSED_SUFFIXES,
    desktopOsSuffix,
    desktopSuffixChain,
    nativescriptSuffixChain,
    platformResolvePlugin,
    PlatformVariantExternalError,
} from '@gjsify/rolldown-plugin-gjsify';

const IMPORTER = '/proj/src/screen.tsx';

type ResolveHandler = (
    this: unknown,
    source: string,
    importer: string | undefined,
    extra?: { kind?: string },
) => Promise<{ id: string; external?: boolean } | null>;

/** Extract the resolveId handler from the `{ order, handler }` object form. */
function handlerOf(plugin: unknown): ResolveHandler {
    const h = (plugin as { resolveId?: { handler?: unknown } }).resolveId?.handler;
    if (typeof h !== 'function') throw new Error('plugin did not expose a resolveId.handler');
    return h as ResolveHandler;
}

/**
 * Minimal PluginContext mock. `onDisk` is the set of specifiers that resolve;
 * `external` marks the ones handed back as external. `asked` records the probe
 * ORDER, which is the thing under test.
 */
function mockCtx(onDisk: readonly string[], external: readonly string[] = []) {
    const asked: string[] = [];
    const warnings: string[] = [];
    return {
        asked,
        warnings,
        async resolve(id: string) {
            asked.push(id);
            if (external.includes(id)) return { id: `/proj/src/${id.slice(2)}.tsx`, external: true };
            return onDisk.includes(id) ? { id: `/proj/src/${id.slice(2)}.tsx` } : null;
        },
        warn(message: string) {
            warnings.push(message);
        },
    };
}

export default async () => {
    await describe('platform-resolve: the desktop chain (ADR 0032 § 9)', async () => {
        await it('is .gtk → .<os> → .desktop, in that order', () => {
            expect(desktopSuffixChain('linux')).toStrictEqual(['gtk', 'linux', 'desktop']);
            expect(desktopSuffixChain('macos')).toStrictEqual(['gtk', 'macos', 'desktop']);
            expect(desktopSuffixChain('windows')).toStrictEqual(['gtk', 'windows', 'desktop']);
        });

        await it('drops the OS rung rather than guessing one when the OS is unknown', () => {
            expect(desktopSuffixChain()).toStrictEqual(['gtk', 'desktop']);
            expect(desktopSuffixChain(undefined)).toStrictEqual(['gtk', 'desktop']);
        });

        // The exclusion, as a machine check rather than a comment. Iterating
        // DESKTOP_OS_SUFFIXES' real values means a `web: 'web'` row added to the
        // map is caught here, which a hardcoded list of three would not do.
        await it('never contains .native or .web, for any OS the map knows', () => {
            const osValues = [undefined, ...Object.values(DESKTOP_OS_SUFFIXES)];
            for (const os of osValues) {
                const chain = desktopSuffixChain(os);
                for (const refused of DESKTOP_REFUSED_SUFFIXES) {
                    expect(chain.includes(refused)).toBe(false);
                }
            }
        });

        await it('refuses exactly .native and .web, and says nothing about others', () => {
            expect([...DESKTOP_REFUSED_SUFFIXES].sort()).toStrictEqual(['native', 'web']);
        });
    });

    await describe('platform-resolve: host OS → desktop suffix', async () => {
        // React Native's Platform.OS vocabulary on the right, process.platform's
        // on the left. `darwin` → `macos` is the row that matters: the file name
        // has to agree with the `Platform.OS === 'macos'` branch beside it.
        await it('maps the three ADR 0018 target OSes to § 9 spellings', () => {
            expect(desktopOsSuffix('linux')).toBe('linux');
            expect(desktopOsSuffix('darwin')).toBe('macos');
            expect(desktopOsSuffix('win32')).toBe('windows');
        });

        await it('returns undefined for a host outside the target set', () => {
            for (const platform of ['freebsd', 'aix', 'android', 'sunos', '']) {
                expect(desktopOsSuffix(platform)).toBe(undefined);
            }
        });

        // A PROPERTY of the real host, never its identity: this row is green on
        // Linux, macOS, Windows and on a platform none of the three name.
        await it('answers the real host with a known suffix or with undefined', () => {
            const suffix = desktopOsSuffix();
            const known = Object.values(DESKTOP_OS_SUFFIXES);
            expect(suffix === undefined || known.includes(suffix)).toBe(true);
        });
    });

    await describe('platform-resolve: the NativeScript chain is unchanged', async () => {
        await it('is <platform> → native, or native alone with no platform', () => {
            expect(nativescriptSuffixChain('android')).toStrictEqual(['android', 'native']);
            expect(nativescriptSuffixChain('ios')).toStrictEqual(['ios', 'native']);
            expect(nativescriptSuffixChain('visionos')).toStrictEqual(['visionos', 'native']);
            expect(nativescriptSuffixChain()).toStrictEqual(['native']);
        });
    });

    await describe('platform-resolve: the plugin walks the chain', async () => {
        const desktop = () =>
            platformResolvePlugin({
                suffixes: desktopSuffixChain('linux'),
                refusedSuffixes: DESKTOP_REFUSED_SUFFIXES,
            });

        await it('takes .gtk when it exists, without asking for .linux or .desktop', async () => {
            const ctx = mockCtx(['./card.gtk', './card.linux', './card.desktop']);
            const resolved = await handlerOf(desktop()).call(ctx, './card', IMPORTER);
            expect(resolved?.id).toBe('/proj/src/card.gtk.tsx');
            expect(ctx.asked).toStrictEqual(['./card.gtk']);
        });

        await it('falls to .<os> when .gtk is absent', async () => {
            const ctx = mockCtx(['./card.linux', './card.desktop']);
            const resolved = await handlerOf(desktop()).call(ctx, './card', IMPORTER);
            expect(resolved?.id).toBe('/proj/src/card.linux.tsx');
            expect(ctx.asked).toStrictEqual(['./card.gtk', './card.linux']);
        });

        await it('falls to .desktop when neither toolkit nor OS variant exists', async () => {
            const ctx = mockCtx(['./card.desktop']);
            const resolved = await handlerOf(desktop()).call(ctx, './card', IMPORTER);
            expect(resolved?.id).toBe('/proj/src/card.desktop.tsx');
        });

        // § 9's honest outcome: the base file, not the phone file.
        await it('returns null (→ base file) when a .native sibling is the only variant', async () => {
            const ctx = mockCtx(['./card.native']);
            const resolved = await handlerOf(desktop()).call(ctx, './card', IMPORTER);
            expect(resolved).toBe(null);
        });

        await it('returns null (→ base file) when a .web sibling is the only variant', async () => {
            const ctx = mockCtx(['./card.web']);
            const resolved = await handlerOf(desktop()).call(ctx, './card', IMPORTER);
            expect(resolved).toBe(null);
        });

        // Falling through is right; falling through in silence is not.
        await it('WARNS naming the refused sibling it walked past', async () => {
            const ctx = mockCtx(['./card.native']);
            await handlerOf(desktop()).call(ctx, './card', IMPORTER);
            expect(ctx.warnings.length).toBe(1);
            expect(ctx.warnings[0]?.includes('./card.native')).toBe(true);
            expect(ctx.warnings[0]?.includes('gtk → linux → desktop → base')).toBe(true);
        });

        await it('warns once per variant, not once per importing file', async () => {
            const plugin = desktop();
            const ctx = mockCtx(['./card.native']);
            await handlerOf(plugin).call(ctx, './card', IMPORTER);
            await handlerOf(plugin).call(ctx, './card', '/proj/src/other.tsx');
            expect(ctx.warnings.length).toBe(1);
        });

        // The NS chain has no refused list, so it costs zero extra resolves —
        // the property that keeps `--app nativescript` byte-identical.
        await it('probes nothing extra on the NativeScript chain', async () => {
            const plugin = platformResolvePlugin({ suffixes: nativescriptSuffixChain('android') });
            const ctx = mockCtx([]);
            const resolved = await handlerOf(plugin).call(ctx, './card', IMPORTER);
            expect(resolved).toBe(null);
            expect(ctx.asked).toStrictEqual(['./card.android', './card.native']);
            expect(ctx.warnings.length).toBe(0);
        });

        await it('strips a known extension so the suffix lands before it', async () => {
            const ctx = mockCtx(['./card.gtk']);
            const resolved = await handlerOf(desktop()).call(ctx, './card.js', IMPORTER);
            expect(resolved?.id).toBe('/proj/src/card.gtk.tsx');
            expect(ctx.asked[0]).toBe('./card.gtk');
        });

        await it('leaves bare specifiers and entry modules alone', async () => {
            const ctx = mockCtx(['./card.gtk']);
            expect(await handlerOf(desktop()).call(ctx, 'react', IMPORTER)).toBe(null);
            expect(await handlerOf(desktop()).call(ctx, './card', undefined)).toBe(null);
            expect(ctx.asked).toStrictEqual([]);
        });

        // A variant on disk that comes back external is not a miss to walk past:
        // the author wrote the fork and expects it in the bundle.
        await it('throws when a variant resolves EXTERNAL instead of skipping it', async () => {
            const ctx = mockCtx(['./card.gtk'], ['./card.gtk']);
            let thrown: unknown;
            try {
                await handlerOf(desktop()).call(ctx, './card', IMPORTER);
            } catch (error) {
                thrown = error;
            }
            expect(thrown instanceof PlatformVariantExternalError).toBe(true);
            expect((thrown as Error).message.includes('./card.gtk')).toBe(true);
        });

        // An empty chain is a computed-and-came-out-empty orchestrator bug, and
        // it would send every import to base while looking installed.
        await it('refuses to be constructed with an empty chain', () => {
            let thrown: unknown;
            try {
                platformResolvePlugin({ suffixes: [] });
            } catch (error) {
                thrown = error;
            }
            expect(thrown instanceof Error).toBe(true);
            expect((thrown as Error).message.includes('suffix chain is empty')).toBe(true);
        });
    });

    // The sibling index is a PERFORMANCE filter with a correctness obligation: it
    // may only ever skip a resolve that could not have succeeded. These vectors
    // therefore run against a REAL directory — a mock resolver cannot tell "the
    // filter let it through" from "the filter had no opinion".
    await describe('platform-resolve: the sibling index only ever skips a miss', async () => {
        let dir: string;
        let importer: string;

        const indexed = () =>
            platformResolvePlugin({
                suffixes: desktopSuffixChain('linux'),
                refusedSuffixes: DESKTOP_REFUSED_SUFFIXES,
                siblingIndex: true,
            });

        /** Records what reached the resolver; resolves anything asked for. */
        function tracker() {
            const asked: string[] = [];
            const warnings: string[] = [];
            return {
                asked,
                warnings,
                async resolve(id: string) {
                    asked.push(id);
                    return { id: `${id}#resolved` };
                },
                warn(message: string) {
                    warnings.push(message);
                },
            };
        }

        dir = mkdtempSync(join(tmpdir(), 'gjsify-platform-index-'));
        importer = join(dir, 'screen.tsx');
        writeFileSync(importer, '');
        writeFileSync(join(dir, 'card.tsx'), '');
        writeFileSync(join(dir, 'card.gtk.tsx'), '');
        writeFileSync(join(dir, 'plain.tsx'), '');
        writeFileSync(join(dir, 'phone.native.tsx'), '');
        writeFileSync(join(dir, 'ODD.GTK.TSX'), '');
        mkdirSync(join(dir, 'grouped.desktop'));

        await it('asks the resolver for the sibling that exists', async () => {
            const ctx = tracker();
            const resolved = await handlerOf(indexed()).call(ctx, './card', importer);
            expect(resolved?.id).toBe('./card.gtk#resolved');
            expect(ctx.asked).toStrictEqual(['./card.gtk']);
        });

        // The whole point: six failed resolves per import become zero.
        await it('asks the resolver NOTHING when no sibling exists', async () => {
            const ctx = tracker();
            const resolved = await handlerOf(indexed()).call(ctx, './plain', importer);
            expect(resolved).toBe(null);
            expect(ctx.asked).toStrictEqual([]);
        });

        // A refused sibling is found by the same listing, so the warning survives
        // the optimisation — which is the thing an optimisation like this loses.
        await it('still warns about a .native sibling it walked past', async () => {
            const ctx = tracker();
            const resolved = await handlerOf(indexed()).call(ctx, './phone', importer);
            expect(resolved).toBe(null);
            expect(ctx.warnings.length).toBe(1);
            expect(ctx.warnings[0]?.includes('./phone.native')).toBe(true);
        });

        // A DIRECTORY named `<stem>.<suffix>` is a legitimate variant (its
        // index file resolves), so the index must not require a trailing dot.
        await it('counts a directory sibling, not only a file', async () => {
            const ctx = tracker();
            const resolved = await handlerOf(indexed()).call(ctx, './grouped', importer);
            expect(resolved?.id).toBe('./grouped.desktop#resolved');
        });

        // Lowercased comparison: on a case-insensitive filesystem the resolver
        // would have found this, so the filter must not be the thing that hides
        // it. Being loose here is always safe — the filter can only add a probe.
        await it('is case-insensitive, so it cannot hide a variant from the resolver', async () => {
            const ctx = tracker();
            const resolved = await handlerOf(indexed()).call(ctx, './odd', importer);
            expect(ctx.asked).toStrictEqual(['./odd.gtk']);
            expect(resolved?.id).toBe('./odd.gtk#resolved');
        });

        // A virtual importer id has no directory. "No opinion" must mean "ask the
        // resolver", never "there is nothing there".
        await it('falls through to the resolver for an unreadable directory', async () => {
            const ctx = tracker();
            await handlerOf(indexed()).call(ctx, './card', '\0gjsify-entry:/nowhere/app.ts');
            expect(ctx.asked).toStrictEqual(['./card.gtk']);
        });

        await it('cleans up its fixture directory', () => {
            rmSync(dir, { recursive: true, force: true });
            expect(true).toBe(true);
        });
    });
};
