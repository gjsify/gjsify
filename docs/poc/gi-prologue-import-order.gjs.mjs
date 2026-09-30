#!/usr/bin/env -S gjs -m
// SPDX-License-Identifier: MIT OR LGPL-2.0-or-later
//
// WHERE a `--app gjs` bundle may put its GI search-path prologue so that a STATIC
// `import … from 'gi://Ns'` still loads. Companion to ADR 0085 — read that for the
// decision; this file is the evidence under it.
//
// The question is not whether the prologue works (`tests/e2e/gi-runtime-prologue`
// pins that) but whether the one placement a BANNER can have is the only one
// available. A banner is the entry chunk's body, and a module's body runs after
// every one of its imports has been evaluated, so a static `gi://Ns` has already
// tried its `dlopen` by then. Each scenario below is a different PLACEMENT of the
// same prologue text against the same namespace, plus the two consequences the
// chosen placement carries into a program that runs a main loop.
//
// THE PROLOGUE TEXT IS THE REAL ONE, imported from the generator rather than
// retyped — a placement study measuring a hand-copied prologue would keep agreeing
// with itself after the generator changed. What the harness supplies itself is the
// candidate table: `giSystemProbes()` lives in the CLI, which does not load under a
// bare `gjs`, and the table is not what this file measures (the e2e suite and
// `gi-runtime-paths-banner.spec.ts` own it). The candidate here is derived from the
// RUNNING repository's own search path instead, by GI's own install layout rule
// (`<libdir>/girepository-1.0/Ns-V.typelib` beside `<libdir>/libns.dylib`).
//
//   gjs -m docs/poc/gi-prologue-import-order.gjs.mjs
//
// Exit 0 = every placement behaved as ADR 0085 records it on this host; non-zero =
// one regressed, i.e. the decision rests on a fact this runtime no longer has.
// SKIPPED (exit 0) where the host needs no repair at all: the whole question is
// dyld's, and on a host whose loader already finds the leaf every placement passes
// and the harness would measure nothing.

import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import GIRepository from 'gi://GIRepository';

import { giRuntimePathsStub } from '../../packages/infra/rolldown-plugin-gjsify/lib/plugins/gi-runtime-paths.js';

const system = imports.system;

/** The namespace under test: the one the ledger entry and ADR 0023 § 4 are about. */
const NS = 'Gtk';
const NS_VERSION = '4.0';

/** GI's install layout: a typelib dir named this has its libraries in the PARENT. */
const TYPELIB_SUBDIR = 'girepository-1.0';

/** How long a child may run before the harness reads it as wedged. */
const TIMEOUT_MS = 10_000;

/**
 * The library directory this host keeps {@link NS} in, or `null` when it has none
 * to find — read off the repository's OWN search path rather than a prefix table,
 * so the harness lands on Homebrew at either prefix, MacPorts or a custom build
 * without knowing any of them exist.
 */
function candidateLibDir() {
    for (const typelibDir of GIRepository.Repository.dup_default().get_search_path()) {
        if (GLib.path_get_basename(typelibDir) !== TYPELIB_SUBDIR) continue;
        if (!GLib.file_test(`${typelibDir}/${NS}-${NS_VERSION}.typelib`, GLib.FileTest.EXISTS)) continue;
        return GLib.path_get_dirname(typelibDir);
    }
    return null;
}

/**
 * The prologue as a bundle would carry it, for one candidate.
 *
 * The third element is the HOST marker — the platform scope `giSystemProbes()`
 * fills with a macOS plist. Here it is the candidate itself: this harness varies
 * PLACEMENT and holds everything else fixed, so a gate that is always true is the
 * right control, and the gate's own behaviour is measured where its table lives.
 */
function prologueFor(libDir) {
    return giRuntimePathsStub([], [[libDir, `${libDir}/${TYPELIB_SUBDIR}`, libDir]]);
}

/** What a child prints when the namespace loaded for real (a registered GType). */
const OK_MARKER = 'GI-NS-LOADED';

const USE_NS = [
    `if (!${NS}.Widget || !${NS}.Widget.$gtype) throw new Error('${NS} loaded without its GTypes');`,
    `print('${OK_MARKER}:' + ${NS}.Widget.$gtype.name);`,
].join('\n');

const STATIC_IMPORT = `import ${NS} from 'gi://${NS}?version=${NS_VERSION}';`;
const DYNAMIC_IMPORT = `const ${NS} = (await import('gi://${NS}?version=${NS_VERSION}')).default;`;

/**
 * Every placement, as `{ files, expect }`. `files` is a name → source map whose
 * `entry.js` is what the child runs; `expect` is `loads`, `fails` or `stalls`.
 *
 * The `fails` rows are not filler. A harness where every row passes cannot tell a
 * working prologue from a host that never needed one, and those rows are what makes
 * the passing ones mean something: the same program without the prologue, and the
 * same program with the prologue one import too late.
 */
