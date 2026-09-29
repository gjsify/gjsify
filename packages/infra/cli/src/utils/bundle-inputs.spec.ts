// SPDX-License-Identifier: MIT
// The bundler's own answer to "what did this build read" — the half of
// `gjsify test`'s freshness set the package walk cannot see.

import { describe, it, expect } from '@gjsify/unit';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    BUNDLE_INPUTS_VERSION,
    bundleInputsPath,
    createBundleInputsRecorder,
    newestBundleInputMtimeMs,
    readBundleInputs,
} from './bundle-inputs.js';

/**
 * Drive the recorder's `transform` hook the way a bundler does. The hook is
 * reached through the plugin object, not through a private field, so this
 * cannot pass against a recorder whose plugin the build would refuse.
 */
function observe(recorder: ReturnType<typeof createBundleInputsRecorder>, ids: readonly string[]): void {
    const plugin = recorder.plugin as { transform: (code: string, id: string) => unknown };
    for (const id of ids) plugin.transform('export {};', id);
}

function fixture(): string {
    return mkdtempSync(join(tmpdir(), 'gjsify-bundle-inputs-'));
}

const file = (root: string, rel: string, body = '// x\n'): string => {
    const abs = join(root, ...rel.split('/'));
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, body, 'utf-8');
    return abs;
};

