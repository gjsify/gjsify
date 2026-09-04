// The demo project both `ship` suites build, and the readers they check artifacts with.
//
// Extracted when `tests/e2e/ship-from-stage` needed the same project. A second copy of the
// scaffold would be a second definition of "a shippable project": the two suites would drift, and
// the drifted one is the one that keeps passing while proving something else.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { hasCommand } from '../helpers.mjs';
import { runCliSync } from '../mock-registry.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
export const CLI_ENTRY = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');

/**
 * The stage manifest's name and schema, IMPORTED from the CLI that writes them.
 *
 * Not restated: both are contracts the CLI owns, and a test carrying its own copy of a contract is
 * a test that only agrees with itself. Same reason `helpers.mjs` reads `LOCKFILE_VERSION` out of
 * `scripts/check-lockfile-current.mjs` rather than hardcoding a `4`.
 */
export const { STAGE_MANIFEST_FILE, STAGE_SCHEMA_VERSION } = await import(
    pathToFileURL(join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'utils', 'ship', 'stage-manifest.js')).href
);

export const APP_ID = 'org.example.ShipDemo';

export const BUNDLE = [
    `import Gtk from 'gi://Gtk?version=4.0';`,
    `import Adw from 'gi://Adw?version=1';`,
    `print(Gtk, Adw);`,
    '',
].join('\n');

/**
 * The shim `--app node` compiles a `gi://` import into, IMPORTED from the plugin
 * that emits it.
 *
 * Not restated, for `STAGE_MANIFEST_FILE`'s reason one level up: this is the
 * exact text a node bundle carries where a GJS bundle carries a `gi://`
 * specifier, and a fixture holding its own copy of it would keep agreeing with
 * itself after the plugin moved.
 */
const { giNodeShimSource } = await import(
    pathToFileURL(
        join(MONOREPO_ROOT, 'packages', 'infra', 'rolldown-plugin-gjsify', 'lib', 'plugins', 'gjs-gi-node.js'),
    ).href
);

/**
 * The `--app node` twin of {@link BUNDLE}.
 *
 * GI reach on purpose: a Node bundle still reaches GI through `@gjsify/node-gi`,
 * so the typelib dependencies must be derived for it exactly as for a GJS one. A
 * plain `console.log` bundle would have proved only that the interpreter line
 * changed.
 *
 * BUT NOT THROUGH `gi://`, which is what this fixture used to say and what made
 * it a fixture no build can produce and no interpreter can run: `--app node`
 * rewrites every `gi://` into the shim above, and node's ESM loader refuses the
 * scheme outright (ERR_UNSUPPORTED_ESM_URL_SCHEME). Written the old way, this
 * file asserted that a `.deb` derives `gir1.2-gtk-4.0` from a bundle whose real
 * counterpart derives nothing — which is exactly the defect that survived
 * (#1545, `utils/ship/gi-namespaces.ts`).
 */
export const NODE_BUNDLE = [
    // The rewritten `gi://` import, verbatim from the plugin that writes it.
    giNodeShimSource('Gtk', '4.0').replace('export default', 'const Gtk ='),
    // And the OTHER shape a shipped node bundle has: an application written
    // against `@gjsify/node-gi` directly. `@gjsify/node-gi/gi` is external in
    // every `--app node` build (a native addon cannot be bundled), so this import
    // survives into the output exactly as written. One fixture, both readers.
    `import { requireGi } from '@gjsify/node-gi/gi';`,
    `const Adw = requireGi('Adw', '1');`,
    `console.log(typeof Gtk, typeof Adw);`,
    '',
].join('\n');

/**
 * A minimal but complete GJS project: a built bundle, an icon, a schema, a licence.
 *
 * `mutate` receives the DIRECTORY as well as the manifest, so a caller can plant
 * a second bundle beside the first — which is the layout `resolve-gjs-entry.ts`
 * documents as normal (`dist/<name>.gjs.js` next to `dist/<name>.node.mjs`) and
 * the one a filename heuristic mis-read.
 */
