// E2E for the internal oxlint JS plugin `@gjsify/oxlint-plugin-gjsify`
// (`gjsify/register-class-order`, `gjsify/deferred-process-exit`,
// `gjsify/todo-needs-anchor` and `gjsify/no-css-side-effect-import` rules).
//
// Runs the real installed `oxlint` (via its Node launcher) against fixtures:
//
// `register-class-order`: a `static { GObject.registerClass(...) }` block
// followed by `static` GObject metadata fields. Asserts:
//   1. the rule reports one diagnostic per offending field, and
//   2. `--fix` hoists every offending field above the static block (the static
//      block is no longer the first class element; metadata fields precede it).
//
// `deferred-process-exit`: a bare `process.exit()` does not halt under GJS
// (no atexit; the GLib loop may still be armed) — the call returns and the
// statements after it still run, losing the exit code. The rule flags a
// statement CONTAINING a bare exit when another statement follows it in the
// same statement list; tail-position exits and `return process.exit(…)` are
// deliberately clean. The report fixture is the exact `gjsify storybook`
// no-stories shape that shipped (see tests/e2e/storybook-no-stories).
//
// `todo-needs-anchor`: a deferral marker that names nothing has no owner and
// no retirement. At v0.29.0 the tree carried 42 such markers in source and 5
// of them were anchored — among the other 37, a test documented as broken with
// nothing anywhere to make anyone notice it stayed broken. The rule accepts
// `#123`, a forge issue URL, the status ledger, or `fixed upstream in …`, and
// it matches only the OPENING word of a comment line, so prose ABOUT a
// deferral is deliberately not a finding.
//
// `no-css-side-effect-import`: a bare `import '<something that is CSS>';`
// registers nothing under a gjsify build — `cssAsStringPlugin` emits
// `export default "<css>"`, a module with no side effect, so the import is
// tree-shaken and the build exits 0. Measured on 0.41.0: a probe entry whose
// only statement was `import '@gjsify/adwaita-fonts';` — the line
// `@gjsify/adwaita-web` carried for its whole life — produced a ZERO-BYTE
// bundle with zero `@font-face`. The half that can go silent is the
// EXTENSIONLESS one: the rule reads the target package's `exports` off disk to
// learn that `@gjsify/adwaita-fonts` means `index.css`, and if that walk ever
// returned nothing the rule would keep passing over the exact shape it exists
// for. So the fixture project below carries its own `node_modules` package and
// the counted assertions cover both spellings.
//
// The plugin is loaded from its source path in this repo (oxlint `import()`s
// the `.ts` file directly via Node type-stripping), so no tarball/install
// dance is needed — this exercises the exact `jsPlugins` wiring the repo's
// root `.oxlintrc.json` uses. (GNOME/gjs#704, gjsify/ts-for-gir#410.)

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const OXLINT_BIN = join(MONOREPO_ROOT, 'node_modules', 'oxlint', 'bin', 'oxlint');
const PLUGIN_ENTRY = join(MONOREPO_ROOT, 'packages', 'infra', 'oxlint-plugin-gjsify', 'src', 'index.ts');

const FIXTURE = `import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

export class MyWidget extends Gtk.Widget {
    static {
        GObject.registerClass(this);
    }

    static GTypeName = 'MyWidget';

    static Properties = {};
}
`;

describe('oxlint plugin gjsify/register-class-order E2E', { timeout: 5 * 60 * 1000 }, () => {
    let tmpDir;
    let configPath;

    before(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-oxc-plugin-'));
        configPath = join(tmpDir, '.oxlintrc.json');
        writeFileSync(
            configPath,
            JSON.stringify(
                {
                    jsPlugins: [PLUGIN_ENTRY],
                    rules: { 'gjsify/register-class-order': 'error' },
                },
                null,
                2,
            ) + '\n',
        );
    });

    after(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    function runOxlint(file, extraArgs = []) {
        return spawnSync(process.execPath, [OXLINT_BIN, '--config', configPath, ...extraArgs, file], {
            encoding: 'utf-8',
            timeout: 60 * 1000,
        });
    }

    it('reports one diagnostic per static GObject metadata field declared after the registerClass block', () => {
        const file = join(tmpDir, 'report.ts');
        writeFileSync(file, FIXTURE);

        const res = runOxlint(file);
        const out = (res.stdout ?? '') + (res.stderr ?? '');
        const matches = out.match(/gjsify\(register-class-order\)/g) ?? [];
        assert.equal(matches.length, 2, `expected 2 diagnostics, got ${matches.length}:\n${out}`);
        assert.match(out, /static GTypeName/);
        assert.match(out, /static Properties/);
    });

    it('--fix hoists all offending fields above the static block in a single pass', () => {
        const file = join(tmpDir, 'fix.ts');
        writeFileSync(file, FIXTURE);

        runOxlint(file, ['--fix']);
        const fixed = readFileSync(file, 'utf-8');

        // Both metadata fields must now appear BEFORE the static block.
        const gtypeIdx = fixed.indexOf('static GTypeName');
        const propsIdx = fixed.indexOf('static Properties');
        const blockIdx = fixed.indexOf('static {');
        assert.ok(gtypeIdx !== -1 && propsIdx !== -1 && blockIdx !== -1, `unexpected fixed output:\n${fixed}`);
        assert.ok(gtypeIdx < blockIdx, 'static GTypeName should be hoisted above the static block');
        assert.ok(propsIdx < blockIdx, 'static Properties should be hoisted above the static block');

        // And the rule should no longer report on the fixed source.
        const res = runOxlint(file);
        const out = (res.stdout ?? '') + (res.stderr ?? '');
        assert.doesNotMatch(out, /register-class-order/, `rule still reports after --fix:\n${out}`);
    });
});

