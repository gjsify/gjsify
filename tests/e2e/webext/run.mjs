// E2E test for `gjsify webext build|zip|dev` (ADR 0077) — a browser extension
// built from one source into one folder per target.
//
// Driven from OUTSIDE, on both hosts the CLI runs on. The Node rows pin what
// ends up in each target folder and zip: the manifest composed per target, the
// bundles, the rewritten page, icons rendered to real PNGs, locales and public
// files, and a zip that is the folder, byte-identical across two runs. The GJS
// row pins that the same project gives the same manifests there: under GJS the
// manifest module has to be BUNDLED before it can be imported (GJS imports no
// `.ts`), which is a different path to the same answer.
//
// The dev row runs `--no-launch`: a browser is not something CI has, and
// launching one is web-ext's job. What gjsify owns is the loop: a change under
// the sources — and to the root-level manifest module, which only the
// non-recursive root watch sees — rebuilds IN PLACE. In place is measured with a
// sentinel file: deleting the folder `web-ext run` watches makes Firefox unload
// the extension mid-rebuild, so a rebuild that recreated the folder would pass a
// "content changed" check and still break the loop it exists for.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { MONOREPO_ROOT, e2eSkipReason, hasCommand, prebuildDir, spawnUntilReady } from '../helpers.mjs';

const CLI_ENTRY = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');
const CLI_BUNDLE = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'dist', 'cli.gjs.mjs');
const WS_MODULES = join(MONOREPO_ROOT, 'node_modules');
const NATIVE_PREBUILD =
    process.platform === 'linux' && (process.arch === 'x64' || process.arch === 'arm64')
        ? prebuildDir('infra', 'rolldown-native', `linux-${process.arch}`)
        : null;

// Icons render through librsvg in a `gjs` child on BOTH hosts, so every row needs gjs.
const SKIP = e2eSkipReason('webext', [
    ['`gjs` on PATH (icons render through librsvg in a gjs child)', hasCommand('gjs')],
    ['the built Node CLI (packages/infra/cli/lib/index.js)', existsSync(CLI_ENTRY)],
]);
const SKIP_GJS =
    SKIP ||
    e2eSkipReason('webext', [
        ['the GJS CLI bundle (packages/infra/cli/dist/cli.gjs.mjs)', existsSync(CLI_BUNDLE)],
        [
            "`@gjsify/rolldown-native`'s prebuild for this host",
            NATIVE_PREBUILD !== null && existsSync(join(NATIVE_PREBUILD, 'GjsifyRolldown-1.0.typelib')),
        ],
    ]);

const SVG = (size) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}" fill="#3584e4"/></svg>\n`;

