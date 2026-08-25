#!/usr/bin/env node
// `@gjsify/gtk-host`'s GENERATED type surface is checked — both dialects, negative-first.
//
// WHAT IS BEING GUARDED
//
// `src/generated/props.ts` is derived from the GTK/Adwaita GIR: 164 kebab tags, 164 GType
// keys, every writable property in BOTH spellings, `on<Signal>` handlers carrying the GIR
// signature, `*Nick` unions carrying the enum nicks. Dialect surfaces sit on top of it —
// `jsx-runtime.ts` for JSX/Solid, `react-jsx-runtime.ts` for React, `vue-components.ts` for
// Vue's `GlobalComponents`. None of
// that is exercised by `gjsify tsc --noEmit` on the package: a type surface type-checks
// against ITSELF whatever it says about `<gtk-box>`, and a surface that accepts everything is
// indistinguishable from a correct one until something tries to write a wrong program.
//
// WHY NEGATIVE-FIRST, and why this file is not just two `tsc` invocations
//
// A suite of POSITIVE fixtures cannot detect a misconfigured compiler. The failure mode is
// specific and measured: with `jsx: "preserve"`, no `jsxImportSource` and `noImplicitAny`
// off, every JSX element is implicitly `any`, so `tsc` reports nothing and exits 0 having
// checked NOTHING. That is the repository's most expensive shape — a green check that
// verified nothing — so every claim this script makes has a negative behind it:
//
//   · JSX halves (`jsx` for Solid, `react` for React — one mechanism, two dialects and two
//     fixture directories): each negative carries a `@ts-expect-error`, and TypeScript reports
//     an UNUSED `@ts-expect-error` as an error (TS2578). So each negative asserts ITS OWN
//     failure and the half reduces to "exit code 0" with no error output to parse. A separate
//     SENTINEL program then carries one deliberate, unsuppressed error, because exit 0 is also
//     what a compiler that never read a fixture reports.
//   · Vue half: `@ts-expect-error` does not work inside an SFC template, so each negative
//     declares the error code it must produce in its own first line and the script asserts an
//     EXPECTED SET — per file, both directions (a negative with no error, and an error in a
//     positive, both fail).
//   · Both halves: the load-bearing compiler settings are re-run FLIPPED on every invocation,
//     and each negative declares which settings it depends on (`needs=`). A setting whose
//     removal changes nothing is not load-bearing, and a gate that cannot show the difference
//     is asserting its own configuration.
//
// WHAT THIS DOES NOT PROVE
//
//   · Nothing about RUNTIME. This is a type-level gate; that GTK accepts the value a nick
//     denotes is the package's conformance suite (`src/conformance/`), and that a real
//     application compiles and renders is the four `showcases/gtk/*-host-counter` probes.
//   · The `react` half does NOT re-state the element list. `GtkReactIntrinsicElements` is a
//     mapped type over the same generated `WidgetPropsByTag`/`WidgetClassByTag` the `jsx` half
//     already gates property by property, so a second copy of that matrix would only drift.
//     What the `react` half adds is the React-specific plumbing — `JSX.Element`,
//     `JSX.ElementType`, `JSX.IntrinsicAttributes` and React's `Ref<T>`/`ReactNode` spellings
//     of `ref` and `children` — plus the two tag negatives that prove the React runtime
//     reaches that shared list at all.
//   · Not that a HYPHENATED unknown JSX attribute is refused — it is not, and cannot be.
//     TypeScript exempts every hyphen-containing JSX attribute from excess-property checking,
//     so `<gtk-box no-such={1}/>` is accepted. `type-tests/jsx/known-hole-hyphen.tsx` holds
//     that hole as a fixture that must keep COMPILING, so the day TypeScript closes it the
//     fixture turns red and someone deletes it. The Vue half does not share the hole: Volar
//     camelizes a template attribute before looking it up.
//   · Not that `package.json#exports` carries the `./jsx-runtime` and `./vue-components`
//     subpaths a consumer imports. The fixtures resolve the package's own subpath to `src/`
//     through a `paths` entry, deliberately (below); the shipped-shape question belongs to
//     `verify-package-outputs.mjs`.
//   · Nothing about a BUILT artifact. Resolving to `src/` is what keeps this gate runnable in
//     `tree-checks`, which needs no build — and it was not a free choice: measured in a
//     working tree, `lib/esm/jsx-runtime.js` existed while `lib/types/jsx-runtime.d.ts` did
//     not, so the build-resolving variant reported the whole surface as an implicit `any` for
//     a reason that had nothing to do with the surface.
//
// MEASURED CONFIGURATION TRAPS, each of which silently produces a green half
//
//  1. `vue-tsc` (3.3.11 / @vue/language-core 3.3.11) lets the BASE of an `extends` chain win
//     `vueCompilerOptions.strictTemplates` in BOTH directions: a child setting it `false`
//     over a `true` base stays STRICT, and a child setting it `true` over a `false` base stays
//     LAX. So the Vue probes are generated as STANDALONE configs (compilerOptions copied from
//     the committed one, which is asserted to carry no path-valued key), never with `extends`
//     — a probe built with `extends` would have re-measured the strict config and reported
//     that `strictTemplates` changes nothing. The JSX probes DO use `extends`, where
//     `compilerOptions` overrides were measured to apply.
//  2. A tsconfig whose `include` lists only `.ts` globs makes `vue-tsc` check ZERO SFCs and
//     exit 0. Every half therefore asserts the PROGRAM CONTENTS with `--listFiles`, not just
//     the exit code: every fixture on disk must be in the program that claims to have checked
//     it. Probe `ts-only-include` keeps the trap itself executable.
//  3. The two JSX halves EVAPORATE DIFFERENTLY, and one probe table could not serve both.
//     Under `jsx: "preserve"` (the `jsx` half) an unset `jsxImportSource` leaves no JSX
//     namespace at all, so `noImplicitAny: false` turns the whole surface into `any`. Under
//     `jsx: "react-jsx"` (the `react` half) an unset or EMPTY `jsxImportSource` falls back to
//     `"react"` — measured byte-identical to naming it — so "drop it" and "point it at react"
//     are ONE failure there, and the evaporating shape has to take `jsx` away too. Worse,
//     `@types/react` declares a GLOBAL `JSX` namespace, so a program that imports React's
//     types has React's 208 tags as its fallback surface: with a `react` type import in the
//     probe program, `evaporate` silenced 1 of 8 assertions instead of 6. The `react`
//     negatives are therefore deliberately free of `react` imports, and that is stated in
//     their own header rather than only here.
//
// Usage: node scripts/check-type-surfaces.mjs [--help] [--root <dir>] [--only jsx|react|vue] [--no-probes]

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HELP = `check-type-surfaces — hold @gjsify/gtk-host's generated type surface, every dialect.

  node scripts/check-type-surfaces.mjs [options]

  --root <dir>     repository root (default: the parent of scripts/)
  --only <half>    run one half only: jsx, react or vue
  --no-probes      skip the load-bearing-setting probes (they are the half of this
                   gate that proves the settings matter; skip only when bisecting)
  --help           this text

Exits 0 when every half holds, 1 on any deviation or harness failure.`;

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
    console.log(HELP);
    process.exit(0);
}