export function scaffold(dir, mutate) {
    mkdirSync(join(dir, 'dist'), { recursive: true });
    mkdirSync(join(dir, 'data', 'icons', 'hicolor', 'scalable', 'apps'), { recursive: true });

    const pkg = {
        name: 'ship-demo',
        version: '1.2.3',
        license: 'MIT',
        author: 'Example Dev <dev@example.org>',
        homepage: 'https://example.org/ship-demo',
        type: 'module',
        main: 'dist/gjs.js',
        private: true,
        scripts: { build: 'node build.mjs' },
        gjsify: {
            main: 'dist/gjs.js',
            ship: {
                appId: APP_ID,
                name: 'Ship Demo',
                summary: 'Prove that gjsify ship works',
                description: 'A tiny GTK4 application used by the e2e suite.\n\nIt exists to prove the packer.',
                developer: { id: 'org.example', name: 'Example Dev', email: 'dev@example.org' },
                license: { project: 'MIT' },
                homepageUrl: 'https://example.org/ship-demo',
                categories: ['Utility'],
                // A type of the project's OWN, so the packer has to DEFINE it and not merely
                // claim to handle it. Claiming an undefined type installs cleanly and never fires.
                mimeTypes: [
                    {
                        type: 'application/x-ship-demo',
                        comment: 'Ship Demo document',
                        globs: ['*.shipdemo'],
                        genericIcon: 'text-x-generic',
                    },
                ],
            },
        },
    };
    if (mutate) mutate(pkg, dir);

    writeFileSync(join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
    writeFileSync(join(dir, 'dist', 'gjs.js'), BUNDLE);
    // A real build script, so the default path exercises the real
    // `gjsify ship` → `gjsify run build` → script chain rather than a stub.
    writeFileSync(
        join(dir, 'build.mjs'),
        [
            "import { mkdirSync, writeFileSync } from 'node:fs';",
            "mkdirSync('dist', { recursive: true });",
            `writeFileSync('dist/gjs.js', ${JSON.stringify(BUNDLE)});`,
            '',
        ].join('\n'),
    );
    writeFileSync(join(dir, 'data', `${APP_ID}.gschema.xml`), '<schemalist/>\n');
    writeFileSync(
        join(dir, 'data', 'icons', 'hicolor', 'scalable', 'apps', `${APP_ID}.svg`),
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"/>\n',
    );
    writeFileSync(join(dir, 'LICENSE'), 'MIT License\n\nPermission is hereby granted, free of charge…\n');
    return dir;
}

/**
 * Compile a REAL catalogue into `<dir>/dist/locale/<lang>/LC_MESSAGES/<domain>.mo`.
 *
 * Shared rather than written per suite for the reason this module exists at all —
 * and, here, for a second one: `ship` READS these bytes now (it folds them into the
 * `.desktop` entry and the AppStream component), so "a file with the right name" no
 * longer stands in for a catalogue. `tests/e2e/ship-from-stage` used to plant eight
 * bytes of `.mo` magic and that stopped working the moment the fold landed —
 * `msgunfmt: … is truncated`. One planter, one definition of what counts.
 */
export function plantCatalogue(projectRoot, lang, entries, domain = APP_ID) {
    const lcMessages = join(projectRoot, 'dist', 'locale', lang, 'LC_MESSAGES');
    mkdirSync(lcMessages, { recursive: true });
    const po = join(lcMessages, `${domain}.po`);
    writeFileSync(
        po,
        [
            'msgid ""',
            'msgstr ""',
            '"Content-Type: text/plain; charset=UTF-8\\n"',
            `"Language: ${lang}\\n"`,
            '',
            ...Object.entries(entries).flatMap(([id, str]) => [
                `msgid ${JSON.stringify(id)}`,
                `msgstr ${JSON.stringify(str)}`,
                '',
            ]),
        ].join('\n'),
    );
    const mo = join(lcMessages, `${domain}.mo`);
    execFileSync('msgfmt', [po, '--output-file', mo], { stdio: 'pipe' });
    // The `.po` source must not remain: `discoverLocales` refuses a locale tree
    // holding anything `bindtextdomain` will not read.
    rmSync(po);
    return mo;
}

/** Every regular file under `root`, as POSIX-separated relative paths, sorted. */
export function listFiles(root) {
    const out = [];
    const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else out.push(relative(root, full).split(sep).join('/'));
        }
    };
    walk(root);
    return out.sort();
}

/** The staged PAYLOAD — everything the stage holds except its own manifest. */
export function listPayload(root) {
    return listFiles(root).filter((rel) => rel !== STAGE_MANIFEST_FILE);
}

