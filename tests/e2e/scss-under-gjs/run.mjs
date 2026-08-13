// E2E: what a `.scss` import does on each host — measured, not assumed.
//
// TWO SASS PATHS EXIST AND ONLY ONE WAS WRITTEN DOWN. `status/open-todos.md`
// records, in detail, that `adwaita-web/scripts/build-scss.mjs` dies under GJS on
// dart-sass's own `require("url")`. What nothing had measured is the OTHER path —
// the one the bundler itself takes for an ordinary `import './x.scss'`:
//
//   node --app node : the SCSS compiles and `color: red` lands in the bundle.
//   gjs  --app gjs  : UNLOADABLE_DEPENDENCY — "Could not load style.scss".
//
// `css-as-string.ts` states the opposite in a comment — "the `dart-sass` JS API is
// pure JS, so it loads under GJS + Node alike" — and it is the plugin's own claim
// about the host it is heading to. Measured against 0.37.0 it fails EARLIER and for
// a DIFFERENT reason than the script path: the plugin reaches sass through
// `import('sass')`, a bare specifier resolved at RUNTIME, which GJS's ESM loader
// cannot resolve ("Module not found: sass"), and the CLI's GJS bundle does not
// carry dart-sass inlined either (grep: zero `dartNodeIsActuallyNode` in
// `dist/cli.gjs.mjs`). So the two paths fail for two reasons and one fix will not
// answer both.
//
// WHY THIS FILE RATHER THAN A FIX — and the first answer here was wrong, so it is
// recorded rather than replaced. It read: "bundling dart-sass in runs straight into
// the documented `require` wall, and clearing that means giving the GJS bundle a
// global `require`". Measured since (#1053): dart-sass compiles under GJS with no
// `require` at all — that wall is behind `if (dartNodeIsActuallyNode)`, which is true
// only because `@gjsify/process` reports `versions.node`. `build-scss.mjs` now runs
// under GJS and emits byte-identical CSS.
//
// What stops the BUNDLER path is size, not capability. There is no runtime resolve
// that can work — `sass.default.js` imports a bare `immutable` — so `cli.gjs.mjs`
// would have to carry dart-sass inlined: 3.6 MB minified onto a 6.6 MB artifact that
// loads on every GJS invocation, for a file type most builds never import. That wants
// a lazy separately-published carrier (the shape `@gjsify/lightningcss-native` has for
// CSS), which is its own PR.
//
// IT IS A TRIPWIRE, NOT AN ACCEPTANCE. The GJS case asserts the CURRENT failure and
// its exact shape, so the day SCSS compiles under GJS this suite goes red and has to
// be inverted — the self-retiring contract `it.failing` gives inside `@gjsify/unit`,
// expressed in `node:test`, which has no equivalent. `{ todo: true }` would NOT do:
// it never fails when it starts passing, so it rots.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { hasCommand } from '../helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const NODE_CLI = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');
const GJS_BUNDLE = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'dist', 'cli.gjs.mjs');

/** Both artifacts are build outputs; off a built tree this suite proves nothing. */
const SKIP = !existsSync(NODE_CLI)
    ? `no built Node CLI at ${NODE_CLI}`
    : !existsSync(GJS_BUNDLE)
      ? `no GJS bundle at ${GJS_BUNDLE}`
      : !hasCommand('gjs')
        ? 'no gjs on PATH'
        : false;

describe('a .scss import, per host', { timeout: 5 * 60 * 1000, skip: SKIP }, () => {
    let dir;

    before(() => {
        dir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-scss-'));
        writeFileSync(
            join(dir, 'package.json'),
            JSON.stringify({ name: 'scss-probe', version: '0.0.0', type: 'module', private: true }, null, 2) + '\n',
        );
        writeFileSync(join(dir, 'style.scss'), '$c: red;\na { color: $c; }\n');
        writeFileSync(join(dir, 'entry.ts'), "import css from './style.scss';\nconsole.log('CSS:', css);\n");
    });

    after(() => {
        if (dir) rmSync(dir, { recursive: true, force: true });
    });

    it('compiles under Node — the half of the claim that holds', () => {
        const r = spawnSync(
            process.execPath,
            [NODE_CLI, 'build', 'entry.ts', '--app', 'node', '--outfile', 'out.node.mjs'],
            {
                cwd: dir,
                encoding: 'utf-8',
                timeout: 4 * 60 * 1000,
            },
        );
        const out = join(dir, 'out.node.mjs');
        assert.ok(existsSync(out), `no bundle written:\n${r.stdout}\n${r.stderr}`);
        // The COMPILED value, not merely a written file: `$c` must have resolved.
        assert.match(readFileSync(out, 'utf-8'), /color: red/);
    });

    it('does NOT compile under GJS — tripwire, invert it when this starts working', () => {
        const r = spawnSync(
            'gjs',
            ['-m', GJS_BUNDLE, 'build', 'entry.ts', '--app', 'gjs', '--outfile', 'out.gjs.mjs'],
            {
                cwd: dir,
                encoding: 'utf-8',
                timeout: 4 * 60 * 1000,
            },
        );
        const combined = `${r.stdout ?? ''}${r.stderr ?? ''}`;
        assert.ok(
            !existsSync(join(dir, 'out.gjs.mjs')),
            'SCSS now compiles under GJS. That is the fix #1053 needs: delete this tripwire, ' +
                'assert the compiled output like the Node case above, and retire the open-todo entry.',
        );
        // The SHAPE of the failure, so a different one is a different finding
        // rather than a silent confirmation of this one.
        assert.match(
            combined,
            /Could not load style\.scss|UNLOADABLE_DEPENDENCY/,
            `expected the sass loader to be the failure; got:\n${combined}`,
        );
    });
});
