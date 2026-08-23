// E2E: `gjsify build --library` compiles Blueprint.
//
// WHY THIS EXISTS. The `.blp` transform was installed by the `--app gjs|node|browser` build
// factories and by nothing else, which made Blueprint an application-only feature by accident. A
// `.blp` imported from a package built with `--library` reached rolldown's JavaScript parser, and
// a Blueprint file's first line — `using Gtk 4.0;` — is VALID JavaScript: a `using` resource
// declaration with no initializer. The build died on "Using declarations must have an initializer."
// with nothing in the message naming Blueprint.
//
// The cost was not that error. It was what the error pushed people to do instead: a widget shared
// between applications had to assemble itself in TypeScript, and a caption assigned from
// TypeScript carries no `translatable` attribute, so xgettext never sees it. Such a string is
// untranslatABLE while looking merely untranslated, which is why it never gets filed as a bug.
//
// The fixture is a LIBRARY, not an app, because that is the only shape where the plugin was
// missing — an app-target build has always worked and would prove nothing here.
//
// Asserts:
//   1. the emitted module carries the COMPILED GTK Builder XML, with `translatable="yes"`
//      surviving into it — the point of using Blueprint at all;
//   2. a malformed `.blp` fails LOUDLY with a blueprint-compiler diagnostic, not with a
//      JavaScript parse error. That is the discriminator: a JS-parser message would mean the
//      transform never ran and assertion 1 passed for some other reason.
//
// SKIP conditions, so a host without the toolchain reports nothing rather than a false failure:
// no `blueprint-compiler` on PATH, or no built CLI to run.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The zero-dependency subpath, and the resolver rather than a PATH probe: on win32 MSYS2 does not
// put its bin dirs on PATH, so `blueprint-compiler --version` answers "missing" on a host where
// every build works. The resolver is what the plugin actually spawns, so it is the only answer
// that predicts the build — the same reasoning `tests/e2e/create-app` records.
import { resolveBlueprintCompiler } from '@gjsify/vite-plugin-blueprint/resolve';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const CLI = join(REPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');

const SKIP =
    (!existsSync(CLI) && 'no built CLI at packages/infra/cli/lib/index.js') ||
    (!resolveBlueprintCompiler() && 'no blueprint-compiler the build could find');

const GOOD_BLP = `using Gtk 4.0;

template $E2eBlueprintWidget: Gtk.Box {
  Gtk.Label {
    label: _("Marked caption");
  }

  Gtk.Label {
    label: "Unmarked caption";
  }
}
`;

// `template` without a type is a blueprint-compiler error, and deliberately NOT a JavaScript one:
// the whole point is to see WHOSE parser rejected the file.
const BAD_BLP = `using Gtk 4.0;

template {
`;

function project(blp) {
    const root = mkdtempSync(join(tmpdir(), 'gjsify-e2e-library-blueprint-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(
        join(root, 'package.json'),
        `${JSON.stringify({ name: 'e2e-library-blueprint', version: '0.0.0', type: 'module', private: true }, null, 4)}\n`,
    );
    // No `@girs/*` import on purpose: the fixture must exercise the transform, not module
    // resolution, and an unresolvable external would fail the build for an unrelated reason.
    writeFileSync(
        join(root, 'src', 'widget.ts'),
        "import Template from './widget.blp';\n\nexport const template = Template;\n",
    );
    writeFileSync(join(root, 'src', 'widget.blp'), blp);
    return root;
}

function build(root) {
    return spawnSync(process.execPath, [CLI, 'build', 'src/**/*.ts', '--library', '--outdir', 'lib'], {
        cwd: root,
        encoding: 'utf-8',
    });
}

/** Every emitted file's text, concatenated — the .blp lands in its own module under preserveModules. */
function emitted(root) {
    // `lib/`, not `lib/esm/`: the nested layout in this repo's packages comes from their own
    // `outdir`, not from the CLI. Reading the wrong directory here would return '' and fail the
    // assertion for a reason that has nothing to do with Blueprint.
    const dir = join(root, 'lib');
    if (!existsSync(dir)) return '';
    return readdirSync(dir, { recursive: true })
        .filter((name) => String(name).endsWith('.js'))
        .map((name) => readFileSync(join(dir, String(name)), 'utf-8'))
        .join('\n');
}

describe('gjsify build --library compiles Blueprint', { skip: SKIP, timeout: 5 * 60 * 1000 }, () => {
    let good;
    let bad;

    before(() => {
        good = project(GOOD_BLP);
        bad = project(BAD_BLP);
    });

    after(() => {
        for (const root of [good, bad]) if (root) rmSync(root, { recursive: true, force: true });
    });

    it('emits the compiled Builder XML, translatable attribute included', () => {
        const r = build(good);
        assert.equal(r.status, 0, `build failed:\n${r.stdout}\n${r.stderr}`);
        const out = emitted(good);
        assert.match(out, /<template class="E2eBlueprintWidget" parent="GtkBox">/);
        // The reason for the whole feature: `_()` in Blueprint becomes an attribute xgettext can see.
        assert.match(out, /translatable="yes"/);
        assert.match(out, /Marked caption/);
        // And the unmarked sibling is present as text but carries no attribute — otherwise
        // `translatable="yes"` above would prove nothing about the marking.
        assert.match(out, /Unmarked caption/);
        assert.equal((out.match(/translatable="yes"/g) ?? []).length, 1);
    });

    it('fails through blueprint-compiler, not through the JavaScript parser', () => {
        const r = build(bad);
        assert.notEqual(r.status, 0, 'a malformed .blp must fail the build');
        const log = `${r.stdout}\n${r.stderr}`;
        // A JS-parser message here would mean the transform never ran — the exact defect this
        // suite exists for, passing itself off as a normal build error.
        assert.doesNotMatch(log, /Using declarations must have an initializer/);
        assert.match(log, /blueprint|\.blp/i);
    });
});