export default async () => {
    await describe('bundle-inputs', async () => {
        await it('records the modules the build transformed, outside the package', async () => {
            const root = fixture();
            try {
                const signal = file(root, 'packages/signal/src/index.ts');
                const entry = file(root, 'app/src/test.mts');
                const recorder = createBundleInputsRecorder(join(root, 'app', 'dist', 'test.node.mjs'));
                observe(recorder, [entry, signal]);

                const inputs = recorder.inputs();
                // A workspace package reached through a `node_modules` symlink is
                // the case the package walk is blind to, by construction.
                expect(inputs).toContain(signal);
                expect(inputs).toContain(entry);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('strips a query or hash off an id, which is part of the SPECIFIER', async () => {
            const root = fixture();
            try {
                const raw = file(root, 'src/main.blp');
                const rawCss = file(root, 'src/x.css');
                const recorder = createBundleInputsRecorder(join(root, 'dist', 'test.node.mjs'));
                // `main-window.blp?shared-tree` is the blueprint plugin's exit,
                // `x.css?raw` a loader convention: both stat as ENOENT, and
                // dropping the id would drop the file with it.
                observe(recorder, [`${raw}?shared-tree`, `${rawCss}?raw`, `${raw}#frag`]);
                expect(recorder.inputs()).toContain(raw);
                expect(recorder.inputs()).toContain(rawCss);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('keeps a file whose NAME carries the character it strips at', async () => {
            const root = fixture();
            try {
                // `?` is a legal filename character on Linux, and this id has no
                // query at all — stripping at the first `?` turned it into `a`,
                // which does not exist, and the input was dropped.
                const odd = file(root, 'src/a?b.blp');
                const recorder = createBundleInputsRecorder(join(root, 'dist', 'test.node.mjs'));
                observe(recorder, [odd]);
                expect(recorder.inputs()).toContain(odd);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('takes the engine watch list, the only account of a file no graph names', async () => {
            const root = fixture();
            try {
                const entry = file(root, 'app/src/test.mts');
                const imported = file(root, 'packages/theme/src/base.css');
                const recorder = createBundleInputsRecorder(join(root, 'app', 'dist', 'test.node.mjs'));
                // What a plugin declares with `this.addWatchFile` — a stylesheet's
                // `@import` target, which no module graph ever names.
                recorder.addWatchFiles({ files: [imported, entry], reportedByEngine: true });
                expect(recorder.inputs()).toContain(imported);
                expect(recorder.inputs()).toContain(entry);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('records the resolution files of each package, which are never modules', async () => {
            const root = fixture();
            try {
                const manifest = file(root, 'packages/signal/package.json', '{}\n');
                const tsconfig = file(root, 'packages/signal/tsconfig.json', '{}\n');
                const mod = file(root, 'packages/signal/src/index.ts');
                file(root, 'packages/signal/src/other.ts');
                const recorder = createBundleInputsRecorder(join(root, 'dist', 'test.node.mjs'));
                observe(recorder, [mod, join(root, 'packages/signal/src/other.ts')]);

                const inputs = recorder.inputs();
                // A `package.json#exports` edit moves what every bare specifier
                // resolves to, and a `tsconfig.json` turns on `paths` — neither is
                // a module, and both change the output.
                expect(inputs).toContain(manifest);
                expect(inputs).toContain(tsconfig);
                // Deduplicated: two modules of one package contribute one pair.
                expect(inputs.filter((abs) => abs === manifest)).toHaveLength(1);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('excludes the toolchain cache, whose entries are written AND deleted per build', async () => {
            const root = fixture();
            try {
                const stub = file(root, 'node_modules/.cache/gjsify/auto-globals-abc123.mjs');
                const real = file(root, 'src/lib.ts');
                const recorder = createBundleInputsRecorder(join(root, 'dist', 'test.node.mjs'));
                observe(recorder, [stub, real]);
                const inputs = recorder.inputs();
                expect(inputs).not.toContain(stub);
                expect(inputs).toContain(real);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('keeps a project that happens to live under a temp dir', async () => {
            // This suite's own fixtures do, and so does a CI checkout — a
            // freshness check that went blind there would be the defect being
            // fixed, reached from the other side.
            const root = fixture();
            try {
                const mod = file(root, 'src/lib.ts');
                const recorder = createBundleInputsRecorder(join(root, 'dist', 'test.node.mjs'));
                observe(recorder, [mod]);
                expect(recorder.inputs()).toContain(mod);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('leaves no temp file behind, and the manifest is what a reader gets', async () => {
            const root = fixture();
            try {
                const outfile = join(root, 'dist', 'test.node.mjs');
                const input = file(root, 'src/lib.ts');
                const recorder = createBundleInputsRecorder(outfile);
                observe(recorder, [input]);
                recorder.write();
                // Written to a sibling and renamed: a manifest is read by the
                // NEXT process, and a half-written one parses as "no manifest".
                expect(existsSync(`${bundleInputsPath(outfile)}.tmp`)).toBe(false);
                expect(readBundleInputs(outfile)?.inputs).toContain(input);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('drops virtual modules and paths that are not files', async () => {
            const root = fixture();
            try {
                const real = file(root, 'src/lib.ts');
                const recorder = createBundleInputsRecorder(join(root, 'dist', 'test.node.mjs'));
                // `\0` is the bundler's virtual-module marker; a plugin-invented
                // id is not a file either, and neither may become a stat that
                // fails on every run.
                observe(recorder, ['\0virtual:css-as-string', real, join(root, 'src', 'gone.ts')]);
                expect(recorder.inputs()).toStrictEqual([real]);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('deduplicates and sorts, so the manifest is stable across runs', async () => {
            const root = fixture();
            try {
                const b = file(root, 'src/b.ts');
                const a = file(root, 'src/a.ts');
                const recorder = createBundleInputsRecorder(join(root, 'dist', 'test.node.mjs'));
                observe(recorder, [b, a, b]);
                expect(recorder.inputs()).toStrictEqual([a, b].sort());
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('writes a manifest the read side accepts, beside the bundle', async () => {
            const root = fixture();
            try {
                const outfile = join(root, 'dist', 'test.node.mjs');
                const input = file(root, 'packages/signal/src/index.ts');
                const recorder = createBundleInputsRecorder(outfile);
                observe(recorder, [input]);
                recorder.write();

                expect(readBundleInputs(outfile)?.inputs).toStrictEqual([input]);
                expect(JSON.parse(readFileSync(bundleInputsPath(outfile), 'utf-8')).version).toBe(
                    BUNDLE_INPUTS_VERSION,
                );
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('records that the engine reported NO watch list, so no reader may call that fresh', async () => {
            const root = fixture();
            try {
                const outfile = join(root, 'dist', 'test.node.mjs');
                const input = file(root, 'src/lib.ts');
                const recorder = createBundleInputsRecorder(outfile);
                observe(recorder, [input]);
                // What a version-skewed engine reports: no watch list at all, so
                // a file only a PLUGIN read never reaches the set, and claiming
                // freshness on that set is the stale green. The manifest has to
                // carry the fact across processes, because that is where the
                // next run decides.
                recorder.addWatchFiles({ files: [], reportedByEngine: false });
                recorder.write();

                const read = readBundleInputs(outfile);
                expect(read?.watchList).toBe(false);
                expect(read?.inputs).toContain(input);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('reads a manifest that does not vouch for its engine as NOT having a watch list', async () => {
            const root = fixture();
            try {
                const outfile = join(root, 'dist', 'test.node.mjs');
                mkdirSync(join(root, 'dist'), { recursive: true });
                // A v2 manifest without the flag is malformed, and the pessimistic
                // reading is the one that costs a rebuild instead of a stale green.
                writeFileSync(
                    bundleInputsPath(outfile),
                    JSON.stringify({ version: BUNDLE_INPUTS_VERSION, inputs: [] }),
                    'utf-8',
                );
                expect(readBundleInputs(outfile)?.watchList).toBe(false);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('answers null for a bundle no manifest describes', async () => {
            const root = fixture();
            try {
                const outfile = join(root, 'dist', 'test.node.mjs');
                const manifest = bundleInputsPath(outfile);
                // Absent, corrupt, and another shape's version are all "no
                // manifest": the caller falls back to the package walk, and
                // treating any of them as an error would fail every run of a
                // bundle built before this shape existed.
                expect(readBundleInputs(outfile)).toBeNull();
                mkdirSync(join(root, 'dist'), { recursive: true });
                writeFileSync(manifest, '{not json', 'utf-8');
                expect(readBundleInputs(outfile)).toBeNull();
                writeFileSync(
                    manifest,
                    JSON.stringify({ version: BUNDLE_INPUTS_VERSION + 1, inputs: ['/x'] }),
                    'utf-8',
                );
                expect(readBundleInputs(outfile)).toBeNull();
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('reports the newest recorded mtime, and skips what has vanished', async () => {
            const root = fixture();
            try {
                const older = file(root, 'src/older.ts');
                const newer = file(root, 'src/newer.ts');
                const gone = file(root, 'src/gone.ts');
                utimesSync(older, new Date(1_000_000), new Date(1_000_000));
                utimesSync(newer, new Date(2_000_000), new Date(2_000_000));
                utimesSync(gone, new Date(9_000_000), new Date(9_000_000));

                expect(newestBundleInputMtimeMs([older, newer])).toBeGreaterThan(newestBundleInputMtimeMs([older]));
                expect(newestBundleInputMtimeMs([])).toBe(0);

                // A recorded input we cannot read is not evidence that the
                // artifact is current — the same rule the package walk applies,
                // and the reason a deleted-but-still-imported source rebuilds
                // instead of rerunning a bundle built from a file that is gone.
                rmSync(gone);
                expect(newestBundleInputMtimeMs([older, gone])).toBe(Number.POSITIVE_INFINITY);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });
    });
};