// The exact shape that shipped in `gjsify storybook` (commands/storybook.ts):
// the exit is the LAST statement of ITS block, so a naive "must be last
// statement" rule would miss it — execution resumed AFTER the `if`.
const EXIT_FALLTHROUGH_FIXTURE = `export function main(count: number): void {
    if (count === 0) {
        console.error('No *.story.ts files found under src');
        process.exit(1);
    }
    console.log(\`Found \${count} story file(s)\`);
}
`;

const EXIT_THEN_RETURN_FIXTURE = `export function main(ok: boolean): void {
    if (!ok) {
        process.exit(1);
        return;
    }
    console.log('ok');
}
`;

// All of these are deliberately CLEAN: tail-position exits (nothing follows,
// anywhere up the statement list), the `return process.exit(…)` repair, and an
// exit inside a nested function (the callback's exit belongs to the callback).
const CLEAN_FIXTURE = `export function tail(code: number): void {
    console.error('fatal');
    process.exit(code);
}

export function repaired(ok: boolean): void {
    if (!ok) {
        console.error('fatal');
        return process.exit(1);
    }
    console.log('ok');
}

export function callbackOwnsItsExit(run: (cb: () => void) => void): void {
    run(() => {
        process.exit(0);
    });
    console.log('scheduled');
}

// Regression: a hoisted function DECLARATION is a module-body statement with
// followers, but its body runs later — the tail exit inside it must not be
// flagged just because another top-level declaration follows the function.
function forceExit(code: number): void {
    console.error('fatal');
    process.exit(code);
}

export const AFTER_THE_DECLARATION = forceExit;
`;

// A bare exit inside a callback IS flagged when the callback's own statement
// list continues past it.
const CALLBACK_FALLTHROUGH_FIXTURE = `export function inCallback(run: (cb: () => void) => void): void {
    run(() => {
        process.exit(1);
        console.log('still runs under GJS');
    });
}
`;

// The sanctioned sync-helper halt: exit-then-throw with a reasoned disable
// (see commands/affected.ts). The directive must actually suppress — the sweep
// relies on it — and reportUnusedDisableDirectives must not flag it as unused.
const DISABLED_GUARD_FIXTURE = `export function refuse(name: string): string {
    // oxlint-disable-next-line gjsify/deferred-process-exit -- the throw below IS the halt for the GJS path
    process.exit(2);
    throw new Error(\`unsafe name \${name}\`);
}
`;