function scenarios(prologue) {
    return {
        // The control for the whole file. Without the prologue this host cannot
        // resolve the typelib's bare-leaf library at all — if this row LOADS, the
        // host needs no repair and nothing below is a measurement.
        'no-prologue': {
            expect: 'fails',
            files: { 'entry.js': `${DYNAMIC_IMPORT}\n${USE_NS}\n` },
        },
        // What ships today (`plugins/gi-runtime-paths.ts` via the process-stub
        // banner) against the load shape it reaches: one that happens LATER.
        'banner-then-dynamic-import': {
            expect: 'loads',
            files: { 'entry.js': `${prologue}\n${DYNAMIC_IMPORT}\n${USE_NS}\n` },
        },
        // The gap ADR 0085 exists for: byte 1 of the FILE is not byte 1 of the
        // evaluation order, because a module's imports run before its body.
        'banner-then-static-import': {
            expect: 'fails',
            files: { 'entry.js': `${prologue}\n${STATIC_IMPORT}\n${USE_NS}\n` },
        },
        // A second MODULE, imported first — the placement a second emitted file
        // would have. It works, which locates the constraint precisely: GJS loads a
        // namespace when `gi://Ns` is EVALUATED, not when the graph is instantiated,
        // so any module evaluated ahead of it can still repair the loader.
        'prologue-module-first': {
            expect: 'loads',
            files: {
                'prologue.js': `${prologue}\n`,
                'entry.js': `import './prologue.js';\n${STATIC_IMPORT}\n${USE_NS}\n`,
            },
        },
        // The same two modules in the other order — so the row above is about
        // POSITION and not merely about being a separate file.
        'prologue-module-last': {
            expect: 'fails',
            files: {
                'prologue.js': `${prologue}\n`,
                'entry.js': `${STATIC_IMPORT}\nimport './prologue.js';\n${USE_NS}\n`,
            },
        },
        // A `gi://` import one module DEEPER than the entry, which is where most of
        // them really are (`@gjsify/gtk-host` imports Gtk, the app imports that).
        // The prologue module is still first in the entry's own import list, and the
        // repair still arrives in time — so the placement does not depend on the
        // static imports being the entry's.
        'prologue-module-first-transitive-import': {
            expect: 'loads',
            files: {
                'prologue.js': `${prologue}\n`,
                'dep.js': `${STATIC_IMPORT}\nexport const gtype = ${NS}.Widget.$gtype.name;\n`,
                'entry.js': `import './prologue.js';\nimport { gtype } from './dep.js';\nprint('${OK_MARKER}:' + gtype);\n`,
            },
        },
        // The decision: one file, the static import lowered to a top-level `await
        // import()` after the prologue. Also the only lowering that leaves the
        // `gi://` specifier in the artifact, which is what `ship/gi-namespaces.ts`
        // reads the typelib dependency set off.
        'lowered-to-await-import': {
            expect: 'loads',
            files: { 'entry.js': `${prologue}\n${DYNAMIC_IMPORT}\n${USE_NS}\n` },
        },
        // Rejected alternative: the legacy host object. It works, and that is the
        // point — it is refused on the grounds the ADR states, not because it fails
        // to load a namespace.
        'lowered-to-imports-gi-accessor': {
            expect: 'loads',
            files: {
                'entry.js': [
                    prologue,
                    `globalThis.imports.gi.versions.${NS} = '${NS_VERSION}';`,
                    `const ${NS} = globalThis.imports.gi.${NS};`,
                    USE_NS,
                    '',
                ].join('\n'),
            },
        },
        // Rejected alternative: GJS's own ESM gi loader, reached by its resource
        // path. Synchronous and free of `imports.*` — and an internal resource URL
        // with no stability contract, which is the ground it is refused on.
        'lowered-to-gjs-gi-resource': {
            expect: 'loads',
            files: {
                'entry.js': [
                    `import gi from 'resource:///org/gnome/gjs/modules/esm/gi.js';`,
                    prologue,
                    `const ${NS} = gi.require('${NS}', '${NS_VERSION}');`,
                    USE_NS,
                    '',
                ].join('\n'),
            },
        },
        // THE DECISION'S OWN COST, and it is not the top-level await as such. A
        // module that has awaited is a PROMISE JOB, and a blocking `GLib.MainLoop
        // .run()` entered from one parks the job queue: the idle source fires, the
        // continuation it schedules is queued behind the running job, and the
        // `loop.quit()` inside that continuation never arrives. Same program without
        // the await exits; with it, it wedges. Measured here rather than reasoned
        // about, because it is what the lowering does to a GTK application.
        'lowered-then-blocking-main-loop': {
            expect: 'stalls',
            files: {
                'entry.js': [
                    prologue,
                    DYNAMIC_IMPORT,
                    `const GLib = (await import('gi://GLib?version=2.0')).default;`,
                    'const loop = new GLib.MainLoop(null, false);',
                    'GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {',
                    '    Promise.resolve().then(() => loop.quit());',
                    '    return GLib.SOURCE_REMOVE;',
                    '});',
                    'loop.run();',
                    USE_NS,
                    '',
                ].join('\n'),
            },
        },
        // The same program on the shape gjsify already MANDATES for a GTK app
        // (`runAdwaitaApp`: `await Application.runAsync()`, never the sync `run()`).
        // `runAsync` returns to the job queue instead of blocking it, so the idle
        // source's continuation drains and the application quits — the lowering's
        // cost falls entirely on a shape the root AGENTS.md already forbids.
        'lowered-then-run-async': {
            expect: 'loads',
            files: {
                'entry.js': [
                    prologue,
                    DYNAMIC_IMPORT,
                    `const GLib = (await import('gi://GLib?version=2.0')).default;`,
                    `const app = new ${NS}.Application({ application_id: 'org.gjsify.GiPrologueProbe' });`,
                    "app.connect('activate', () => {",
                    '    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {',
                    '        Promise.resolve().then(() => app.quit());',
                    '        return GLib.SOURCE_REMOVE;',
                    '    });',
                    '});',
                    'await app.runAsync([]);',
                    USE_NS,
                    '',
                ].join('\n'),
            },
        },
    };
}

