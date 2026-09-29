// SPDX-License-Identifier: MIT
// The bundler's own answer to "what did this build read" — the half of
// `gjsify test`'s freshness set the package walk cannot see.

import { describe, it, expect } from '@gjsify/unit';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
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

                expect(readBundleInputs(outfile)).toStrictEqual([input]);
                expect(JSON.parse(readFileSync(bundleInputsPath(outfile), 'utf-8')).version).toBe(
                    BUNDLE_INPUTS_VERSION,
                );
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

                // The build's own scratch does not outlive it (the globals-inject
                // stub is a temp file), so a vanished input is not a change —
                // treating it as one would rebuild on every run, forever.
                rmSync(gone);
                expect(newestBundleInputMtimeMs([older, gone])).toBe(newestBundleInputMtimeMs([older]));
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });
    });
};
