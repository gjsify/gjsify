// E2E for the internal oxlint JS plugin `@gjsify/oxlint-plugin-gjsify`
// (`gjsify/register-class-order` rule).
//
// Runs the real installed `oxlint` (via its Node launcher) against a fixture
// containing a `static { GObject.registerClass(...) }` block followed by
// `static` GObject metadata fields. Asserts:
//   1. the rule reports one diagnostic per offending field, and
//   2. `--fix` hoists every offending field above the static block (the static
//      block is no longer the first class element; metadata fields precede it).
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