/**
 * Run one scenario's `entry.js` in a child `gjs` and return `{ outcome, stdout }`.
 *
 * The loader variables are DELETED rather than left alone, because this harness is
 * about what a process can repair from the inside: a developer shell exporting
 * `DYLD_FALLBACK_LIBRARY_PATH` (the documented workaround) makes every row pass and
 * measures nothing.
 *
 * The watchdog is the harness's own, not `timeout(1)` — that is a GNU coreutils
 * binary and macOS, the platform this whole question is about, does not ship it.
 * `force_exit()` is what makes a wedged child readable as an OUTCOME (`stalls`)
 * instead of hanging the run.
 */
function runScenario(dir, name, files) {
    const scenarioDir = `${dir}/${name}`;
    GLib.mkdir_with_parents(scenarioDir, 0o755);
    for (const [file, source] of Object.entries(files)) {
        GLib.file_set_contents(`${scenarioDir}/${file}`, source);
    }
    const launcher = Gio.SubprocessLauncher.new(Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_MERGE);
    for (const variable of ['DYLD_FALLBACK_LIBRARY_PATH', 'DYLD_LIBRARY_PATH', 'GI_TYPELIB_PATH']) {
        launcher.unsetenv(variable);
    }
    const proc = launcher.spawnv(['gjs', '-m', `${scenarioDir}/entry.js`]);

    const loop = new GLib.MainLoop(null, false);
    let stdout = '';
    let stalled = false;
    const watchdog = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TIMEOUT_MS, () => {
        stalled = true;
        proc.force_exit();
        return GLib.SOURCE_REMOVE;
    });
    proc.communicate_utf8_async(null, null, (source, result) => {
        // `communicate_utf8_finish` throws only on an I/O failure on the pipes; a
        // child that exits non-zero, or one this harness just killed, is a normal
        // return. A real pipe failure is left to propagate — it means the harness
        // read nothing and must not report a verdict.
        const [, out] = source.communicate_utf8_finish(result);
        stdout = (out ?? '').trimEnd();
        loop.quit();
    });
    loop.run();
    // Only when it has NOT fired: a one-shot source removes itself by returning
    // `SOURCE_REMOVE`, and removing it again is a GLib-CRITICAL on every stalled row.
    if (!stalled) GLib.source_remove(watchdog);
    proc.wait(null);

    const loaded = !stalled && proc.get_exit_status() === 0 && stdout.includes(OK_MARKER);
    return { outcome: stalled ? 'stalls' : loaded ? 'loads' : 'fails', stdout };
}

const libDir = candidateLibDir();
if (libDir === null) {
    print(`# SKIPPED — no search-path entry on this host holds ${NS}-${NS_VERSION}.typelib`);
    system.exit(0);
}

const tmp = GLib.dir_make_tmp('gjsify-gi-prologue-order-XXXXXX');
const rows = scenarios(prologueFor(libDir));
let failures = 0;

print(`# GI prologue placement on ${GLib.get_os_info('PRETTY_NAME') ?? 'this host'} — candidate ${libDir}`);
for (const [name, { expect, files }] of Object.entries(rows)) {
    const { outcome, stdout } = runScenario(tmp, name, files);
    const ok = outcome === expect;
    if (!ok) failures++;
    print(`\n## ${name} — ${ok ? 'PASS' : 'FAIL'} (${outcome}, expected ${expect})`);
    for (const line of stdout.split('\n')) if (line) print(`   ${line}`);
}

// Left in place on a failure: the generated scenario IS the reproduction, and
// deleting it is how a red row becomes unreadable.
if (failures === 0) Gio.File.new_for_path(tmp).trash(null);

print(
    `\n# ${failures === 0 ? 'EVERY PLACEMENT BEHAVED AS ADR 0085 RECORDS IT' : `${failures} PLACEMENT(S) REGRESSED — ${tmp}`}`,
);
system.exit(failures === 0 ? 0 : 1);