const rootFlag = args.indexOf('--root');
const ROOT = rootFlag === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : resolve(args[rootFlag + 1]);
const onlyFlag = args.indexOf('--only');
const ONLY = onlyFlag === -1 ? null : args[onlyFlag + 1];
const PROBES = !args.includes('--no-probes');

const HALF_NAMES = ['jsx', 'react', 'vue'];
if (ONLY !== null && !HALF_NAMES.includes(ONLY)) {
    console.error(`check-type-surfaces: --only takes one of ${HALF_NAMES.join(', ')}, got ${JSON.stringify(ONLY)}`);
    process.exit(1);
}

const PKG = join(ROOT, 'packages', 'framework', 'gtk-host');
const TYPE_TESTS = join(PKG, 'type-tests');
const VUE_DIR = join(TYPE_TESTS, 'vue');
/**
 * Under the package's gitignored `tmp/`, which `gjsify clear` already owns.
 *
 * TWO levels below the package root, exactly like `type-tests/<half>/`, and that is
 * load-bearing rather than incidental: the stripped copies of the negatives are compiled from
 * HERE, so a fixture's relative import (`../../src/types.js`, which the React plumbing
 * negatives need) has to resolve to the same file from both places. It self-reports if it
 * ever stops: the baseline run would raise a `TS2307` no directive covers.
 */
const WORK = join(PKG, 'tmp', 'type-surfaces');

const require = createRequire(import.meta.url);

/** A run that could not happen is not a run that found nothing — it exits 1 with its own word. */
const harnessFailures = [];
/** A surface/config deviation: what this gate is for. */
const failures = [];
/** Everything the run actually measured, printed at the end so a vacuous run is visible. */
const measured = [];

/** A measurement is only printed when the step it describes produced no failure. */
function measureIfClean(before, line) {
    if (failures.length === before) measured.push(line);
}

function harnessFail(message) {
    harnessFailures.push(message);
}

function fail(message) {
    failures.push(message);
}

/**
 * The compiler settings a negative can DEPEND ON, and which probe removes each.
 *
 * A negative declares its dependencies with `needs=a,b`; a probe removes exactly one
 * capability and then requires precisely the negatives naming it to go green while every
 * other negative still errors. Both halves of that are asserted: a probe under which
 * everything goes green is measuring a broken program, not a load-bearing setting.
 */
const CAPABILITIES = new Map([
    ['jsxSurface', 'the JSX surface being wired at all (`jsxImportSource` + `noImplicitAny`)'],
    // Shared by both JSX halves, because it is one claim asked of two dialects: the element
    // list must be OURS. The probe that removes it differs — `jsx` repoints `jsxImportSource`
    // at `solid-js`, `react` at `react` — and both land on the same 208 HTML/SVG/MathML tags.
    ['ownRuntime', 'shipping our OWN jsx-runtime instead of borrowing the framework’s element list'],
    ['strictFunctionTypes', '`strictFunctionTypes` (without it a handler parameter is bivariant)'],
    ['strictTemplates', '`vueCompilerOptions.strictTemplates`'],
    ['none', 'nothing — the negative holds under every probe'],
]);

// ── reading the fixtures ────────────────────────────────────────────────

/**
 * `// @ts-expect-error TS1234[ needs=a,b] — why`, as its OWN line.
 *
 * The grammar is enforced rather than merely parsed: a directive this regex cannot read is a
 * FAILURE, because a `@ts-expect-error` that carries no code is invisible to the stripped run
 * below and would sit in the tree suppressing whatever it happens to hit. The whole-line form
 * is required for the same reason — the stripped run maps a directive on line N to the error
 * it must produce on line N+1, and a trailing directive has no such line.
 */
const JSX_DIRECTIVE = /^\s*\/\/\s*@ts-expect-error\b/;
const JSX_ANNOTATION = /^\s*\/\/\s*@ts-expect-error\s+TS(\d+)(?:\s+needs=([A-Za-z,]+))?\s+—\s+\S/;
/** `<!-- expect-error: TS1234[ needs=a,b] — why`, anywhere in an SFC's leading comment. */
const VUE_ANNOTATION = /expect-error:\s*TS(\d+)(?:\s+needs=([A-Za-z,]+))?\s+—\s+\S/;
/** The sentinel declares its code the same way, being a whole program with one expectation. */
const SENTINEL_ANNOTATION = VUE_ANNOTATION;
/** Suppression without assertion. `@ts-ignore` hides an error and claims nothing about it. */
const FORBIDDEN_SUPPRESSION = /@ts-ignore|@ts-nocheck/;
/**
 * The BLOCK-comment spelling, which TypeScript honours and this gate deliberately does not.
 *
 * `/* @ts-expect-error *\/` is a directive to the compiler, so it would suppress an error while
 * being invisible to the line-oriented inventory below — a negative that asserts nothing and
 * reports as one more assertion. Refused by name rather than supported: one spelling, one
 * grammar, and the stripped run can then account for every directive in the tree.
 */