/**
 * True when the tool is available.
 *
 * On Linux — the only platform whose runners execute these suites — `rpm`, `ar`
 * and `tar` are REQUIRED, and a missing one fails rather than skips. That
 * distinction is the whole point: every artifact assertion sits behind one
 * of them, so a silent skip would leave the suite green having read nothing,
 * which is exactly the class these suites exist to avoid.
 * `cpio`/`rpm2cpio` stay optional — they gate one extra cross-check.
 */
const REQUIRED_ON_LINUX = new Set([
    'rpm',
    'ar',
    'tar',
    // The freedesktop-metadata tools, all five baked into `.docker/ci-fedora.Dockerfile`
    // (the three gettext ones arrive together in the `gettext` package). `msgfmt` BUILDS
    // the catalogues a localisation assertion needs; `msgunfmt`/`msgcat` are what `ship`
    // runs to read them back and to fold two text domains of one language into one; and
    // the two validators are the independent readers for what `ship` generated from them.
    // Required rather than probed for the usual reason: the interesting failure is metadata
    // that is valid AND untranslated, so a skipped oracle leaves the suite green having
    // read nothing.
    'msgfmt',
    'msgunfmt',
    'msgcat',
    'desktop-file-validate',
    'appstreamcli',
]);

/**
 * The `.github/ship-oracle` scripts every packing suite reads its artifact back with.
 *
 * HERE rather than in each suite, and the four copies this replaced are the
 * argument: `ORACLE`, `sha256`, `oracle` and `oracleExpectingFailure` were
 * byte-identical in `ship-macos` and `ship-windows` (and `ORACLE` again in
 * `ship-msi`), because each was written one milestone after the last by somebody
 * who never saw the file beside it. An oracle helper is the worst thing to keep
 * two copies of: a suite whose runner quietly stops discriminating still passes.
 */
export const ORACLE = join(MONOREPO_ROOT, '.github', 'ship-oracle');

/** A file's SHA-256, for the two-artifacts-one-payload comparisons. */
export const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

/**
 * Run one of the `.github/ship-oracle` scripts and return its output.
 *
 * `execFileSync` throws on a non-zero exit, which is what makes the GREEN calls
 * assertions in their own right: a `verify-*` script that starts failing fails
 * the calling suite without anything there having to inspect its words.
 */
export function oracle(script, args) {
    const runner = script.endsWith('.py') ? 'python3' : 'bash';
    return execFileSync(runner, [join(ORACLE, script), ...args], { encoding: 'utf-8' });
}

/**
 * Run an oracle expecting a REFUSAL, and return everything it printed.
 *
 * `assert.fail` after the `try` is what makes a run that unexpectedly SUCCEEDS
 * fail the test. Without it, a `verify-*` that stopped checking would read as a
 * passing assertion about an error that never happened — the exact shape these
 * discriminators exist to rule out.
 */
export function oracleExpectingFailure(script, args) {
    try {
        oracle(script, args);
    } catch (error) {
        assert.equal(error.status, 1, `${script} must exit 1, not ${error.status}`);
        return `${error.stdout ?? ''}${error.stderr ?? ''}`;
    }
    return assert.fail(`expected ${script} to refuse ${args.join(' ')}`);
}

/**
 * Run the CLI expecting a REFUSAL, and return everything it said.
 *
 * `runCliSync` throws on a non-zero exit and hangs the output off the error, so a
 * refusal has to be caught to be read. `assert.fail` after the `try` is what makes
 * a run that unexpectedly SUCCEEDS fail the test — without it, a broken gate reads
 * as a passing assertion about an error that never happened.
 *
 * `env` is optional because three of the four call sites that used to carry their
 * own copy of this function never passed one.
 */
export function shipExpectingFailure(args, cwd, env) {
    try {
        runCliSync(CLI_ENTRY, args, { cwd, ...(env ? { env } : {}) });
    } catch (error) {
        return `${error.stdout ?? ''}${error.stderr ?? ''}`;
    }
    return assert.fail(`expected \`gjsify ${args.join(' ')}\` to fail`);
}

export function probe(cmd) {
    if (hasCommand(cmd)) return true;
    if (process.platform === 'linux' && REQUIRED_ON_LINUX.has(cmd)) {
        throw new Error(
            `${cmd} is not on PATH. It is how this suite reads the artifact back, so skipping it would ` +
                'make every packing assertion vacuous.',
        );
    }
    console.log(`  skipping: ${cmd} not on PATH`);
    return false;
}
