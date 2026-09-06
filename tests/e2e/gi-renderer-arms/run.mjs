// E2E for the ADR 0034 stage 9 `gi://` arms — `gjsify build --gi-renderer` on
// `--app browser` and `--app nativescript`.
//
// WHAT THIS EXISTS FOR. `gi://Ns?version=X` already resolves on three of the four build
// targets: natively on `--app gjs`, through `requireGi` on `--app node`, and to an EMPTY
// MODULE on `--app browser` / `--app nativescript`. The empty one is a silent defect the
// moment the import is real: `Adw.ActionRow` is `undefined`, and a class extending it
// throws `Class extends value undefined is not a constructor or null` — measured on both
// targets before the arm existed, and the exact string ADR 0034's stage table predicted.
// The `redControl` row below builds the same fixture WITHOUT the flag and asserts that
// failure verbatim, so it never becomes a claim about the past.
//
// WHY THE CONTROL IS LOAD-BEARING RATHER THAN DECORATIVE. Neither target's runtime exists
// on a Node test host, so `probe-runner.mjs` stubs one (see its header). A stub that
// answers everything could in principle be what makes a green row green — and the control
// is the measurement that rules it out: same stub, same fixture, arm off, and the widget
// class is still `undefined`. A stub cannot invent a constructor.
//
// WHAT A BUILD-AND-EVAL LEG DOES NOT PROVE. It never runs on a browser engine or on the
// NativeScript V8 runtime, so nothing here says an `<adw-action-row>` LAYS OUT or that a
// `GridLayout` measures. `tests/browser/` and `tests/integration/nativescript/` are those
// venues, and `ns-bridge-bundles`' header states the same limit for its own leg.
//
// The CLI is driven from its Node entry with the monorepo as cwd, like `ns-bridge-bundles`:
// the fixtures are IN the repository so the renderer packages resolve through the same
// workspace edges a consumer's `node_modules` would provide. That needs a BUILT tree.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MONOREPO_ROOT, e2eSkipReason } from '../helpers.mjs';

const SUITE = 'gi-renderer-arms';
const CLI_ENTRY = join(MONOREPO_ROOT, 'packages/infra/cli/lib/index.js');
const SUITE_DIR = join(MONOREPO_ROOT, 'tests/e2e', SUITE);
const FIXTURES = join(SUITE_DIR, 'fixtures');
const RUNNER = join(SUITE_DIR, 'probe-runner.mjs');

/** `@gjsify/adwaita-web`'s `.` export is `src/index.ts`, but its styles are generated. */
const WEB_BUILT = join(MONOREPO_ROOT, 'packages/web/adwaita-web/src/styles.generated.ts');
const NS_BUILT = join(MONOREPO_ROOT, 'packages/nativescript-bridge/adwaita/lib/esm/index.js');

/**
 * The two arms, exactly as `GI_RENDERERS` in `@gjsify/resolve-npm` declares them. Spelled
 * here so the suite states what it EXPECTS rather than importing the table it is testing —
 * a check reading its subject's own table agrees with it by construction.
 */
const ARMS = [
    { app: 'browser', renderer: '@gjsify/adwaita-web', namespaces: { Adw: '1', Gtk: '4.0' } },
    { app: 'nativescript', renderer: '@gjsify/adwaita-nativescript', namespaces: { Adw: '1', Gtk: '4.0' } },
];

const skip = e2eSkipReason(SUITE, [
    ['the CLI is built (`gjsify run build:infra`)', existsSync(CLI_ENTRY)],
    ['@gjsify/adwaita-web is built (`gjsify workspace @gjsify/adwaita-web build`)', existsSync(WEB_BUILT)],
    ['@gjsify/adwaita-nativescript is built', existsSync(NS_BUILT)],
]);