const BLOCK_DIRECTIVE = /\/\*[^\n]*@ts-expect-error/;

function listFixtures(dir, extension) {
    let entries;
    try {
        entries = readdirSync(dir);
    } catch (error) {
        harnessFail(`cannot read ${dir}: ${error.message}`);
        return [];
    }
    return entries.filter((name) => name.endsWith(extension)).sort();
}

function readFixture(file) {
    try {
        return readFileSync(file, 'utf8');
    } catch (error) {
        harnessFail(`cannot read ${file}: ${error.message}`);
        return null;
    }
}

/**
 * `needs=a,b` → the capabilities a negative depends on.
 *
 * `implicit` is added unless the annotation says `needs=none`: in the JSX half every negative
 * depends on the surface being wired at all, and spelling `jsxSurface` on all twelve of them
 * only invites the copy that forgets it. `none` is the escape for a negative that is NOT a
 * surface check — `<GtkBox/>` is TS2304, an undefined identifier, and holds under every probe.
 */
function parseNeeds(raw, where, implicit) {
    const names = (raw ?? '').split(',').filter((name) => name !== '');
    for (const name of names) {
        if (!CAPABILITIES.has(name)) {
            fail(
                `${where}: needs=${name} is not a capability this gate knows. ` +
                    `Known: ${[...CAPABILITIES.keys()].join(', ')}. A capability with no probe behind it ` +
                    'is an unverified claim — add the probe in the same change.',
            );
        }
    }
    if (names.includes('none')) return [];
    return implicit === undefined || names.includes(implicit) ? names : [...names, implicit];
}

/**
 * The JSX fixture inventory, classified BY NAME so an unclassified file cannot be ignored.
 *
 * `positive*` must compile clean and carry no directive; `negative-*` must carry at least one;
 * `known-hole-*` must carry NONE (it documents what is accepted); `sentinel` is a program of
 * its own with an inverted expectation.
 */
function jsxInventory(half) {
    const inventory = { positives: [], negatives: [], holes: [], sentinel: null, assertions: [] };
    for (const name of listFixtures(half.dir, '.tsx')) {
        const file = join(half.dir, name);
        const text = readFixture(file);
        if (text === null) continue;
        if (BLOCK_DIRECTIVE.test(text)) {
            fail(
                `${name}: uses the block-comment /* @ts-expect-error */ form. TypeScript honours it and this ` +
                    'gate cannot see it, so the negative would suppress its error and still be counted. Use the ' +
                    '`// @ts-expect-error TS<code> — <why>` line form.',
            );
        }
        if (FORBIDDEN_SUPPRESSION.test(text)) {
            fail(
                `${name}: uses @ts-ignore/@ts-nocheck. Only @ts-expect-error asserts anything — it FAILS when the error stops happening.`,
            );
        }

        const lines = text.split('\n');
        const directives = [];
        lines.forEach((line, index) => {
            if (!JSX_DIRECTIVE.test(line)) return;
            const match = JSX_ANNOTATION.exec(line);
            if (match === null) {
                fail(
                    `${name}:${index + 1}: @ts-expect-error does not match the grammar ` +
                        '`// @ts-expect-error TS<code>[ needs=<caps>] — <why>`. Without the code the stripped run ' +
                        'cannot check WHICH error it suppresses.',
                );
                return;
            }
            directives.push({
                file,
                name,
                // The directive suppresses the NEXT line, which is where the error must land.
                line: index + 2,
                code: `TS${match[1]}`,
                needs: parseNeeds(match[2], `${name}:${index + 1}`, 'jsxSurface'),
            });
        });

        if (name === 'sentinel.tsx') {
            const match = SENTINEL_ANNOTATION.exec(text);
            if (match === null) {
                fail(
                    'sentinel.tsx: no `expect-error: TS<code> — <why>` line. The sentinel must name the error it produces.',
                );
            }
            if (directives.length > 0) {
                fail('sentinel.tsx: carries a @ts-expect-error. Suppressed, it could not underwrite anything.');
            }
            inventory.sentinel = { file, name, code: match === null ? null : `TS${match[1]}` };
        } else if (name.startsWith('negative-')) {
            if (directives.length === 0) fail(`${name}: a negative fixture with no @ts-expect-error asserts nothing.`);
            inventory.negatives.push(name);
            inventory.assertions.push(...directives);
        } else if (name.startsWith('known-hole-')) {
            if (directives.length > 0) {
                fail(
                    `${name}: a known-hole fixture must COMPILE (that is the measurement) — remove the @ts-expect-error.`,
                );
            }
            inventory.holes.push(name);
        } else if (name.startsWith('positive')) {
            if (directives.length > 0)
                fail(`${name}: a positive fixture must compile clean — move the negative to negative-*.tsx.`);
            inventory.positives.push(name);
        } else {
            fail(
                `${name}: unclassified fixture. Name it positive*.tsx, negative-*.tsx, known-hole-*.tsx ` +
                    'or sentinel.tsx — an unnamed kind is a fixture nothing asserts anything about.',
            );
        }
    }
    return inventory;
}

