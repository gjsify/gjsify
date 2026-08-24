// E2E: a `--app gjs` build must not hand back an artifact the GJS loader refuses.
//
// THE MEASUREMENT this suite pins, taken before any of it existed. A two-line `.tsx`
// with no JSX configuration, built `--app gjs`:
//
//   1. oxc defaults to the automatic runtime with `importSource: 'react'`, so the bundle
//      carries `import { jsx } from "react/jsx-runtime"`.
//   2. rolldown reports the miss as `[UNRESOLVED_IMPORT] Could not resolve
//      'react/jsx-runtime'` — a WARNING — re-emits the specifier, and `gjsify build`
//      exits 0.
//   3. `gjs -m dist/app.gjs.mjs` → `ImportError: Module not found: react/jsx-runtime`,
//      exit 1. Nothing between the build and the runtime had looked.
//
// The `preserve` shape is the same story with a different symptom: raw JSX survives into
// the `.gjs.mjs`, exit 0, and GJS fails with `SyntaxError: expected expression, got '<'`.
// `gjs-bundle-guard.ts` existed the whole time and inspected bare `node:` imports only,
// so it saw neither.
//
// WHAT MUST NOT TRIP is asserted just as hard, because a blanket "fail on any external"
// would break every real build: `gi://` imports, a declared `bundler.external`, and a
// JSX runtime that DOES resolve all have to keep building — and the `--app node` case
// must stay allowed, where a react default is a legitimate answer.
//
// The fixture lives in `mkdtemp`, OUTSIDE the checkout, so nothing resolves by accident
// from the monorepo's own `node_modules` — react 18.3.1 sits there as a transitive dep of
// the website toolchain, and a fixture inside the tree measured a bundle that WORKED.
// Same reason, same shape as `tests/e2e/unresolved-workspace-import/`, and no workspace
// tarballs are packed: the CLI's own Node entry is driven straight out of the checkout.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MONOREPO_ROOT } from '../helpers.mjs';

const CLI = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');

/** A JSX runtime that resolves — the positive cases need one, and react is not here. */
const LOCAL_RUNTIME = `export const jsx = (tag, props) => ({ tag, props, marker: 'local-jsx-runtime' });
export const jsxs = jsx;
export const Fragment = 'fragment';
`;

let projectDir;

/** Rewrite `package.json#gjsify` for the next build. */
function setGjsifyConfig(gjsify) {
    writeFileSync(
        join(projectDir, 'package.json'),
        JSON.stringify({ name: 'jsx-gate-fixture', version: '0.0.0', type: 'module', private: true, gjsify }, null, 2),
    );
}

/** Write (or remove, with `null`) the fixture's tsconfig. */
function setTsconfig(compilerOptions) {
    const path = join(projectDir, 'tsconfig.json');
    if (compilerOptions === null) {
        rmSync(path, { force: true });
        return;
    }
    writeFileSync(path, JSON.stringify({ compilerOptions }, null, 2));
}

/** Run `gjsify build` in the fixture; never throws. */
function build(entry, app, outfile, extraArgs = []) {
    const out = join('dist', outfile);
    rmSync(join(projectDir, out), { force: true });
    const res = spawnSync('node', [CLI, 'build', `src/${entry}`, '--app', app, '--outfile', out, ...extraArgs], {
        cwd: projectDir,
        encoding: 'utf8',
        timeout: 5 * 60 * 1000,
        env: { ...process.env, GJSIFY_BUILD_CACHE: '0' },
    });
    return {
        status: res.status,
        output: `${res.stdout ?? ''}${res.stderr ?? ''}`,
        bundle: join(projectDir, out),
    };
}

