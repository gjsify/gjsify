// Unit coverage for the `gjsify dev` plan: what gets built, launched and watched.
//
// The plan is DERIVED from the project's own build script, so the rows that
// matter are the precedence ones — a flag the script declares must survive, and
// a flag the user passes must win. The watch loop itself is covered end-to-end
// by `tests/e2e/dev-command`; this pins the resolution without a filesystem.

import { describe, expect, it } from '@gjsify/unit';
import { buildEntryPoint, noBundleError, planDev, readFlag, withFlag } from './dev-plan.js';

/** The `dev`-relevant scripts every `gjsify create` template ships. */
const TEMPLATE_SCRIPTS = {
    'build:gjs': 'gjsify build src/index.ts --app gjs --outfile dist/index.gjs.js --globals auto,dom',
    'build:node': 'gjsify build src/index.ts --app node --outfile dist/index.node.mjs --globals auto,dom',
    start: 'gjsify run dist/index.gjs.js',
};

export default async () => {
    await describe('dev-plan: flag helpers', async () => {
        await it('reads both `--flag value` and `--flag=value`', () => {
            expect(readFlag(['build', 'a.ts', '--outfile', 'x.js'], 'outfile')).toBe('x.js');
            expect(readFlag(['build', 'a.ts', '--outfile=x.js'], 'outfile')).toBe('x.js');
            expect(readFlag(['build', 'a.ts'], 'outfile')).toBe(undefined);
        });

        await it('replaces an existing flag in place, in either spelling', () => {
            expect(withFlag(['build', 'a.ts', '--app', 'gjs'], 'app', 'node')).toStrictEqual([
                'build',
                'a.ts',
                '--app',
                'node',
            ]);
            expect(withFlag(['build', 'a.ts', '--app=gjs'], 'app', 'node')).toStrictEqual([
                'build',
                'a.ts',
                '--app=node',
            ]);
        });

        await it('appends a flag the argv does not carry', () => {
            expect(withFlag(['build', 'a.ts'], 'app', 'gjs')).toStrictEqual(['build', 'a.ts', '--app', 'gjs']);
        });

        await it('reads the entry point only from the slot right after `build`', () => {
            expect(buildEntryPoint(['build', 'src/index.ts', '--app', 'gjs'])).toBe('src/index.ts');
            // A flag in that slot means the script takes its entry from config;
            // a later positional is indistinguishable from a flag's value.
            expect(buildEntryPoint(['build', '--app', 'gjs'])).toBe(undefined);
        });
    });

    await describe('dev-plan: planDev', async () => {
        await it('inherits every flag the template build script declares', () => {
            const plan = planDev({ scripts: TEMPLATE_SCRIPTS, scriptName: 'build:gjs', app: 'gjs' });
            expect(plan.buildArgv).toStrictEqual([
                'build',
                'src/index.ts',
                '--app',
                'gjs',
                '--outfile',
                'dist/index.gjs.js',
                '--globals',
                'auto,dom',
            ]);
            expect(plan.bundle).toBe('dist/index.gjs.js');
            expect(plan.watchDir).toBe('src');
        });

        await it('reads the node twin from build:node', () => {
            const plan = planDev({ scripts: TEMPLATE_SCRIPTS, scriptName: 'build:node', app: 'node' });
            expect(readFlag(plan.buildArgv, 'app')).toBe('node');
            expect(plan.bundle).toBe('dist/index.node.mjs');
        });

        await it('forces --app to the runtime that will launch, not the script', () => {
            // `--script build:gjs --runtime node` is a legal combination, and the
            // launcher is what must decide the build target.
            const plan = planDev({ scripts: TEMPLATE_SCRIPTS, scriptName: 'build:gjs', app: 'node' });
            expect(readFlag(plan.buildArgv, 'app')).toBe('node');
        });

        await it('lets CLI overrides beat the script', () => {
            const plan = planDev({
                scripts: TEMPLATE_SCRIPTS,
                scriptName: 'build:gjs',
                app: 'gjs',
                entry: 'src/main.ts',
                globals: 'auto',
                outfile: 'dist/other.gjs.js',
                watchDir: 'lib',
            });
            expect(buildEntryPoint(plan.buildArgv)).toBe('src/main.ts');
            expect(readFlag(plan.buildArgv, 'globals')).toBe('auto');
            expect(plan.bundle).toBe('dist/other.gjs.js');
            expect(plan.watchDir).toBe('lib');
        });

        await it('splices an entry into a script that names none', () => {
            const plan = planDev({
                scripts: { 'build:gjs': 'gjsify build --app gjs --outfile dist/index.gjs.js' },
                scriptName: 'build:gjs',
                app: 'gjs',
                entry: 'src/index.ts',
            });
            expect(plan.buildArgv.slice(0, 2)).toStrictEqual(['build', 'src/index.ts']);
        });

        await it('falls back to gjsify.main when no --outfile is declared', () => {
            const plan = planDev({
                scripts: { 'build:gjs': 'gjsify build src/index.ts --app gjs' },
                scriptName: 'build:gjs',
                app: 'gjs',
                declaredBundle: 'dist/index.gjs.js',
            });
            expect(plan.bundle).toBe('dist/index.gjs.js');
        });

        await it('works with no build script at all when an entry is named', () => {
            const plan = planDev({
                scripts: {},
                scriptName: 'build:gjs',
                app: 'gjs',
                entry: 'src/index.ts',
                outfile: 'dist/index.gjs.js',
            });
            expect(plan.buildArgv).toStrictEqual([
                'build',
                'src/index.ts',
                '--app',
                'gjs',
                '--outfile',
                'dist/index.gjs.js',
            ]);
        });

        await it('names both fixes when there is no entry to build', () => {
            let message = '';
            try {
                planDev({ scripts: {}, scriptName: 'build:gjs', app: 'gjs' });
            } catch (err) {
                message = (err as Error).message;
            }
            expect(message).toContain('gjsify dev src/index.ts');
            expect(message).toContain('--script');
        });

        await it('refuses a compound build script rather than half-reading it', () => {
            // `gjsify run build:gjs && …` is a shell command, not an argv.
            let message = '';
            try {
                planDev({
                    scripts: { 'build:gjs': 'gjsify build src/index.ts && echo done' },
                    scriptName: 'build:gjs',
                    app: 'gjs',
                });
            } catch (err) {
                message = (err as Error).message;
            }
            expect(message).toContain('not a plain');
        });

        await it('plans without a bundle when nothing names an output file', () => {
            // Not an error here: a build writing an `--outdir` has no single
            // output file, and `--build-only` never needs one.
            const plan = planDev({
                scripts: { 'build:gjs': 'gjsify build src/index.ts --app gjs' },
                scriptName: 'build:gjs',
                app: 'gjs',
            });
            expect(plan.bundle).toBe(undefined);
        });
    });

    await describe('dev-plan: noBundleError', async () => {
        await it('names the declaration for the target and both ways out', () => {
            const gjs = noBundleError('build:gjs', 'gjs').message;
            expect(gjs).toContain('gjsify.main');
            expect(gjs).toContain('--outfile');
            expect(gjs).toContain('--build-only');
            expect(noBundleError('build:node', 'node').message).toContain('gjsify.example.node');
        });
    });
};