/** The Vue inventory: `positive*` must be clean, `negative-*` must declare one expected code. */
function vueInventory() {
    const inventory = { positives: [], negatives: [] };
    for (const name of listFixtures(VUE_DIR, '.vue')) {
        const file = join(VUE_DIR, name);
        const text = readFixture(file);
        if (text === null) continue;
        const match = VUE_ANNOTATION.exec(text);
        if (name.startsWith('negative-')) {
            if (match === null) {
                fail(
                    `${name}: no \`expect-error: TS<code>[ needs=<caps>] — <why>\` line. ` +
                        '`@ts-expect-error` does not work in a template, so the expectation has to live in the ' +
                        'fixture or it drifts away from it.',
                );
                continue;
            }
            inventory.negatives.push({
                file,
                name,
                code: `TS${match[1]}`,
                needs: parseNeeds(match[2], name),
            });
        } else if (name.startsWith('positive')) {
            if (match !== null)
                fail(`${name}: a positive fixture declares an expected error — move it to negative-*.vue.`);
            inventory.positives.push({ file, name });
        } else {
            fail(`${name}: unclassified fixture. Name it positive*.vue or negative-*.vue.`);
        }
    }
    return inventory;
}

// ── running the compilers ───────────────────────────────────────────────

function resolveBin(specifier, label) {
    try {
        return require.resolve(specifier);
    } catch (error) {
        harnessFail(`cannot resolve ${label} (${specifier}): ${error.message}. Run the workspace install first.`);
        return null;
    }
}

const TSC = resolveBin('typescript/bin/tsc', 'tsc');
const VUE_TSC = resolveBin('vue-tsc/bin/vue-tsc.js', 'vue-tsc');

/**
 * One compiler invocation, with the two shapes a crash takes kept apart from a type error.
 *
 * `$?` after a pipe is the wrong status and `--strict false` reads `false` as a FILENAME: both
 * are why nothing here goes through a shell. The compiler is spawned as a Node program with an
 * argv array, and a signal or a spawn error is reported as a HARNESS failure — a crash that
 * printed no diagnostics must never read as "no errors found".
 */
function compile(bin, configPath, extraArgs = []) {
    if (bin === null) return null;
    const result = spawnSync(process.execPath, [bin, '-p', configPath, ...extraArgs], {
        cwd: ROOT,
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
    });
    if (result.error) {
        harnessFail(`${relative(ROOT, configPath)}: could not spawn the compiler: ${result.error.message}`);
        return null;
    }
    if (result.signal !== null) {
        harnessFail(`${relative(ROOT, configPath)}: compiler died on ${result.signal} — this is not "no errors".`);
        return null;
    }
    if (typeof result.status !== 'number') {
        harnessFail(`${relative(ROOT, configPath)}: compiler produced no exit status.`);
        return null;
    }
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    return { code: result.status, output, diagnostics: parseDiagnostics(output), program: parseProgram(output) };
}

/**
 * `path(line,col): error TS1234: message` at column 0 only.
 *
 * The continuation lines of a diagnostic are indented and carry no location, so anchoring at
 * column 0 is what keeps one error from being counted several times — and a nested "Types of
 * parameters … are incompatible" line from being read as an error of its own.
 */
const DIAGNOSTIC = /^(\S.*?)\((\d+),(\d+)\): error (TS\d+):/;
/** A diagnostic with no file at all: `error TS18003: No inputs were found …`. */
const GLOBAL_DIAGNOSTIC = /^error (TS\d+):/;

function parseDiagnostics(output) {
    const diagnostics = [];
    for (const line of output.split('\n')) {
        const located = DIAGNOSTIC.exec(line);
        if (located !== null) {
            diagnostics.push({
                file: resolve(ROOT, located[1]),
                line: Number(located[2]),
                code: located[4],
                text: line,
            });
            continue;
        }
        const global = GLOBAL_DIAGNOSTIC.exec(line);
        if (global !== null) diagnostics.push({ file: null, line: 0, code: global[1], text: line });
    }
    return diagnostics;
}

/** `--listFiles` prints one absolute path per line; everything else in the output is not a path. */
function parseProgram(output) {
    return new Set(
        output
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => /^([/\\]|[A-Za-z]:[/\\]).*\.(tsx?|vue|mts|cts)$/.test(line))
            .map((line) => resolve(line)),
    );
}

/**
 * The program must CONTAIN what the run claims to have checked.
 *
 * This is the direct answer to the vacuous-green shape: an `include` that matches nothing (or
 * only `.ts` globs, in the Vue half's case) exits 0 with an empty program, and no assertion
 * about diagnostics can tell that apart from a clean tree.
 */
function assertProgramCovers(label, program, expectedFiles) {
    const missing = expectedFiles.filter((file) => !program.has(resolve(file)));
    if (missing.length > 0) {
        fail(
            `${label}: ${missing.length} fixture(s) are NOT in the compiled program: ` +
                `${missing.map((file) => relative(ROOT, file)).join(', ')}. The run checked something else.`,
        );
        return false;
    }
    if (expectedFiles.length === 0) {
        fail(`${label}: no fixtures — a check with nothing to check reports green and proves nothing.`);
        return false;
    }
    return true;
}

// ── the work directory ──────────────────────────────────────────────────

function prepareWorkDir() {
    rmSync(WORK, { recursive: true, force: true });
    mkdirSync(WORK, { recursive: true });
}

function writeWorkFile(name, contents) {
    const file = join(WORK, name);
    writeFileSync(file, contents, 'utf8');
    return file;
}

// ── the JSX halves: Solid and React ─────────────────────────────────────
//
// ONE mechanism, one fixture grammar, one `checkJsxHalf`, two dialects. They are separate
// HALVES rather than one directory because the compiler settings they pin are different in
// kind — `jsx: "preserve"` handing JSX to a framework compiler versus `jsx: "react-jsx"`
// naming an automatic runtime — and therefore so is every probe that removes one. Sharing the
// table would have meant a `checkJsxHalf` that branches on the dialect, which is the same
// second truth in a different place.

/**
 * A JSX-dialect half: where its fixtures live and what removing each setting must do.
 *
 * `probes` remove ONE capability each and are asserted from both sides: the negatives
 * declaring it go green, and every other negative still errors. The second half is what stops
 * a probe from "passing" because the program broke. `configProbes` are settings TypeScript
 * refuses at the config level, so they have no per-negative expectation.
 */