describe('oxlint plugin gjsify/deferred-process-exit E2E', { timeout: 5 * 60 * 1000 }, () => {
    let tmpDir;
    let configPath;

    before(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-oxc-plugin-exit-'));
        configPath = join(tmpDir, '.oxlintrc.json');
        writeFileSync(
            configPath,
            JSON.stringify(
                {
                    jsPlugins: [PLUGIN_ENTRY],
                    options: { reportUnusedDisableDirectives: 'error' },
                    rules: { 'gjsify/deferred-process-exit': 'error' },
                },
                null,
                2,
            ) + '\n',
        );
    });

    after(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    function runOxlint(file) {
        return spawnSync(process.execPath, [OXLINT_BIN, '--config', configPath, file], {
            encoding: 'utf-8',
            timeout: 60 * 1000,
        });
    }

    it('flags the storybook shape: exit last in its block, statement after the block', () => {
        const file = join(tmpDir, 'fallthrough.ts');
        writeFileSync(file, EXIT_FALLTHROUGH_FIXTURE);

        const res = runOxlint(file);
        const out = (res.stdout ?? '') + (res.stderr ?? '');
        const matches = out.match(/gjsify\(deferred-process-exit\)/g) ?? [];
        assert.equal(matches.length, 1, `expected 1 diagnostic, got ${matches.length}:\n${out}`);
        assert.notEqual(res.status, 0, 'a finding must fail the run');
    });

    it('flags `process.exit(1); return;`', () => {
        const file = join(tmpDir, 'exit-then-return.ts');
        writeFileSync(file, EXIT_THEN_RETURN_FIXTURE);

        const res = runOxlint(file);
        const out = (res.stdout ?? '') + (res.stderr ?? '');
        assert.match(out, /gjsify\(deferred-process-exit\)/, `expected a diagnostic:\n${out}`);
    });

    it('flags a bare exit inside a callback whose own statement list continues', () => {
        const file = join(tmpDir, 'callback-fallthrough.ts');
        writeFileSync(file, CALLBACK_FALLTHROUGH_FIXTURE);

        const res = runOxlint(file);
        const out = (res.stdout ?? '') + (res.stderr ?? '');
        assert.match(out, /gjsify\(deferred-process-exit\)/, `expected a diagnostic:\n${out}`);
    });

    it('stays silent on tail exits, `return process.exit(…)`, and callback-owned exits', () => {
        const file = join(tmpDir, 'clean.ts');
        writeFileSync(file, CLEAN_FIXTURE);

        const res = runOxlint(file);
        const out = (res.stdout ?? '') + (res.stderr ?? '');
        assert.doesNotMatch(out, /deferred-process-exit/, `unexpected diagnostic:\n${out}`);
        assert.equal(res.status, 0, `clean fixture must pass:\n${out}`);
    });

    it('honours a reasoned disable on the exit-then-throw sync-helper guard', () => {
        const file = join(tmpDir, 'disabled-guard.ts');
        writeFileSync(file, DISABLED_GUARD_FIXTURE);

        const res = runOxlint(file);
        const out = (res.stdout ?? '') + (res.stderr ?? '');
        assert.doesNotMatch(out, /deferred-process-exit/, `directive did not suppress:\n${out}`);
        // With reportUnusedDisableDirectives=error a directive that suppresses
        // nothing would fail the run — this asserts it is genuinely load-bearing.
        assert.equal(res.status, 0, `disabled guard fixture must pass:\n${out}`);
    });
});

// The ledger anchor below is ASSEMBLED rather than written out, and that is not
// style. The sibling half of this rule — the dangling-anchor check in
// `scripts/generate-status.mjs` — walks `tests/` for the raw marker-plus-colon
// spelling and fails when the name after it matches no `### ` heading in the
// status ledger. A fixture anchor is exactly such a name. Spelling it literally
// here would red-line `audit-runtimes --check` on every PR, and the failure
// would name THIS RUNNER rather than the rule, which reads like a bug in the
// test. `generate-status.mjs` exempts only itself, for the same reason a gate
// that explains what it rejects has to be able to quote it.
const LEDGER = 'open-todos';

// Four bare markers, one per accepted spelling, the third inside a JSDoc block
// so the `openingWord()` strip of a leading `*` is covered too.
const UNANCHORED_FIXTURE = `export function first() {
    // TODO: wire this up before the next release
    return 1;
}

// FIXME rename this before anyone depends on it
export const second = 2;

/**
 * HACK works around the loader ordering
 */
export const third = 3;

// XXX revisit once the floor moves
export const fourth = 4;
`;

// One fixture per accepted anchor form. The ledger form is the interesting one:
// the rule only requires the ledger token to appear ANYWHERE in the comment,
// which is why the sibling check in `generate-status.mjs` exists to hold the
// other half — that the name actually resolves to an entry.
const ANCHORED_FIXTURE = `// TODO(#1013): tracked as an issue
export const first = 1;

// FIXME https://github.com/gjsify/gjsify/issues/996 — a forge URL counts
export const second = 2;

// HACK(${LEDGER}: a parked behaviour): the ledger owns the reason
export const third = 3;

// XXX fixed upstream in gjs 1.90 — drop this when the floor moves
export const fourth = 4;
`;