describe('JSX configuration gate E2E', { timeout: 10 * 60 * 1000 }, () => {
    before(() => {
        assert.ok(existsSync(CLI), `CLI entry not built: ${CLI} (run \`gjsify run build:infra\`)`);
        projectDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-jsx-config-gate-'));
        mkdirSync(join(projectDir, 'src'), { recursive: true });
        mkdirSync(join(projectDir, 'node_modules', 'local-jsx'), { recursive: true });
        writeFileSync(
            join(projectDir, 'node_modules', 'local-jsx', 'package.json'),
            JSON.stringify({ name: 'local-jsx', version: '1.0.0', exports: { './jsx-runtime': './jsx-runtime.js' } }),
        );
        writeFileSync(join(projectDir, 'node_modules', 'local-jsx', 'jsx-runtime.js'), LOCAL_RUNTIME);
        writeFileSync(join(projectDir, 'src', 'app.tsx'), `const el = <box title="hi" />;\nconsole.log(el);\n`);
        writeFileSync(join(projectDir, 'src', 'pure.ts'), `console.log('no jsx here');\n`);
        writeFileSync(
            join(projectDir, 'src', 'missing-dep.ts'),
            `import value from 'no-such-package-anywhere';\nconsole.log(value);\n`,
        );
        setGjsifyConfig({});
        setTsconfig(null);
    });

    after(() => {
        if (projectDir && !process.env.GJSIFY_E2E_KEEP_TEMP) rmSync(projectDir, { recursive: true, force: true });
    });

    it('refuses a .tsx entry with no JSX configuration, BEFORE bundling', () => {
        setGjsifyConfig({});
        setTsconfig(null);
        const { status, output, bundle } = build('app.tsx', 'gjs', 'app.gjs.mjs');
        assert.notEqual(status, 0, `build should have failed, but exited 0.\n${output}`);
        assert.match(output, /src[/\\]app\.tsx/, output);
        assert.match(output, /nothing configures a JSX transform/, output);
        // Each of the three fixes is named, because "configure JSX" is not actionable.
        assert.match(output, /react\/jsx-runtime/, output);
        assert.match(output, /jsxImportSource/, output);
        assert.match(output, /"jsx": "preserve"/, output);
        // Failing EARLY is the point: nothing was bundled.
        assert.ok(!existsSync(bundle), `a bundle was still written to ${bundle}`);
    });

    it('refuses an artifact whose configured JSX runtime does not resolve', () => {
        // Gate (b) is satisfied — a policy IS configured — so this is the artifact gate
        // on its own, reached only after a full bundle. It is the general mechanism: the
        // specifier happens to be a JSX runtime, and nothing about the check is.
        setGjsifyConfig({ bundler: { transform: { jsx: { importSource: '@no/such-runtime' } } } });
        setTsconfig(null);
        const { status, output } = build('app.tsx', 'gjs', 'app.gjs.mjs');
        assert.notEqual(status, 0, `build should have failed, but exited 0.\n${output}`);
        assert.match(output, /@no\/such-runtime\/jsx-runtime/, output);
        assert.match(output, /Module not found/, output);
    });

    it('refuses raw JSX that survived a `preserve` build with no compiler', () => {
        // `--globals none` is deliberate: it takes the `--globals auto` analysis parse out
        // of the way, which is the configuration in which this shape reached exit 0.
        setGjsifyConfig({ bundler: { transform: { jsx: 'preserve' } } });
        setTsconfig(null);
        const { status, output } = build('app.tsx', 'gjs', 'app.gjs.mjs', ['--globals', 'none']);
        assert.notEqual(status, 0, `build should have failed, but exited 0.\n${output}`);
        assert.match(output, /still contains raw JSX at \d+:\d+/, output);
        assert.match(output, /babel-preset-solid/, output);
    });

    it('names JSX in the `--globals auto` analysis pass too', () => {
        // The same project on the DEFAULT globals mode died inside the detector with
        // `Unexpected token (3:11)` — non-zero, but naming neither JSX nor a setting.
        setGjsifyConfig({ bundler: { transform: { jsx: 'preserve' } } });
        setTsconfig(null);
        const { status, output } = build('app.tsx', 'gjs', 'app.gjs.mjs');
        assert.notEqual(status, 0, `build should have failed, but exited 0.\n${output}`);
        assert.match(output, /raw JSX/, output);
    });

    it('builds a .tsx whose configured runtime resolves', () => {
        setGjsifyConfig({ bundler: { transform: { jsx: { importSource: 'local-jsx' } } } });
        setTsconfig(null);
        const { status, output, bundle } = build('app.tsx', 'gjs', 'app.gjs.mjs');
        assert.equal(status, 0, output);
        assert.ok(existsSync(bundle), `expected a bundle at ${bundle}\n${output}`);
        const code = readFileSync(bundle, 'utf8');
        // The runtime was INLINED, not left as a bare import for GJS to fail on.
        assert.match(code, /local-jsx-runtime/, 'the resolved runtime is not in the bundle');
        assert.ok(!/from\s*["']local-jsx\/jsx-runtime["']/.test(code), 'the runtime stayed an unresolved import');
        assert.ok(!/<box/.test(code), 'JSX was not transformed');
    });

    it('accepts a JSX policy that lives only in tsconfig.json', () => {
        // The bundler reads tsconfig itself, so a project configured the TypeScript way
        // must not be refused — measured: `"jsx": "react-jsx"` + `"jsxImportSource"` in
        // tsconfig alone produces a working bundle.
        setGjsifyConfig({});
        setTsconfig({ jsx: 'react-jsx', jsxImportSource: 'local-jsx' });
        const { status, output, bundle } = build('app.tsx', 'gjs', 'app.gjs.mjs');
        assert.equal(status, 0, output);
        assert.match(readFileSync(bundle, 'utf8'), /local-jsx-runtime/, output);
    });

    it('leaves `--app node` alone: react is a legitimate default there', () => {
        // Scope, not an oversight. On node/browser a project that has react installed is
        // answered correctly by the default, and refusing would break real builds.
        setGjsifyConfig({});
        setTsconfig(null);
        const { status, output, bundle } = build('app.tsx', 'node', 'app.node.mjs');
        assert.equal(status, 0, output);
        assert.ok(existsSync(bundle), `expected a bundle at ${bundle}\n${output}`);
    });

    it('refuses ANY unresolvable bare import, and allows a declared external', () => {
        // The legitimate-vs-broken line, on a plain `.ts` entry with no JSX anywhere:
        // an undeclared missing package is fatal, the same specifier declared external is
        // a promise the caller made and is honoured.
        setGjsifyConfig({});
        setTsconfig(null);
        const missing = build('missing-dep.ts', 'gjs', 'missing.gjs.mjs');
        assert.notEqual(missing.status, 0, `build should have failed, but exited 0.\n${missing.output}`);
        assert.match(missing.output, /no-such-package-anywhere/, missing.output);
        assert.match(missing.output, /Module not found/, missing.output);

        setGjsifyConfig({ bundler: { external: ['no-such-package-anywhere'] } });
        const declared = build('missing-dep.ts', 'gjs', 'missing.gjs.mjs');
        assert.equal(declared.status, 0, declared.output);
        assert.ok(existsSync(declared.bundle), `expected a bundle at ${declared.bundle}\n${declared.output}`);
    });

    it('a JSX-free gjs build is unaffected', () => {
        setGjsifyConfig({});
        setTsconfig(null);
        const { status, output, bundle } = build('pure.ts', 'gjs', 'pure.gjs.mjs');
        assert.equal(status, 0, output);
        assert.ok(existsSync(bundle), `expected a bundle at ${bundle}\n${output}`);
    });
});