const JSX_HALVES = [
    {
        name: 'jsx',
        dir: join(TYPE_TESTS, 'jsx'),
        config: join(TYPE_TESTS, 'jsx', 'tsconfig.json'),
        sentinelConfig: join(TYPE_TESTS, 'jsx', 'tsconfig.sentinel.json'),
        probes: [
            {
                name: 'evaporate',
                disables: 'jsxSurface',
                options: { noImplicitAny: false, jsxImportSource: '' },
                why: 'jsx=preserve + no jsxImportSource + noImplicitAny=false — every element becomes implicitly `any`',
            },
            {
                name: 'solid-namespace',
                disables: 'ownRuntime',
                options: { jsxImportSource: 'solid-js', paths: {} },
                why: "pointing at Solid's own namespace leaves its 208 HTML/SVG/MathML tags valid on a GTK renderer",
            },
            {
                name: 'bivariant',
                disables: 'strictFunctionTypes',
                options: { strictFunctionTypes: false },
                why: 'a handler parameter narrowed to a subtype stops being an error',
            },
        ],
        configProbes: [
            {
                name: 'jsx-react',
                options: { jsx: 'react' },
                expect: 'TS5089',
                why: '`jsx: "react"` cannot be combined with jsxImportSource — the setting a consumer reaches for first',
            },
        ],
    },
    {
        name: 'react',
        dir: join(TYPE_TESTS, 'react'),
        config: join(TYPE_TESTS, 'react', 'tsconfig.json'),
        sentinelConfig: join(TYPE_TESTS, 'react', 'tsconfig.sentinel.json'),
        probes: [
            {
                // NOT the `jsx` half's evaporating shape, and the difference is measured rather
                // than stylistic. Under `jsx: "react-jsx"` an unset or EMPTY `jsxImportSource`
                // DEFAULTS to `"react"` — byte-identical to the `react-namespace` probe below —
                // so taking the surface away needs `jsx` itself. `noImplicitAny` is what makes
                // the difference between loud and silent once it is gone: with it on, the same
                // config reports `TS7026` on every element; with it off, exit 0 and nothing.
                name: 'evaporate',
                disables: 'jsxSurface',
                options: { noImplicitAny: false, jsx: 'preserve', jsxImportSource: '' },
                why: 'no jsxImportSource + noImplicitAny=false — TS7026 on every element becomes silence',
            },
            {
                // Also the measurement for "the consumer forgot `jsxImportSource`": TypeScript
                // defaults it to `"react"` under `jsx: "react-jsx"`, so forgetting it and naming
                // it produce the same program, and the same 208 tags.
                name: 'react-namespace',
                disables: 'ownRuntime',
                options: { jsxImportSource: 'react', paths: {} },
                why: "pointing at React's own namespace brings @types/react's 208 HTML/SVG/MathML tags back onto a GTK renderer",
            },
        ],
        // No config probe: `jsx: "react"` + `jsxImportSource` is TS5089 whatever the dialect,
        // and the `jsx` half already holds it. The setting a React consumer gets wrong instead
        // is `jsx: "preserve"` copied from the Solid recipe — which type-checks CLEAN here and
        // fails at BUILD time, where `packages/infra/cli/src/utils/jsx-config.ts` and the
        // post-bundle parse check own it.
        configProbes: [],
    },
];

function writeJsxProbeConfig(half, name, options, includes) {
    // `extends` with an absolute base was MEASURED to carry the base's relative `paths` and to
    // honour a child's compilerOptions overrides, which is what keeps the probes from being a
    // second copy of the committed settings.
    const config = {
        extends: resolve(half.config),
        compilerOptions: options,
        include: includes.map((file) => resolve(file)),
        exclude: [],
    };
    return writeWorkFile(`tsconfig.${half.name}-${name}.json`, `${JSON.stringify(config, null, 4)}\n`);
}

/**
 * Strip the directives into a copy, keeping the line numbering.
 *
 * This is what makes every negative individually checkable. With the directive in place a
 * negative asserts only THAT an error happens (any error, on that line); with the directives
 * gone the run reports the errors themselves, so the annotated code can be compared and an
 * error appearing anywhere ELSE is caught too.
 */
function stripDirectives(half, names) {
    const stripped = new Map();
    for (const name of names) {
        const text = readFixture(join(half.dir, name));
        if (text === null) continue;
        const bare = text
            .split('\n')
            .map((line) => (JSX_DIRECTIVE.test(line) ? '//' : line))
            .join('\n');
        stripped.set(name, writeWorkFile(`_stripped-${half.name}-${name}`, bare));
    }
    return stripped;
}

