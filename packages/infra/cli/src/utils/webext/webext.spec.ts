import { describe, expect, it } from '@gjsify/unit';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { tinyPng } from '../ship/icon-fixture.spec.js';
import { buildWebext, zipEntriesOf, zipTimestamp, type BundleRequest } from './build.js';
import { defaultArtifactName, iconSourceForSize, resolveWebextConfig, selectTargets } from './config.js';
import { svgIconFiles, webextIconPaths } from './icons.js';
import { defaultDevProfile, resolveWebExt, webExtRunArgs } from './launch.js';
import {
    applyTargetOverrides,
    checkManifest,
    composeManifest,
    manifestFileReferences,
    mergeManifest,
} from './manifest.js';
import { planPage } from './pages.js';
import { parseWebextTarget } from './targets.js';

/** The message a call throws, or null. */
function thrown(run: () => unknown): string | null {
    try {
        run();
        return null;
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
}

/** A project on disk: `files` maps a relative path to its content. */
function project(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), 'gjsify-webext-'));
    for (const [path, content] of Object.entries(files)) {
        mkdirSync(join(root, path, '..'), { recursive: true });
        writeFileSync(join(root, path), content);
    }
    return root;
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"/>\n';

export default async () => {
    await describe('webext targets', async () => {
        await it('parses <browser>-mv<n> and refuses what the browser removed', async () => {
            expect(parseWebextTarget('firefox-mv2')).toStrictEqual({
                id: 'firefox-mv2',
                browser: 'firefox',
                manifestVersion: 2,
            });
            expect(parseWebextTarget('edge-mv3').browser).toBe('edge');
            expect(thrown(() => parseWebextTarget('chrome-mv2'))).toContain('removed Manifest V2');
            expect(thrown(() => parseWebextTarget('opera-mv3'))).toContain('unknown target');
            expect(thrown(() => parseWebextTarget('chrome'))).toContain('unknown target');
        });
    });

    await describe('webext config', async () => {
        const files = {
            'manifest.json': '{}',
            'src/bg.ts': '',
            'src/popup/index.html': '',
            'icons/a.svg': SVG,
            'icons/a-small.svg': SVG,
            '_locales/en/messages.json': '{}',
        };

        await it('resolves paths, defaults the manifest, locales and targets', async () => {
            const root = project(files);
            const config = resolveWebextConfig(
                {
                    name: '@scope/hello',
                    version: '1.2.3',
                    gjsify: { webext: { scripts: { background: 'src/bg.ts' } } },
                },
                root,
            );
            expect(config.name).toBe('hello');
            expect(config.version).toBe('1.2.3');
            expect(config.manifest).toBe(join(root, 'manifest.json'));
            expect(config.targets.map((t) => t.id)).toStrictEqual(['chrome-mv3', 'firefox-mv3']);
            expect(config.localesDir).toBe(join(root, '_locales'));
            expect(config.publicDir).toBe(null);
            expect(config.outDir).toBe(join(root, '.output'));
            rmSync(root, { recursive: true, force: true });
        });

        await it('collects every problem into one refusal', async () => {
            const root = project(files);
            const message = thrown(() =>
                resolveWebextConfig(
                    {
                        gjsify: {
                            webext: {
                                targets: ['chrome-mv2', 'firefox-mv2', 'firefox-mv2'],
                                scripts: { popup: 'src/missing.ts', 'bad/name': 'src/bg.ts' },
                                pages: { popup: 'src/popup/index.html' },
                                icons: { sources: { a: { '32': 'icons/a-small.svg' } }, svg: ['safari-mv3'] },
                                public: 'nope',
                            },
                        },
                    },
                    root,
                ),
            ) as string;
            expect(message).toContain('removed Manifest V2');
            expect(message).toContain('"firefox-mv2" is listed twice');
            expect(message).toContain('`scripts.popup` "src/missing.ts" is not a file');
            expect(message).toContain('`scripts.bad/name`');
            expect(message).toContain('both write popup.js');
            expect(message).toContain('no SVG for 48 px');
            expect(message).toContain('`icons.svg` names "safari-mv3"');
            expect(message).toContain('`public` "nope" is not a directory');
            rmSync(root, { recursive: true, force: true });
        });

        await it('refuses a package with no block, and nothing to build', async () => {
            expect(thrown(() => resolveWebextConfig({}, '/x'))).toContain('declares no `gjsify.webext`');
            const root = project({ 'manifest.json': '{}' });
            expect(thrown(() => resolveWebextConfig({ gjsify: { webext: {} } }, root))).toContain('nothing to build');
            rmSync(root, { recursive: true, force: true });
        });

        await it('selects targets by name and names what is configured', async () => {
            const root = project(files);
            const config = resolveWebextConfig({ gjsify: { webext: { scripts: { background: 'src/bg.ts' } } } }, root);
            expect(selectTargets(config, ['firefox-mv3']).map((t) => t.id)).toStrictEqual(['firefox-mv3']);
            expect(thrown(() => selectTargets(config, ['edge-mv3']))).toContain('not in `gjsify.webext.targets`');
            rmSync(root, { recursive: true, force: true });
        });

        await it('picks an icon source by the smallest ceiling that covers the size', async () => {
            const source = { default: 'big.svg', '32': 'small.svg', '16': 'tiny.svg' };
            expect(iconSourceForSize(source, 16)).toBe('tiny.svg');
            expect(iconSourceForSize(source, 24)).toBe('small.svg');
            expect(iconSourceForSize(source, 48)).toBe('big.svg');
            expect(iconSourceForSize('one.svg', 128)).toBe('one.svg');
            expect(iconSourceForSize({ '32': 'small.svg' }, 48)).toBe(undefined);
            expect(defaultArtifactName('@scope/x')).toBe('x');
        });
    });

    await describe('webext pages', async () => {
        await it('bundles local scripts per their tag type and copies local stylesheets', async () => {
            const html = [
                '<link rel="stylesheet" href="../../src/ui/style.css" />',
                '<link rel="icon" href="icon.png" />',
                '<link rel="stylesheet" href="https://cdn.example/x.css" />',
                '<style>body { width: 1px }</style>',
                '<script src="/vendor/prebuilt.js"></script>',
                '<script type="module" src="./main.ts"></script>',
                '<script src="./legacy.js"></script>',
            ].join('\n');
            const plan = planPage('popup', '/p/entrypoints/popup/index.html', html);
            expect(plan.scripts).toStrictEqual([
                { entry: '/p/entrypoints/popup/main.ts', format: 'esm', output: 'popup.js' },
                { entry: '/p/entrypoints/popup/legacy.js', format: 'iife', output: 'popup-2.js' },
            ]);
            expect(plan.stylesheets).toStrictEqual([{ source: '/p/src/ui/style.css', output: 'style.css' }]);
            expect(plan.html).toContain('<script type="module" src="popup.js"></script>');
            expect(plan.html).toContain('<script src="popup-2.js"></script>');
            expect(plan.html).toContain('<link rel="stylesheet" href="style.css" />');
            // Untouched: a non-stylesheet link, a remote sheet, an absolute extension path, inline CSS.
            expect(plan.html).toContain('href="icon.png"');
            expect(plan.html).toContain('https://cdn.example/x.css');
            expect(plan.html).toContain('src="/vendor/prebuilt.js"');
            expect(plan.html).toContain('<style>body { width: 1px }</style>');
        });
    });

    await describe('webext manifest', async () => {
        const chrome = parseWebextTarget('chrome-mv3');
        const firefox = parseWebextTarget('firefox-mv2');

        await it('merges $targets overrides: objects merge, arrays replace, null deletes', async () => {
            const template = {
                manifest_version: 3,
                action: { default_popup: 'popup.html', default_title: 'x' },
                permissions: ['storage', 'scripting'],
                background: { service_worker: 'background.js' },
                $targets: {
                    'firefox-mv2': {
                        manifest_version: 2,
                        action: null,
                        browser_action: { default_popup: 'popup.html' },
                        permissions: ['storage'],
                        background: { service_worker: null, scripts: ['background.js'] },
                    },
                },
            };
            expect(applyTargetOverrides(template, 'firefox-mv2')).toStrictEqual({
                manifest_version: 2,
                permissions: ['storage'],
                background: { scripts: ['background.js'] },
                browser_action: { default_popup: 'popup.html' },
            });
            expect(applyTargetOverrides(template, 'chrome-mv3').$targets).toBe(undefined);
            expect(mergeManifest({ a: { b: 1, c: 2 } }, { a: { c: 3 } })).toStrictEqual({ a: { b: 1, c: 3 } });
        });

        await it('calls a function template with the target and fills the version beside the name', async () => {
            const seen: string[] = [];
            const manifest = await composeManifest(
                (ctx) => {
                    seen.push(`${ctx.target}:${ctx.manifestVersion}:${ctx.mode}`);
                    return { manifest_version: ctx.manifestVersion, name: 'x', icons: ctx.icons('a') };
                },
                {
                    target: 'chrome-mv3',
                    browser: 'chrome',
                    manifestVersion: 3,
                    mode: 'production',
                    version: '2.0.0',
                    define: {},
                    icons: () => ({ '16': 'icons/a-16.png' }),
                },
            );
            expect(seen).toStrictEqual(['chrome-mv3:3:production']);
            expect(Object.keys(manifest)).toStrictEqual(['manifest_version', 'name', 'version', 'icons']);
            expect(manifest.version).toBe('2.0.0');
        });

        await it('lists the files a manifest loads, and only those', async () => {
            const refs = manifestFileReferences({
                name: 'popup.html looks like a path but is a name',
                background: { service_worker: 'background.js', scripts: ['a.js'] },
                content_scripts: [{ js: ['content.js'], css: ['content.css'] }],
                action: { default_popup: '/popup.html', default_icon: { '16': 'icons/a-16.png' } },
                browser_action: { default_icon: 'icons/b.svg' },
                options_ui: { page: 'options.html' },
                devtools_page: 'devtools.html',
                side_panel: { default_path: 'panel.html' },
                icons: { '48': 'icons/a-48.png' },
                web_accessible_resources: [{ resources: ['inject.js', 'assets/*'] }, 'legacy.js'],
                chrome_url_overrides: { newtab: 'newtab.html' },
                homepage_url: 'https://example.org/x.html',
            });
            expect(refs).toStrictEqual(
                [
                    'a.js',
                    'background.js',
                    'content.css',
                    'content.js',
                    'devtools.html',
                    'icons/a-16.png',
                    'icons/a-48.png',
                    'icons/b.svg',
                    'inject.js',
                    'legacy.js',
                    'newtab.html',
                    'options.html',
                    'panel.html',
                    'popup.html',
                ].sort(),
            );
        });

        await it('checks the version, the files and the locale pairing against the folder', async () => {
            const dir = project({ 'background.js': '', '_locales/de/messages.json': '{}' });
            const problems = checkManifest(
                {
                    manifest_version: 2,
                    background: { service_worker: 'background.js' },
                    action: { default_popup: 'popup.html' },
                },
                chrome,
                dir,
            );
            expect(problems.length).toBe(3);
            expect(problems[0]).toContain('manifest_version is 2');
            expect(problems[1]).toContain('"popup.html"');
            expect(problems[2]).toContain('no default_locale');
            expect(checkManifest({ manifest_version: 2, default_locale: 'en' }, firefox, dir)[0]).toContain(
                '_locales/en/messages.json does not exist',
            );
            rmSync(join(dir, '_locales'), { recursive: true });
            expect(checkManifest({ manifest_version: 2, default_locale: 'en' }, firefox, dir)[0]).toContain(
                'no _locales/ directory',
            );
            rmSync(dir, { recursive: true, force: true });
        });
    });

    await describe('webext icons', async () => {
        const icons = {
            sizes: [16, 32, 48],
            sources: new Map([
                [
                    'idle',
                    new Map([
                        [16, '/p/icons/idle-small.svg'],
                        [32, '/p/icons/idle-small.svg'],
                        [48, '/p/icons/idle.svg'],
                    ]),
                ],
            ]),
            svgTargets: new Set(['firefox-mv2']),
        };

        await it('names PNGs per size and SVGs by file, the same way for the manifest and the writer', async () => {
            expect(webextIconPaths(icons, 'idle', parseWebextTarget('chrome-mv3'))).toStrictEqual({
                '16': 'icons/idle-16.png',
                '32': 'icons/idle-32.png',
                '48': 'icons/idle-48.png',
            });
            expect(webextIconPaths(icons, 'idle', parseWebextTarget('firefox-mv2'))).toStrictEqual({
                '16': 'icons/idle-small.svg',
                '32': 'icons/idle-small.svg',
                '48': 'icons/idle.svg',
            });
            expect([...svgIconFiles(icons).keys()]).toStrictEqual(['icons/idle-small.svg', 'icons/idle.svg']);
            expect(thrown(() => webextIconPaths(icons, 'busy', parseWebextTarget('chrome-mv3')))).toContain('"idle"');
        });

        await it('refuses two SVGs that would land on one file name', async () => {
            const clash = { ...icons, sources: new Map([...icons.sources, ['busy', new Map([[16, '/q/idle.svg']])]]) };
            expect(thrown(() => svgIconFiles(clash))).toContain('same file name');
        });
    });

    await describe('webext launch', async () => {
        await it('spells web-ext run per browser', async () => {
            const firefox = webExtRunArgs({
                sourceDir: '/o/firefox-mv2',
                target: parseWebextTarget('firefox-mv2'),
                profile: '/c/p',
                headless: true,
            });
            expect(firefox).toStrictEqual([
                'run',
                '--source-dir',
                '/o/firefox-mv2',
                '--target',
                'firefox-desktop',
                '--no-input',
                '--profile-create-if-missing',
                '--firefox-profile',
                '/c/p',
                '--keep-profile-changes',
                '--arg=-headless',
            ]);
            const chromium = webExtRunArgs({
                sourceDir: '/o/chrome-mv3',
                target: parseWebextTarget('chrome-mv3'),
                profile: '/c/p',
                browserBinary: '/b/chrome',
            });
            expect(chromium).toContain('chromium');
            expect(chromium).toContain('--chromium-binary');
            expect(chromium).not.toContain('--keep-profile-changes');
            expect(
                thrown(() =>
                    webExtRunArgs({ sourceDir: '/o', target: parseWebextTarget('safari-mv3'), profile: '/p' }),
                ),
            ).toContain('cannot launch safari');
            expect(defaultDevProfile('hello', parseWebextTarget('firefox-mv3'), { XDG_CACHE_HOME: '/cache' })).toBe(
                join('/cache', 'gjsify', 'webext', 'hello', 'firefox-mv3'),
            );
        });

        await it('finds a hoisted web-ext and hands it over by PATH, never by its path', async () => {
            // A workspace hoists web-ext to the root; the extension package sits below it.
            const root = project({ 'node_modules/.bin/web-ext.cmd': '', 'packages/ext/package.json': '{}' });
            const found = resolveWebExt(join(root, 'packages', 'ext'), 'win32', { PATH: '/usr/bin' });
            expect(found?.cmd).toBe('web-ext');
            expect(found?.env.PATH?.startsWith(join(root, 'node_modules', '.bin'))).toBe(true);
            expect(found?.env.PATH?.endsWith('/usr/bin')).toBe(true);
            rmSync(root, { recursive: true, force: true });
        });
    });

    await describe('webext build', async () => {
        await it('assembles one folder per target around bundles built once', async () => {
            const root = project({
                'package.json': '{}',
                'manifest.json': JSON.stringify({
                    manifest_version: 3,
                    name: 'fixture',
                    default_locale: 'en',
                    background: { service_worker: 'background.js' },
                    action: { default_popup: 'popup.html' },
                    $targets: {
                        'firefox-mv2': {
                            manifest_version: 2,
                            background: { service_worker: null, scripts: ['background.js'] },
                            action: null,
                            browser_action: { default_popup: 'popup.html' },
                        },
                    },
                }),
                'src/background.ts': '',
                'src/popup/index.html':
                    '<link rel="stylesheet" href="./p.css"><script type="module" src="./main.ts"></script>',
                'src/popup/p.css': 'body{}',
                'src/popup/main.ts': '',
                'icons/i.svg': SVG,
                '_locales/en/messages.json': '{}',
                'public/robots.txt': 'x',
            });
            const config = resolveWebextConfig(
                {
                    name: 'fixture',
                    version: '0.3.0',
                    gjsify: {
                        webext: {
                            targets: ['chrome-mv3', 'firefox-mv2'],
                            scripts: { background: 'src/background.ts' },
                            pages: { popup: 'src/popup/index.html' },
                            icons: { sizes: [16, 48], sources: { i: 'icons/i.svg' }, svg: ['firefox-mv2'] },
                        },
                    },
                },
                root,
            );
            const bundles: BundleRequest[] = [];
            const rendered: string[] = [];
            const result = await buildWebext({
                config,
                targets: config.targets,
                outDir: join(root, 'out'),
                mode: 'production',
                define: { __X__: '1' },
                inPlace: false,
                zip: true,
                log: () => undefined,
                bundle: async (request) => {
                    bundles.push(request);
                    writeFileSync(request.outfile, `/* ${request.format} */`);
                },
                rasterize: async ({ svg, sizes }) => {
                    rendered.push(`${svg}@${sizes.join(',')}`);
                    return new Map(sizes.map((size) => [size, tinyPng(size)]));
                },
            });

            // Built ONCE for both targets; the page's module script stays a module.
            expect(bundles.map((b) => `${b.format}:${b.outfile.split(/[\\/]/).pop()}`)).toStrictEqual([
                'iife:background.js',
                'esm:popup.js',
            ]);
            expect(bundles[0]?.define).toStrictEqual({ __X__: '1' });
            expect(rendered).toStrictEqual([`${join(root, 'icons/i.svg')}@16,48`]);

            const chrome = join(root, 'out', 'chrome-mv3');
            const firefox = join(root, 'out', 'firefox-mv2');
            expect(
                zipEntriesOf(chrome)
                    .map((e) => e.path)
                    .sort(),
            ).toStrictEqual([
                '_locales/en/messages.json',
                'background.js',
                'icons/i-16.png',
                'icons/i-48.png',
                'manifest.json',
                'p.css',
                'popup.html',
                'popup.js',
                'robots.txt',
            ]);
            expect(existsSync(join(firefox, 'icons', 'i.svg'))).toBe(true);
            expect(existsSync(join(firefox, 'icons', 'i-16.png'))).toBe(false);
            const ffManifest = JSON.parse(readFileSync(join(firefox, 'manifest.json'), 'utf8'));
            expect(ffManifest.manifest_version).toBe(2);
            expect(ffManifest.version).toBe('0.3.0');
            expect(ffManifest.background).toStrictEqual({ scripts: ['background.js'] });
            expect(existsSync(join(root, 'out', '.stage'))).toBe(false);
            expect(result.zips.get('chrome-mv3')).toBe(join(root, 'out', 'fixture-0.3.0-chrome-mv3.zip'));
            // Deterministic: a second zip of the same folder is the same bytes.
            const first = readFileSync(result.zips.get('chrome-mv3') as string);
            await buildWebext({
                config,
                targets: [config.targets[0]!],
                outDir: join(root, 'out'),
                mode: 'production',
                define: { __X__: '1' },
                inPlace: false,
                zip: true,
                log: () => undefined,
                bundle: async (request) => writeFileSync(request.outfile, `/* ${request.format} */`),
                rasterize: async ({ sizes }) => new Map(sizes.map((size) => [size, tinyPng(size)])),
            });
            expect(Buffer.compare(first, readFileSync(result.zips.get('chrome-mv3') as string))).toBe(0);
            rmSync(root, { recursive: true, force: true });
        });

        await it('refuses a folder the browser would not load, naming the target', async () => {
            const root = project({
                'package.json': '{}',
                'manifest.json': JSON.stringify({
                    manifest_version: 3,
                    name: 'x',
                    options_ui: { page: 'options.html' },
                }),
                'src/bg.ts': '',
            });
            const config = resolveWebextConfig(
                { gjsify: { webext: { targets: ['chrome-mv3'], scripts: { bg: 'src/bg.ts' } } } },
                root,
            );
            let message = '';
            try {
                await buildWebext({
                    config,
                    targets: config.targets,
                    outDir: join(root, 'out'),
                    mode: 'production',
                    define: {},
                    inPlace: false,
                    zip: false,
                    log: () => undefined,
                    bundle: async (request) => writeFileSync(request.outfile, ''),
                });
            } catch (error) {
                message = (error as Error).message;
            }
            expect(message).toContain('chrome-mv3 would not load');
            expect(message).toContain('"options.html"');
            rmSync(root, { recursive: true, force: true });
        });

        await it('stamps zips with SOURCE_DATE_EPOCH, floored at 1980', async () => {
            expect(zipTimestamp({})).toBe(315532800);
            expect(zipTimestamp({ SOURCE_DATE_EPOCH: '1700000000' })).toBe(1700000000);
            expect(zipTimestamp({ SOURCE_DATE_EPOCH: '5' })).toBe(315532800);
        });
    });
};