// THE FALSE-POSITIVE GUARD, and it carries no anchor at all on purpose: with one
// present, a pass would be attributable to the anchor rather than to
// `openingWord()`, and the guard would prove itself vacuously.
const PROSE_FIXTURE = `// This function used to carry a TODO about caching.
export const first = 1;

// The TODOS list lives elsewhere, and todoCount is a variable.
export const second = 2;

// XXXL is a size, not a marker.
export const third = 3;

/**
 * See the notes — a FIXME was removed here once.
 */
export const fourth = 4;
`;

// The counterpart of the JSDoc case: a marker and an anchor in two SEPARATE
// line comments. The rule tests the anchor against the whole comment VALUE, so
// "same comment" is the contract, and this locks it from the other side.
const SPLIT_COMMENT_FIXTURE = `// TODO: the anchor is in the next comment, not this one
// #1013 — which is one comment too late
export const first = 1;
`;

const DISABLED_MARKER_FIXTURE = `// oxlint-disable-next-line gjsify/todo-needs-anchor -- fixture: proves the directive suppresses a real finding
// TODO: deliberately unanchored
export const first = 1;
`;

describe('oxlint plugin gjsify/todo-needs-anchor E2E', { timeout: 5 * 60 * 1000 }, () => {
    let tmpDir;
    let configPath;

    before(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-oxc-plugin-todo-'));
        configPath = join(tmpDir, '.oxlintrc.json');
        writeFileSync(
            configPath,
            JSON.stringify(
                {
                    jsPlugins: [PLUGIN_ENTRY],
                    options: { reportUnusedDisableDirectives: 'error' },
                    rules: { 'gjsify/todo-needs-anchor': 'error' },
                },
                null,
                2,
            ) + '\n',
        );
    });

    after(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    function runOxlint(file) {
        return spawnSync(process.execPath, [OXLINT_BIN, '--config', configPath, file], {
            encoding: 'utf-8',
            timeout: 60 * 1000,
        });
    }

    // The COUNT is what makes this suite able to fail, and it is not a nicety.
    // The rule returns `{}` — silently checking nothing — when the oxlint host
    // does not expose `getAllComments`. A suite of only "stays silent"
    // assertions would sail straight through that degradation, green forever
    // over a dead rule. These counted assertions are the only thing that
    // notices. Do not soften them to a bare `assert.match`.
    it('reports one diagnostic per bare marker, across all four spellings', () => {
        const file = join(tmpDir, 'unanchored.ts');
        writeFileSync(file, UNANCHORED_FIXTURE);

        const res = runOxlint(file);
        const out = (res.stdout ?? '') + (res.stderr ?? '');
        const matches = out.match(/gjsify\(todo-needs-anchor\)/g) ?? [];
        assert.equal(matches.length, 4, `expected 4 diagnostics, got ${matches.length}:\n${out}`);
        assert.notEqual(res.status, 0, 'a finding must fail the run');
    });

    it('stays silent on every accepted anchor form', () => {
        const file = join(tmpDir, 'anchored.ts');
        writeFileSync(file, ANCHORED_FIXTURE);

        const res = runOxlint(file);
        const out = (res.stdout ?? '') + (res.stderr ?? '');
        assert.doesNotMatch(out, /todo-needs-anchor/, `unexpected diagnostic:\n${out}`);
        assert.equal(res.status, 0, `anchored fixture must pass:\n${out}`);
    });

    it('stays silent on prose that merely mentions a marker word', () => {
        const file = join(tmpDir, 'prose.ts');
        writeFileSync(file, PROSE_FIXTURE);

        const res = runOxlint(file);
        const out = (res.stdout ?? '') + (res.stderr ?? '');
        assert.doesNotMatch(out, /todo-needs-anchor/, `prose must not be a finding:\n${out}`);
        assert.equal(res.status, 0, `prose fixture must pass:\n${out}`);
    });

    it('does not accept an anchor sitting in the NEXT comment', () => {
        const file = join(tmpDir, 'split.ts');
        writeFileSync(file, SPLIT_COMMENT_FIXTURE);

        const res = runOxlint(file);
        const out = (res.stdout ?? '') + (res.stderr ?? '');
        const matches = out.match(/gjsify\(todo-needs-anchor\)/g) ?? [];
        assert.equal(matches.length, 1, `expected 1 diagnostic, got ${matches.length}:\n${out}`);
    });

    it('honours a reasoned disable directive', () => {
        const file = join(tmpDir, 'disabled.ts');
        writeFileSync(file, DISABLED_MARKER_FIXTURE);

        const res = runOxlint(file);
        const out = (res.stdout ?? '') + (res.stderr ?? '');
        assert.doesNotMatch(out, /todo-needs-anchor/, `directive did not suppress:\n${out}`);
        // With reportUnusedDisableDirectives=error a directive suppressing
        // nothing fails the run, so this also proves the finding was real.
        assert.equal(res.status, 0, `disabled fixture must pass:\n${out}`);
    });
});