function checkJsxHalf(half) {
    const inventory = jsxInventory(half);
    const gateFixtures = [...inventory.positives, ...inventory.negatives, ...inventory.holes].map((name) =>
        join(half.dir, name),
    );

    if (inventory.negatives.length === 0)
        fail(`${half.name}: no negative fixtures. A positive-only suite cannot detect a misconfigured compiler.`);
    if (inventory.positives.length === 0)
        fail(`${half.name}: no positive fixture. Without one, a surface that refuses everything scores perfect.`);
    if (inventory.sentinel === null)
        fail(`${half.name}: no sentinel.tsx. Without it, "exit 0" and "read nothing" are the same result.`);

    // (a) THE GATE. Exit code 0 — checked as a code, never as the absence of error lines —
    // means every positive compiled and every @ts-expect-error was consumed.
    const beforeGate = failures.length;
    const gate = compile(TSC, half.config, ['--listFiles']);
    if (gate !== null) {
        assertProgramCovers(`${half.name} gate`, gate.program, gateFixtures);
        if (gate.code !== 0) {
            fail(
                `${half.name} gate: tsc exited ${gate.code}, expected 0. Either a positive fixture broke or a ` +
                    `@ts-expect-error went unused (TS2578 — the negative stopped being an error):\n${reportOutput(gate)}`,
            );
        } else {
            measureIfClean(
                beforeGate,
                `${half.name} gate: exit 0 over ${gateFixtures.length} fixture(s) — ` +
                    `${inventory.positives.length} positive, ${inventory.negatives.length} negative ` +
                    `(${inventory.assertions.length} assertions), ${inventory.holes.length} documented hole(s)`,
            );
        }
    }

    // (b) THE SENTINEL. One deliberate, unsuppressed error in a program of its own: the run
    // that reports the half green has shown, in the same invocation, that it can still see an
    // error at all.
    if (inventory.sentinel !== null) {
        const sentinel = compile(TSC, half.sentinelConfig);
        if (sentinel !== null) {
            const hit = sentinel.diagnostics.find(
                (diagnostic) =>
                    diagnostic.file === resolve(inventory.sentinel.file) && diagnostic.code === inventory.sentinel.code,
            );
            if (sentinel.code === 0 || hit === undefined) {
                fail(
                    `${half.name} sentinel: expected a failing run reporting ${inventory.sentinel.code} in ` +
                        `${relative(ROOT, inventory.sentinel.file)}, got exit ${sentinel.code}:\n${reportOutput(sentinel)}` +
                        '\n  A harness that cannot see THIS error cannot have seen the negatives either.',
                );
            } else {
                measured.push(
                    `${half.name} sentinel: exit ${sentinel.code} carrying ${inventory.sentinel.code} — the harness reports errors`,
                );
            }
        }
    }

    if (inventory.assertions.length === 0) return;

    // (c) EVERY NEGATIVE, INDIVIDUALLY, with its annotated code.
    const stripped = stripDirectives(half, inventory.negatives);
    const strippedFiles = [...stripped.values()];
    const byStrippedFile = new Map([...stripped].map(([name, file]) => [resolve(file), name]));
    const baselineConfig = writeJsxProbeConfig(half, 'baseline', {}, strippedFiles);
    const baseline = compile(TSC, baselineConfig, ['--listFiles']);
    if (baseline === null) return;
    assertProgramCovers(`${half.name} negatives`, baseline.program, strippedFiles);

    const located = new Map();
    for (const diagnostic of baseline.diagnostics) {
        if (diagnostic.file === null) {
            fail(
                `${half.name} negatives: a diagnostic with no file — the program is wrong, not the fixtures: ${diagnostic.text}`,
            );
            continue;
        }
        const key = `${byStrippedFile.get(diagnostic.file) ?? diagnostic.file}:${diagnostic.line}`;
        if (!located.has(key)) located.set(key, []);
        located.get(key).push(diagnostic);
    }

    let proven = 0;
    for (const assertion of inventory.assertions) {
        const key = `${assertion.name}:${assertion.line}`;
        const hits = located.get(key) ?? [];
        if (hits.length === 0) {
            fail(
                `${assertion.name}:${assertion.line}: with its @ts-expect-error stripped this line produces NO error. ` +
                    'Either the negative is not a negative — the surface accepts it, and the directive was ' +
                    'suppressing something else — or the assertion no longer occupies ONE line: oxfmt wraps at ' +
                    '120 columns, and a wrapped element puts the error further down, where nothing covers it.',
            );
            continue;
        }
        if (!hits.some((hit) => hit.code === assertion.code)) {
            fail(
                `${assertion.name}:${assertion.line}: annotated ${assertion.code}, got ` +
                    `${[...new Set(hits.map((hit) => hit.code))].join('/')}. Fix the annotation or the fixture — a ` +
                    'directive suppresses ANY error, so the code is only checkable here.',
            );
            continue;
        }
        proven++;
        located.delete(key);
    }
    for (const [key, hits] of located) {
        fail(`${half.name} negatives: unexpected error at ${key} — no @ts-expect-error covers it: ${hits[0].text}`);
    }
    if (proven > 0) {
        const codes = [...new Set(inventory.assertions.map((assertion) => assertion.code))].sort();
        measured.push(
            `${half.name} negatives: ${proven}/${inventory.assertions.length} fire individually with the annotated code (${codes.join(', ')})`,
        );
    }

    if (!PROBES) return;

    // (d) THE SETTINGS. Each probe removes one capability; the negatives naming it must go
    // green and every other negative must stay red. The second half is what stops a probe
    // from passing because the program broke.
    for (const probe of half.probes) {
        const before = failures.length;
        const label = `probe ${half.name}/${probe.name}`;
        const configPath = writeJsxProbeConfig(half, probe.name, probe.options, strippedFiles);
        const run = compile(TSC, configPath);
        if (run === null) continue;
        const erroring = new Set(
            run.diagnostics
                .filter((diagnostic) => diagnostic.file !== null)
                .map((diagnostic) => `${byStrippedFile.get(diagnostic.file) ?? diagnostic.file}:${diagnostic.line}`),
        );
        let silenced = 0;
        let survived = 0;
        for (const assertion of inventory.assertions) {
            const key = `${assertion.name}:${assertion.line}`;
            const dependsOnProbe = assertion.needs.includes(probe.disables);
            if (dependsOnProbe && erroring.has(key)) {
                fail(
                    `${label}: ${key} declares needs=${probe.disables} but still errors without it. ` +
                        'Either the setting is not what makes that negative work, or the annotation is wrong.',
                );
            } else if (!dependsOnProbe && !erroring.has(key)) {
                fail(
                    `${label}: ${key} went green, and it does not declare needs=${probe.disables}. ` +
                        `Removing ${probe.disables} silently disabled more than it claims — add it to the ` +
                        'annotation, or the probe is measuring a broken program.',
                );
            }
            if (dependsOnProbe) silenced++;
            else survived++;
        }
        if (silenced === 0) {
            fail(
                `${label}: no negative declares needs=${probe.disables}, so the probe proves nothing. ` +
                    'A setting nothing depends on is not load-bearing — drop the setting or add the negative.',
            );
        } else {
            measureIfClean(
                before,
                `${label} (removes ${probe.disables}): ${silenced} negative(s) go green, ${survived} still error — ${probe.why}`,
            );
        }
    }

    for (const probe of half.configProbes) {
        const label = `probe ${half.name}/${probe.name}`;
        const configPath = writeJsxProbeConfig(half, probe.name, probe.options, strippedFiles);
        const run = compile(TSC, configPath);
        if (run === null) continue;
        const hit = run.diagnostics.some((diagnostic) => diagnostic.code === probe.expect);
        if (run.code === 0 || !hit) {
            fail(
                `${label}: expected ${probe.expect}, got exit ${run.code}:\n${reportOutput(run)}` + `\n  ${probe.why}`,
            );
        } else {
            measured.push(`${label}: refused with ${probe.expect} — ${probe.why}`);
        }
    }
}