/** A small extension: two scripts, one page with a module script and a stylesheet, icons, locales, a public file. */
function writeFixture(root, marker) {
    const files = {
        'package.json': JSON.stringify(
            {
                name: '@e2e/webext-fixture',
                version: '1.4.2',
                type: 'module',
                private: true,
                gjsify: {
                    webext: {
                        targets: ['chrome-mv3', 'firefox-mv2'],
                        manifest: 'manifest.ts',
                        scripts: { background: 'src/background.ts', content: 'src/content.ts' },
                        pages: { popup: 'src/popup/index.html' },
                        icons: {
                            sizes: [16, 48],
                            sources: { logo: { default: 'icons/logo.svg', 16: 'icons/logo-small.svg' } },
                            svg: ['firefox-mv2'],
                        },
                    },
                },
            },
            null,
            2,
        ),
        'manifest.ts': [
            'export default (ctx: { manifestVersion: 2 | 3; browser: string; mode: string; icons(n: string): Record<string, string> }) => ({',
            '    manifest_version: ctx.manifestVersion,',
            "    name: '__MSG_name__',",
            "    description: 'mode ' + ctx.mode,",
            "    default_locale: 'en',",
            "    icons: ctx.icons('logo'),",
            '    ...(ctx.manifestVersion === 3',
            "        ? { action: { default_popup: 'popup.html' }, background: { service_worker: 'background.js' } }",
            "        : { browser_action: { default_popup: 'popup.html' }, background: { scripts: ['background.js'] } }),",
            "    content_scripts: [{ matches: ['https://*/*'], js: ['content.js'] }],",
            '});',
            '',
        ].join('\n'),
        'src/shared.ts': 'export const greet = (who: string): string => `hello ${who}`;\n',
        'src/background.ts': "import { greet } from './shared.ts';\nconsole.log(greet('background'), __MARK__);\n",
        'src/content.ts': `console.log(${JSON.stringify(marker)});\n`,
        'src/popup/index.html':
            '<!doctype html>\n<link rel="stylesheet" href="./popup.css">\n<p id="x"></p>\n<script type="module" src="./main.ts"></script>\n',
        'src/popup/popup.css': 'p { color: red; }\n',
        'src/popup/main.ts':
            "import { greet } from '../shared.ts';\ndocument.getElementById('x')!.textContent = greet('popup');\n",
        'src/globals.d.ts': 'declare const __MARK__: string;\n',
        'icons/logo.svg': SVG(128),
        'icons/logo-small.svg': SVG(16),
        '_locales/en/messages.json': '{ "name": { "message": "fixture" } }\n',
        'public/robots.txt': 'public file\n',
    };
    for (const [path, content] of Object.entries(files)) {
        mkdirSync(join(root, path, '..'), { recursive: true });
        writeFileSync(join(root, path), content);
    }
    const modules = join(root, 'node_modules');
    mkdirSync(modules, { recursive: true });
    for (const pkg of ['@gjsify', '@girs', 'rolldown', '@rolldown']) {
        if (existsSync(join(WS_MODULES, pkg))) symlinkSync(join(WS_MODULES, pkg), join(modules, pkg), 'dir');
    }
}

function filesUnder(dir) {
    const out = [];
    const walk = (current) => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            const full = join(current, entry.name);
            if (entry.isDirectory()) walk(full);
            else out.push(relative(dir, full).split(/[\\/]/).join('/'));
        }
    };
    walk(dir);
    return out.sort();
}

