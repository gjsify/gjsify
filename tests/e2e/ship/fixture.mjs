// The demo project both `ship` suites build, and the readers they check artifacts with.
//
// Extracted when `tests/e2e/ship-from-stage` needed the same project. A second copy of the
// scaffold would be a second definition of "a shippable project": the two suites would drift, and
// the drifted one is the one that keeps passing while proving something else.

import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { hasCommand } from '../helpers.mjs';

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

/** A minimal but complete GJS project: a built bundle, an icon, a schema, a licence. */
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
    if (mutate) mutate(pkg);

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
const REQUIRED_ON_LINUX = new Set(['rpm', 'ar', 'tar']);

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