// ── the Vue SFC half ────────────────────────────────────────────────────

const VUE_CONFIG = join(VUE_DIR, 'tsconfig.json');
/** The `GlobalComponents` augmentation only applies to a program that LOADS it. */
const VUE_AUGMENTATION = join(PKG, 'src', 'vue-components.ts');

const VUE_PROBES = [
    {
        name: 'lax-templates',
        disables: 'strictTemplates',
        vueOptions: { strictTemplates: false },
        why: 'without it an unknown prop, an unknown event and an UNRESOLVED tag are all accepted, while wrong value types still error — so the gate looks alive and checks the wrong half',
    },
];

/** compilerOptions keys whose values are PATHS, and which a copied config would therefore break. */
const PATH_VALUED = [
    'paths',
    'baseUrl',
    'rootDir',
    'rootDirs',
    'outDir',
    'declarationDir',
    'typeRoots',
    'tsBuildInfoFile',
];

/**
 * Read the committed Vue config with TypeScript's own JSONC parser.
 *
 * Not a regex: a comment stripper that mis-lexes a string literal reads a DIFFERENT config
 * than the compiler does, and this file's whole job is to not do that.
 */
function readVueConfig() {
    let ts;
    try {
        ts = require('typescript');
    } catch (error) {
        harnessFail(`cannot load typescript for JSONC parsing: ${error.message}`);
        return null;
    }
    const text = readFixture(VUE_CONFIG);
    if (text === null) return null;
    const parsed = ts.parseConfigFileTextToJson(VUE_CONFIG, text);
    if (parsed.error !== undefined) {
        harnessFail(
            `cannot parse ${relative(ROOT, VUE_CONFIG)}: ${ts.flattenDiagnosticMessageText(parsed.error.messageText, ' ')}`,
        );
        return null;
    }
    const config = parsed.config ?? {};
    if (config.extends !== undefined) {
        fail(
            `${relative(ROOT, VUE_CONFIG)}: must not use \`extends\`. Measured on vue-tsc 3.3.11, the BASE of an ` +
                'extends chain wins `vueCompilerOptions.strictTemplates` in both directions, so the setting this ' +
                'half depends on would be decided somewhere this gate does not read.',
        );
    }
    const options = config.compilerOptions ?? {};
    const offending = PATH_VALUED.filter((key) => options[key] !== undefined);
    if (offending.length > 0) {
        fail(
            `${relative(ROOT, VUE_CONFIG)}: carries path-valued compilerOptions (${offending.join(', ')}). ` +
                'The Vue probes COPY compilerOptions into a standalone config (extends cannot override ' +
                'vueCompilerOptions), and a relative path would silently resolve against the wrong directory.',
        );
    }
    if (options.strict !== true) {
        fail(`${relative(ROOT, VUE_CONFIG)}: expected "strict": true — the SFC half asserts value types.`);
    }
    if ((config.vueCompilerOptions ?? {}).strictTemplates !== true) {
        fail(
            `${relative(ROOT, VUE_CONFIG)}: expected vueCompilerOptions.strictTemplates: true — it is the load-bearing setting of this half.`,
        );
    }
    return config;
}

function writeVueProbeConfig(name, base, vueOptions, includes) {
    const config = {
        compilerOptions: base.compilerOptions ?? {},
        vueCompilerOptions: { ...base.vueCompilerOptions, ...vueOptions },
        include: includes.map((file) => resolve(file)),
    };
    return writeWorkFile(`tsconfig.vue-${name}.json`, `${JSON.stringify(config, null, 4)}\n`);
}

/** Attribute the diagnostics of one run to the fixtures, both directions. */
function scoreVueRun(label, run, inventory, expectation) {
    const byFile = new Map();
    for (const diagnostic of run.diagnostics) {
        if (diagnostic.file === null) {
            fail(`${label}: a diagnostic with no file — the program is wrong, not the fixtures: ${diagnostic.text}`);
            continue;
        }
        if (!byFile.has(diagnostic.file)) byFile.set(diagnostic.file, []);
        byFile.get(diagnostic.file).push(diagnostic);
    }

    for (const positive of inventory.positives) {
        const hits = byFile.get(resolve(positive.file)) ?? [];
        if (hits.length > 0) fail(`${label}: ${positive.name} must compile clean, got ${hits[0].text}`);
        byFile.delete(resolve(positive.file));
    }

    let held = 0;
    for (const negative of inventory.negatives) {
        const hits = byFile.get(resolve(negative.file)) ?? [];
        byFile.delete(resolve(negative.file));
        const verdict = expectation(negative);
        if (verdict === 'errors') {
            if (hits.length === 0) {
                fail(
                    `${label}: ${negative.name} produced NO error. The surface accepts what the fixture says it must refuse.`,
                );
                continue;
            }
            if (!hits.some((hit) => hit.code === negative.code)) {
                fail(
                    `${label}: ${negative.name} declares ${negative.code}, got ` +
                        `${[...new Set(hits.map((hit) => hit.code))].join('/')} — ${hits[0].text}`,
                );
                continue;
            }
            held++;
        } else if (hits.length > 0) {
            fail(
                `${label}: ${negative.name} still errors, but it declares needs=${negative.needs.join(',')} — ${hits[0].text}`,
            );
        } else {
            held++;
        }
    }
    for (const [file, hits] of byFile) {
        fail(`${label}: unexpected error in ${relative(ROOT, file)}: ${hits[0].text}`);
    }
    return held;
}

