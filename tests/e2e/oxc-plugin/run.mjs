// E2E for the internal oxlint JS plugin `@gjsify/oxlint-plugin-gjsify`
// (`gjsify/register-class-order` + `gjsify/deferred-process-exit` rules).
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
// The plugin is loaded from its source path in this repo (oxlint `import()`s
// the `.ts` file directly via Node type-stripping), so no tarball/install
// dance is needed — this exercises the exact `jsPlugins` wiring the repo's
// root `.oxlintrc.json` uses. (GNOME/gjs#704, gjsify/ts-for-gir#410.)

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
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