/** Width and height from a PNG's IHDR. */
function pngSize(bytes) {
    assert.equal(bytes.subarray(1, 4).toString('latin1'), 'PNG');
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

/** Names of the entries in a STORE zip, read from its central directory — no unzip needed. */
function zipNames(bytes) {
    const eocd = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    const count = bytes.readUInt16LE(eocd + 10);
    let at = bytes.readUInt32LE(eocd + 16);
    const names = [];
    for (let i = 0; i < count; i++) {
        const nameLength = bytes.readUInt16LE(at + 28);
        const extra = bytes.readUInt16LE(at + 30);
        const comment = bytes.readUInt16LE(at + 32);
        names.push(bytes.subarray(at + 46, at + 46 + nameLength).toString('utf8'));
        at += 46 + nameLength + extra + comment;
    }
    return names.sort();
}

const runNodeCli = (cwd, args) =>
    execFileSync(process.execPath, [CLI_ENTRY, ...args], {
        cwd,
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 5 * 60 * 1000,
    });

describe('gjsify webext', { skip: SKIP, timeout: 15 * 60 * 1000 }, () => {
    let tmp;
    let project;

    before(() => {
        tmp = mkdtempSync(join(tmpdir(), 'gjsify-e2e-webext-'));
        project = join(tmp, 'ext');
        writeFixture(project, 'content v1');
    });

    after(() => rmSync(tmp, { recursive: true, force: true }));

    const gjsEnv = () => ({
        ...process.env,
        HOME: tmp,
        XDG_CACHE_HOME: join(tmp, '.cache'),
        GI_TYPELIB_PATH: NATIVE_PREBUILD,
        LD_LIBRARY_PATH: NATIVE_PREBUILD,
    });

    it('builds and zips one folder per target, with a manifest composed for each', () => {
        const out = runNodeCli(project, ['webext', 'zip', '--define', '__MARK__="e2e-define"']);
        assert.match(out, /zipped .*\/webext-fixture-1\.4\.2-chrome-mv3\.zip/);

        const chrome = join(project, '.output', 'chrome-mv3');
        const firefox = join(project, '.output', 'firefox-mv2');
        assert.deepEqual(filesUnder(chrome), [
            '_locales/en/messages.json',
            'background.js',
            'content.js',
            'icons/logo-16.png',
            'icons/logo-48.png',
            'manifest.json',
            'popup.css',
            'popup.html',
            'popup.js',
            'robots.txt',
        ]);
        assert.deepEqual(filesUnder(firefox), [
            '_locales/en/messages.json',
            'background.js',
            'content.js',
            'icons/logo-small.svg',
            'icons/logo.svg',
            'manifest.json',
            'popup.css',
            'popup.html',
            'popup.js',
            'robots.txt',
        ]);

        const chromeManifest = JSON.parse(readFileSync(join(chrome, 'manifest.json'), 'utf8'));
        assert.equal(chromeManifest.manifest_version, 3);
        assert.equal(chromeManifest.version, '1.4.2');
        assert.equal(chromeManifest.description, 'mode production');
        assert.deepEqual(chromeManifest.background, { service_worker: 'background.js' });
        assert.deepEqual(chromeManifest.icons, { 16: 'icons/logo-16.png', 48: 'icons/logo-48.png' });
        const firefoxManifest = JSON.parse(readFileSync(join(firefox, 'manifest.json'), 'utf8'));
        assert.equal(firefoxManifest.manifest_version, 2);
        assert.deepEqual(firefoxManifest.browser_action, { default_popup: 'popup.html' });
        assert.deepEqual(firefoxManifest.icons, { 16: 'icons/logo-small.svg', 48: 'icons/logo.svg' });

        // Real rasters at the declared sizes, the 16 px one from the small source.
        assert.deepEqual(pngSize(readFileSync(join(chrome, 'icons', 'logo-16.png'))), [16, 16]);
        assert.deepEqual(pngSize(readFileSync(join(chrome, 'icons', 'logo-48.png'))), [48, 48]);

        // Scripts are classic IIFEs; the page keeps its module tag, pointed at the build.
        const background = readFileSync(join(chrome, 'background.js'), 'utf8');
        assert.match(background, /^\(function\(\)|^\(\(\)=>/);
        assert.match(background, /e2e-define/);
        assert.match(background, /hello /);
        const html = readFileSync(join(chrome, 'popup.html'), 'utf8');
        assert.match(html, /<script type="module" src="popup\.js"><\/script>/);
        assert.match(html, /<link rel="stylesheet" href="popup\.css">/);

        const zip = readFileSync(join(project, '.output', 'webext-fixture-1.4.2-chrome-mv3.zip'));
        assert.deepEqual(zipNames(zip), filesUnder(chrome));

        // A rebuild zips to the same bytes: entries sorted, one fixed timestamp.
        runNodeCli(project, ['webext', 'zip', '--target', 'chrome-mv3', '--define', '__MARK__="e2e-define"']);
        assert.equal(
            Buffer.compare(zip, readFileSync(join(project, '.output', 'webext-fixture-1.4.2-chrome-mv3.zip'))),
            0,
        );
    });

    it('refuses a folder the browser would not load, before anything is zipped', () => {
        const broken = join(tmp, 'broken');
        writeFixture(broken, 'x');
        rmSync(join(broken, '_locales'), { recursive: true });
        let stderr = '';
        try {
            runNodeCli(broken, ['webext', 'zip', '--define', '__MARK__="x"']);
        } catch (err) {
            stderr = String(err.stderr);
        }
        assert.match(stderr, /chrome-mv3 would not load/);
        assert.match(stderr, /default_locale "en" but there is no _locales\/ directory/);
        assert.equal(existsSync(join(broken, '.output', 'webext-fixture-1.4.2-chrome-mv3.zip')), false);
    });

    /**
     * One dev session: a source edit and a manifest edit, each rebuilt IN PLACE.
     * `round` keeps the two hosts' edits distinct, so the second session cannot
     * pass on what the first one wrote.
     */
    async function devRoundTrip(command, argv, env, round) {
        const dev = await spawnUntilReady(command, argv, {
            cwd: project,
            env,
            ready: /\[webext\] watching/,
            label: `gjsify webext dev (${command})`,
            timeoutMs: 3 * 60 * 1000,
        });
        const dir = join(project, '.output-dev', 'firefox-mv2');
        const waitFor = async (what, check) => {
            const deadline = Date.now() + 60_000;
            while (!check()) {
                if (Date.now() > deadline) throw new Error(`no rebuild: ${what}\n${dev.output()}`);
                await new Promise((resolve) => setTimeout(resolve, 200));
            }
        };
        try {
            assert.match(readFileSync(join(dir, 'manifest.json'), 'utf8'), / development"/);
            writeFileSync(join(dir, 'sentinel'), round);

            writeFileSync(join(project, 'src', 'content.ts'), `console.log("content ${round}");\n`);
            await waitFor(`content ${round}`, () =>
                readFileSync(join(dir, 'content.js'), 'utf8').includes(`content ${round}`),
            );

            const manifest = readFileSync(join(project, 'manifest.ts'), 'utf8');
            writeFileSync(
                join(project, 'manifest.ts'),
                manifest.replace(/'[a-z-]+ ' \+ ctx\.mode/, `'${round} ' + ctx.mode`),
            );
            await waitFor(`manifest ${round}`, () =>
                readFileSync(join(dir, 'manifest.json'), 'utf8').includes(`${round} development`),
            );
            assert.equal(
                readFileSync(join(dir, 'sentinel'), 'utf8'),
                round,
                'the dev folder was recreated, not rebuilt in place',
            );
        } finally {
            await dev.stop();
        }
    }

    const DEV_ARGS = ['webext', 'dev', '--no-launch', '--target', 'firefox-mv2', '--define', '__MARK__="dev"'];

    it('dev --no-launch rebuilds in place on a source change and on a manifest change', async () => {
        await devRoundTrip(process.execPath, [CLI_ENTRY, ...DEV_ARGS], process.env, 'node-round');
    });

    // The loop's holds are GJS-specific (a held main loop, Gio file monitors, the
    // root watched non-recursively), so a Node row alone cannot fail for any of them.
    it('dev --no-launch does the same on the GJS-hosted CLI', { skip: SKIP_GJS }, async () => {
        await devRoundTrip('gjs', ['-m', CLI_BUNDLE, ...DEV_ARGS], gjsEnv(), 'gjs-round');
    });

    it('the GJS-hosted CLI composes the same manifests', { skip: SKIP_GJS }, async () => {
        writeFileSync(join(project, 'src', 'content.ts'), 'console.log("content v1");\n');
        const gjs = await spawnUntilReady(
            'gjs',
            ['-m', CLI_BUNDLE, 'webext', 'build', '--out-dir', '.output-gjs', '--define', '__MARK__="e2e-define"'],
            {
                cwd: project,
                ready: /built .*firefox-mv2/,
                awaitExit: true,
                label: 'gjs cli webext build',
                timeoutMs: 5 * 60 * 1000,
                env: gjsEnv(),
            },
        );
        assert.equal(gjs.code, 0, gjs.output());
        runNodeCli(project, ['webext', 'build', '--define', '__MARK__="e2e-define"']);
        for (const target of ['chrome-mv3', 'firefox-mv2']) {
            assert.deepEqual(
                filesUnder(join(project, '.output-gjs', target)),
                filesUnder(join(project, '.output', target)),
                target,
            );
            assert.equal(
                readFileSync(join(project, '.output-gjs', target, 'manifest.json'), 'utf8'),
                readFileSync(join(project, '.output', target, 'manifest.json'), 'utf8'),
                target,
            );
        }
    });
});