describe('gjsify build --gi-renderer: the gi:// arms', { timeout: 15 * 60 * 1000, skip }, () => {
    let tmpDir;

    before(() => {
        tmpDir = mkdtempSync(join(tmpdir(), `gjsify-e2e-${SUITE}-`));
        console.log(`  tmp dir: ${tmpDir}`);
    });

    after(() => {
        if (process.env.GJSIFY_E2E_KEEP_TEMP) console.log(`  keeping tmp dir: ${tmpDir}`);
        else if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    });

    /** Build one fixture; returns the process result plus the outfile path. */
    function build(fixture, app, { arm = true, name = fixture } = {}) {
        const outDir = mkdtempSync(join(tmpDir, `${app}-`));
        const outFile = join(outDir, `${name.replace(/\W+/g, '-')}.mjs`);
        const result = spawnSync(
            process.execPath,
            [
                CLI_ENTRY,
                'build',
                join(FIXTURES, fixture),
                '--app',
                app,
                ...(arm ? ['--gi-renderer'] : []),
                '--outfile',
                outFile,
            ],
            { cwd: MONOREPO_ROOT, encoding: 'utf-8', timeout: 5 * 60 * 1000 },
        );
        return { ...result, outFile, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
    }

    /** Evaluate a built bundle in a child process under the target's stub host. */
    function evaluate(outFile, app, mode = 'load') {
        const result = spawnSync(process.execPath, [RUNNER, app, outFile, mode], {
            cwd: MONOREPO_ROOT,
            encoding: 'utf-8',
            timeout: 2 * 60 * 1000,
        });
        assert.equal(result.status, 0, `probe-runner failed for ${outFile}\n${result.stdout}\n${result.stderr}`);
        try {
            return JSON.parse(result.stdout);
        } catch {
            throw new Error(`probe-runner printed no JSON for ${outFile}\n${result.stdout}\n${result.stderr}`);
        }
    }

    for (const arm of ARMS) {
        const { app, renderer } = arm;

        // The red the ADR predicted, kept as a permanent row. It is also the control on the
        // stub host: the SAME host, the SAME fixture, and the widget class is undefined.
        it(`--app ${app} without the flag still resolves gi://Adw to an empty module`, () => {
            const built = build('probe.ts', app, { arm: false, name: 'red-control' });
            assert.equal(built.status, 0, `red control failed to build\n${built.output}`);
            const report = evaluate(built.outFile, app);
            assert.equal(
                report.loaded,
                false,
                `the arm-off bundle loaded; the empty module is gone: ${JSON.stringify(report)}`,
            );
            assert.match(
                report.error,
                /Class extends value undefined/,
                `expected the ADR's predicted failure, got ${report.error}`,
            );
        });

        it(`--app ${app} --gi-renderer resolves gi://Adw?version=1 to ${renderer}`, () => {
            const built = build('probe.ts', app);
            assert.equal(built.status, 0, `build failed\n${built.output}`);
            assert.ok(existsSync(built.outFile) && statSync(built.outFile).size > 0, 'bundle missing or empty');

            const bundle = readFileSync(built.outFile, 'utf-8');
            // The arm substitutes a module; it must not leave the specifier behind — the
            // same rule `app-browser` and `ns-bridge-bundles` hold over their own bundles,
            // and read the same way, as text. Because it is text, THIS assertion is also
            // the only thing forbidding the arm's emitted refusal from quoting a `gi://`
            // URL: those two suites never pass `--gi-renderer`, so the arm's diagnostics
            // cannot reach them. The `textual-mention` row below is where the two answers
            // — "no import survived" and "these four characters are absent" — come apart.
            assert.ok(!bundle.includes('gi://'), 'the bundle leaks a gi:// specifier');
            assert.ok(!bundle.includes('@girs/'), 'the bundle leaks an @girs/* specifier');

            const report = evaluate(built.outFile, app);
            assert.equal(report.error, null, `bundle failed to evaluate: ${report.error}`);
            assert.equal(report.kind, 'function', 'Adw.ActionRow is not a constructor');
            assert.equal(
                report.protoIdentity,
                true,
                'the subclass does not extend the namespace member it was taken from',
            );

            if (app === 'browser') {
                // ADR 0034 § 6's assertion, by identity rather than by class name — the
                // build minifies, so a name comparison would be measuring the minifier.
                assert.equal(
                    report.registeredIdentity,
                    true,
                    `Adw.ActionRow is not the constructor registered as <adw-action-row> (${report.registrySize} elements defined)`,
                );
                assert.equal(
                    report.constructed,
                    true,
                    `new Adw.ActionRow() did not produce an element: ${report.constructError}`,
                );
            } else {
                // The NativeScript half of the same question: the class came from a module
                // that subclasses the runtime's own core, which is what a renderer is.
                assert.equal(
                    report.reachesCore,
                    true,
                    'Adw.ActionRow does not descend from an @nativescript/core class',
                );
                assert.match(
                    bundle,
                    /import\s*\{[^}]*\}\s*from\s*["']@nativescript\/core["']/,
                    'the NS core peer was inlined or resolved away',
                );
            }
        });

        it(`--app ${app} --gi-renderer answers gi://Gtk?version=4.0 as well`, () => {
            const built = build('gtk-probe.ts', app);
            assert.equal(built.status, 0, `build failed\n${built.output}`);
            const report = evaluate(built.outFile, app);
            assert.equal(report.error, null, `bundle failed to evaluate: ${report.error}`);
            assert.equal(report.kind, 'function', 'Gtk.Button is not a constructor');
            assert.equal(
                report.protoIdentity,
                true,
                'the subclass does not extend the namespace member it was taken from',
            );
        });

        it(`--app ${app} --gi-renderer carries @girs/adw-1 through to the same namespace`, () => {
            const withArm = build('girs-probe.ts', app, { name: 'girs-on' });
            assert.equal(withArm.status, 0, `build failed\n${withArm.output}`);
            assert.equal(evaluate(withArm.outFile, app).kind, 'function', '@girs/adw-1 did not reach the renderer');

            // The other side of the `emptyGirs` carve-out: without the arm, `@girs/*` is
            // the empty module and the same file compiles to `typeof {}.ActionRow`.
            const withoutArm = build('girs-probe.ts', app, { arm: false, name: 'girs-off' });
            assert.equal(withoutArm.status, 0, `control build failed\n${withoutArm.output}`);
            assert.equal(
                evaluate(withoutArm.outFile, app).kind,
                'undefined',
                '@girs/adw-1 was not emptied without the arm',
            );
        });

        it(`--app ${app} --gi-renderer refuses a namespace with no renderer, by name`, () => {
            const built = build('unanswered-namespace.ts', app);
            assert.notEqual(built.status, 0, `an unanswerable namespace built anyway\n${built.output}`);
            assert.match(built.output, /gi:\/\/Gio/, 'the refusal does not name the specifier it refused');
            assert.ok(built.output.includes(renderer), `the refusal does not name ${renderer}`);
            for (const namespace of Object.keys(arm.namespaces)) {
                assert.ok(built.output.includes(namespace), `the refusal does not say it answers ${namespace}`);
            }

            // And the pre-arm behaviour is untouched: the same import is still a silent
            // empty module for a build that did not ask for the arm.
            const control = build('unanswered-namespace.ts', app, { arm: false, name: 'unanswered-off' });
            assert.equal(control.status, 0, `the flag-less build stopped accepting gi://Gio\n${control.output}`);
        });

        it(`--app ${app} --gi-renderer refuses a version it does not answer, by name`, () => {
            const built = build('wrong-version.ts', app);
            assert.notEqual(built.status, 0, `a mismatched ?version= built anyway\n${built.output}`);
            assert.match(built.output, /version 2/, 'the refusal does not name the version that was asked for');
            assert.match(built.output, /version 1/, 'the refusal does not name the version it answers');
        });

        // The two refusals above act on SPECIFIERS. This row is the other half of that
        // sentence: the same two strings, sitting in the source as literals, must be left
        // alone. A text-shaped arm would fail this build twice over.
        it(`--app ${app} --gi-renderer refuses gi:// imports, not gi:// text`, () => {
            const built = build('textual-mention.ts', app, { name: 'textual' });
            assert.equal(built.status, 0, `a gi:// string literal was read as an import\n${built.output}`);

            const bundle = readFileSync(built.outFile, 'utf-8');
            assert.match(bundle, /gi:\/\/Gio\?version=2\.0/, 'the unanswerable-namespace literal did not survive');
            assert.match(bundle, /gi:\/\/Adw\?version=9/, 'the wrong-version literal did not survive');

            // The leak guard in the `resolves gi://Adw` row reads `bundle.includes('gi://')`.
            // This bundle carries those four characters and is nevertheless clean, and the
            // proof that no occurrence is an import is the build's own exit code, not a second
            // reading of the same bytes: the arm refuses BOTH of these specifiers, so an
            // import-shaped one could not have produced a status of 0. A substring is not
            // an import — `status/open-todos.md` argues the guards from this bundle.
            assert.ok(
                bundle.includes('gi://'),
                'the fixture no longer puts a gi:// substring in the bundle, so this row measures nothing',
            );

            // …and the real import beside the literals still landed on the arm, so the row
            // cannot go green by the arm being absent.
            const report = evaluate(built.outFile, app);
            assert.equal(report.error, null, `bundle failed to evaluate: ${report.error}`);
            assert.equal(report.kind, 'function', 'the real gi:// import did not reach the renderer');
            assert.equal(report.protoIdentity, true, 'the subclass does not extend the namespace member');
        });

        it(`--app ${app} --gi-renderer refuses an absent MEMBER by name, at runtime`, () => {
            const built = build('absent-member.ts', app);
            assert.equal(built.status, 0, `build failed\n${built.output}`);
            const report = evaluate(built.outFile, app, 'member');
            assert.notEqual(report.refusal, null, 'reading an absent namespace member returned silently');
            assert.match(report.refusal, /ApplicationWindow/, 'the refusal does not name the member');
            assert.ok(report.refusal.includes(renderer), `the refusal does not name ${renderer}`);
            // It has to print what IS there — a refusal that only says "no" leaves the
            // caller with nothing to correct the import to.
            assert.match(report.refusal, /ActionRow/, 'the refusal does not print the members that exist');
        });
    }

    for (const app of ['gjs', 'node']) {
        it(`--gi-renderer is refused on --app ${app}, which already answers gi://`, () => {
            const built = build('probe.ts', app, { name: `no-arm-${app}` });
            assert.notEqual(built.status, 0, `--gi-renderer was accepted and ignored on --app ${app}\n${built.output}`);
            assert.match(
                built.output,
                /--gi-renderer has no effect on --app/,
                'the refusal does not say the flag does nothing',
            );
            for (const arm of ARMS) {
                assert.ok(
                    built.output.includes(arm.app),
                    `the refusal does not name ${arm.app} as a target that has an arm`,
                );
            }
        });
    }

    // The versions the arms answer are a GIR fact, not a renderer preference, and this is
    // where the two derivations meet: `@gjsify/gtk-host`'s widget table is emitted by a
    // generator that never reads the build layer and stamps the namespace versions it was
    // built from. A GIR bump that moves `Adw-1` fails here rather than in a consumer.
    it('the arms answer the namespace versions gtk-host generated its table from', () => {
        const generated = readFileSync(
            join(MONOREPO_ROOT, 'packages/framework/gtk-host/src/generated/widgets.ts'),
            'utf-8',
        );
        const stamp = /GENERATED_PROVENANCE = '([^']+)'/.exec(generated);
        assert.ok(stamp, 'gtk-host no longer stamps GENERATED_PROVENANCE');
        const fromGir = new Map(
            stamp[1].split(' ').map((entry) => {
                const [namespaceAndVersion] = entry.split('/');
                const index = namespaceAndVersion.lastIndexOf('-');
                return [namespaceAndVersion.slice(0, index), namespaceAndVersion.slice(index + 1)];
            }),
        );
        for (const arm of ARMS) {
            for (const [namespace, version] of Object.entries(arm.namespaces)) {
                assert.equal(
                    fromGir.get(namespace),
                    version,
                    `--app ${arm.app} answers ${namespace} ${version}; gtk-host generated its table from ` +
                        `${namespace} ${fromGir.get(namespace)} (${stamp[1]})`,
                );
            }
        }
    });
});