function checkVueHalf() {
    const inventory = vueInventory();
    const base = readVueConfig();
    if (inventory.negatives.length === 0)
        fail('vue: no negative fixtures. The positives alone cannot tell strictTemplates from silence.');
    if (inventory.positives.length === 0)
        fail('vue: no positive fixture. Without one, a surface that refuses everything scores perfect.');

    const sfcs = [...inventory.positives, ...inventory.negatives].map((fixture) => fixture.file);

    // (a) THE GATE. Unlike the JSX half this run is EXPECTED to fail: `@ts-expect-error` does
    // not reach into a template, so the assertion is the exact diagnostic SET, and exit 0
    // would mean every negative stopped being an error.
    const beforeGate = failures.length;
    const gate = compile(VUE_TSC, VUE_CONFIG, ['--listFiles']);
    if (gate !== null) {
        assertProgramCovers('vue gate', gate.program, sfcs);
        if (gate.code === 0) {
            fail(
                `vue gate: vue-tsc exited 0 with ${inventory.negatives.length} negative fixture(s) present. ` +
                    'Every negative stopped erroring at once, which is what a lost `strictTemplates` or an ' +
                    '`include` that missed the SFCs looks like.',
            );
        }
        const held = scoreVueRun('vue gate', gate, inventory, () => 'errors');
        if (held > 0 && held === inventory.negatives.length) {
            const codes = [...new Set(inventory.negatives.map((negative) => negative.code))].sort();
            const sfcsCompiled = [...gate.program].filter((file) => file.endsWith('.vue')).length;
            measureIfClean(
                beforeGate,
                `vue gate: ${sfcsCompiled} SFC(s) in the program, ${inventory.positives.length} clean, ` +
                    `${held} negative(s) each with its declared code (${codes.join(', ')})`,
            );
        }
    }

    if (!PROBES || base === null) return;

    // (b) THE SETTING. Re-run the same fixtures with strictTemplates off.
    for (const probe of VUE_PROBES) {
        const before = failures.length;
        const configPath = writeVueProbeConfig(probe.name, base, probe.vueOptions, [...sfcs, VUE_AUGMENTATION]);
        const run = compile(VUE_TSC, configPath);
        if (run === null) continue;
        const silenced = inventory.negatives.filter((negative) => negative.needs.includes(probe.disables));
        if (silenced.length === 0) {
            fail(`probe ${probe.name}: no negative declares needs=${probe.disables}, so the probe proves nothing.`);
            continue;
        }
        scoreVueRun(`probe ${probe.name}`, run, inventory, (negative) =>
            negative.needs.includes(probe.disables) ? 'silent' : 'errors',
        );
        measureIfClean(
            before,
            `probe ${probe.name} (removes ${probe.disables}): ${silenced.length} negative(s) go SILENTLY green ` +
                `(${silenced.map((negative) => negative.name.replace(/^negative-|\.vue$/g, '')).join(', ')}), ` +
                `${inventory.negatives.length - silenced.length} still error — ${probe.why}`,
        );
    }

    // (c) THE INCLUDE. A `.ts`-only include checks ZERO SFCs and exits 0. Kept executable so
    // the reason the committed config globs `*.vue` cannot be "simplified" away.
    const tsOnly = writeVueProbeConfig('ts-only-include', base, {}, [join(VUE_DIR, '*.ts'), VUE_AUGMENTATION]);
    const trap = compile(VUE_TSC, tsOnly, ['--listFiles']);
    if (trap !== null) {
        const sfcsChecked = [...trap.program].filter((file) => file.endsWith('.vue')).length;
        if (trap.code !== 0 || sfcsChecked !== 0) {
            fail(
                `probe ts-only-include: expected exit 0 with 0 SFCs (the trap), got exit ${trap.code} with ` +
                    `${sfcsChecked} SFC(s). The trap this gate guards against no longer behaves as measured — ` +
                    're-measure before trusting the include.',
            );
        } else {
            measured.push(
                'probe ts-only-include: a .ts-only include compiles 0 SFCs at exit 0 — which is why the committed include globs *.vue',
            );
        }
    }
}

// ── main ────────────────────────────────────────────────────────────────

/**
 * What to show a human when a run deviates: the DIAGNOSTICS, never the `--listFiles`
 * inventory that shares the same stream — a hundred lib.d.ts paths under a failure message
 * is how a real diagnostic gets scrolled past.
 */
function reportOutput(run) {
    return indent(
        run.diagnostics.length > 0 ? run.diagnostics.map((diagnostic) => diagnostic.text).join('\n') : run.output,
    );
}

function indent(text) {
    return text
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => `    ${line}`)
        .join('\n');
}

const started = Date.now();
prepareWorkDir();
try {
    for (const half of JSX_HALVES) {
        if (ONLY === null || ONLY === half.name) checkJsxHalf(half);
    }
    if (ONLY === null || ONLY === 'vue') checkVueHalf();
} finally {
    rmSync(WORK, { recursive: true, force: true });
}
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

for (const line of measured) console.log(`check-type-surfaces: ${line}`);
console.log(`check-type-surfaces: ${measured.length} measurement(s) in ${elapsed}s`);

if (harnessFailures.length > 0) {
    console.error(`\ncheck-type-surfaces: HARNESS FAILURE — the gate could not run, which is not the same as green.`);
    for (const line of harnessFailures) console.error(`  ${line}`);
}
if (failures.length > 0) {
    console.error(`\ncheck-type-surfaces: ${failures.length} problem(s):`);
    for (const line of failures) console.error(`  ${line}`);
}
if (harnessFailures.length > 0 || failures.length > 0) process.exit(1);
if (measured.length === 0) {
    console.error(
        'check-type-surfaces: measured NOTHING and found no problem — that combination is a defect in this script.',
    );
    process.exit(1);
}