// A tiny package whose `.` export IS a stylesheet — the `@gjsify/adwaita-fonts`
// shape, and the reason this rule resolves rather than matching on `.css`.
const CSS_PACKAGE_MANIFEST = JSON.stringify(
    {
        name: 'fixture-css-pkg',
        version: '1.0.0',
        exports: { '.': { types: './index.d.ts', default: './index.css' } },
    },
    null,
    2,
);

const CSS_IMPORT_FIXTURE = `import 'fixture-css-pkg';
import './local.css';
import './side-effect.js';
import css from './local.css';

export const length = css.length;
`;

const CSS_VALUE_ONLY_FIXTURE = `import css from 'fixture-css-pkg';
import './side-effect.js';

export const length = css.length;
`;

const CSS_DISABLED_FIXTURE = `// oxlint-disable-next-line gjsify/no-css-side-effect-import -- fixture: proves the directive suppresses a real finding
import 'fixture-css-pkg';

export const first = 1;
`;

describe('oxlint plugin gjsify/no-css-side-effect-import E2E', { timeout: 5 * 60 * 1000 }, () => {
    let tmpDir;
    let configPath;

    before(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-oxc-plugin-css-'));
        const pkgDir = join(tmpDir, 'node_modules', 'fixture-css-pkg');
        mkdirSync(pkgDir, { recursive: true });
        writeFileSync(join(pkgDir, 'package.json'), `${CSS_PACKAGE_MANIFEST}\n`);
        writeFileSync(join(pkgDir, 'index.css'), 'body { color: red; }\n');
        writeFileSync(join(tmpDir, 'local.css'), 'body { color: blue; }\n');
        writeFileSync(join(tmpDir, 'side-effect.js'), 'globalThis.__fixture = 1;\n');
        configPath = join(tmpDir, '.oxlintrc.json');
        writeFileSync(
            configPath,
            JSON.stringify(
                {
                    jsPlugins: [PLUGIN_ENTRY],
                    options: { reportUnusedDisableDirectives: 'error' },
                    rules: { 'gjsify/no-css-side-effect-import': 'error' },
                },
                null,
                2,
            ) + '\n',
        );
    });

    after(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    function runOxlint(file) {
        return spawnSync(process.execPath, [OXLINT_BIN, '--config', configPath, file], {
            encoding: 'utf-8',
            timeout: 60 * 1000,
        });
    }

    // TWO, counted: one for the resolved bare package and one for the plain
    // `.css` extension. A bare `assert.match` would pass on either alone, and
    // the resolving half is the one that can degrade to silence.
    it('reports the extensionless CSS package AND the .css path, and nothing else', () => {
        const file = join(tmpDir, 'imports.ts');
        writeFileSync(file, CSS_IMPORT_FIXTURE);

        const res = runOxlint(file);
        const out = (res.stdout ?? '') + (res.stderr ?? '');
        const matches = out.match(/gjsify\(no-css-side-effect-import\)/g) ?? [];
        assert.equal(matches.length, 2, `expected 2 diagnostics, got ${matches.length}:\n${out}`);
        assert.match(out, /fixture-css-pkg/, `the bare package must be named:\n${out}`);
        assert.notEqual(res.status, 0, 'a finding must fail the run');
    });

    it('stays silent on a VALUE import and on a JS side-effect import', () => {
        const file = join(tmpDir, 'value.ts');
        writeFileSync(file, CSS_VALUE_ONLY_FIXTURE);

        const res = runOxlint(file);
        const out = (res.stdout ?? '') + (res.stderr ?? '');
        assert.doesNotMatch(out, /no-css-side-effect-import/, `unexpected diagnostic:\n${out}`);
        assert.equal(res.status, 0, `value fixture must pass:\n${out}`);
    });

    it('honours a reasoned disable directive', () => {
        const file = join(tmpDir, 'disabled.ts');
        writeFileSync(file, CSS_DISABLED_FIXTURE);

        const res = runOxlint(file);
        const out = (res.stdout ?? '') + (res.stderr ?? '');
        assert.doesNotMatch(out, /no-css-side-effect-import/, `directive did not suppress:\n${out}`);
        // With reportUnusedDisableDirectives=error a directive suppressing
        // nothing fails the run, so this also proves the finding was real.
        assert.equal(res.status, 0, `disabled fixture must pass:\n${out}`);
    });
});
