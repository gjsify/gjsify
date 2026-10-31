// What a scaffolded `gtk-minimal` project has to be before `gjsify ship` will
// look at it.
//
// The ship config lives in the template's package.json and is therefore only
// proved by scaffolding: `createProject` rewrites the application-id sentinel in
// FILENAMES as well as contents, and the icon it ships is named after that id.
// Every assertion here is one `gjsify ship` refuses the project for (no licence,
// no icon, wrong OS key, no bundle) or one the user would otherwise discover on
// their first `npm run ship`.

import { describe, expect, it } from '@gjsify/unit';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { applicationIdFor, createProject } from './create.js';

const TEMPLATE = 'gtk-minimal';
const PROJECT = 'ship-ready-demo';

interface PackageJson {
    license?: string;
    author?: string;
    scripts?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    gjsify?: {
        ship?: {
            appId?: string;
            icon?: string;
            app?: Record<string, string>;
            bundle?: Record<string, string>;
        };
    };
}

/** Every path under `dir`, POSIX-separated, relative to it. */
function walk(dir: string, prefix = ''): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
        out.push(rel);
        if (entry.isDirectory()) out.push(...walk(join(dir, entry.name), rel));
    }
    return out;
}

export default async () => {
    await describe('create-app: gtk-minimal scaffolds a ship-ready project', async () => {
        // One scaffold for the whole suite: `createProject` writes a real tree,
        // and re-creating it per assertion would only re-prove the copy.
        const cwd = process.cwd();
        const sandbox = mkdtempSync(join(tmpdir(), 'gjsify-create-ship-'));
        try {
            process.chdir(sandbox);
            await createProject({ projectName: PROJECT, template: TEMPLATE });
            const projectDir = join(sandbox, PROJECT);
            const pkg = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf-8')) as PackageJson;
            const ship = pkg.gjsify?.ship ?? {};
            const appId = applicationIdFor(PROJECT);
            const paths = walk(projectDir);

            await it('declares the metadata every package format requires', () => {
                expect(pkg.license).toBe('MIT');
                expect(typeof pkg.author).toBe('string');
                expect(paths).toContain('LICENSE');
                const license = readFileSync(join(projectDir, 'LICENSE'), 'utf-8');
                expect(license).toContain('MIT License');
                // The copyright line carries the project-name sentinel, so this
                // also proves an extensionless file is substituted at all.
                expect(license).toContain(PROJECT);
            });

            await it('ships an appId and an icon named after the scaffolded project', () => {
                expect(ship.appId).toBe(appId);
                expect(ship.icon).toBe('data/icons');
                const icon = `data/icons/hicolor/scalable/apps/${appId}.svg`;
                expect(paths).toContain(icon);
                expect(existsSync(join(projectDir, icon)) && statSync(join(projectDir, icon)).isFile()).toBe(true);
            });

            await it('runs the node bundle on macOS and Windows', () => {
                // `gjsify.ship.app` is keyed in the `process.platform` spelling,
                // and the layout, not the host, decides which key applies.
                expect(ship.app?.darwin).toBe('node');
                expect(ship.app?.win32).toBe('node');
                expect(ship.bundle?.darwin).toBe('dist/index.node.mjs');
                expect(ship.bundle?.win32).toBe('dist/index.node.mjs');
                expect(pkg.scripts?.ship).toBe('gjsify ship');
            });

            await it('declares the bundled Node interpreters as optional', () => {
                // `optionalDependencies`, not `devDependencies`: each package is
                // platform-gated (`os`/`cpu`), and npm refuses the whole install
                // on a foreign host for a required one (EBADPLATFORM). Optional
                // means npm takes the matching one and skips the rest.
                const optional = pkg.optionalDependencies ?? {};
                for (const target of ['darwin-arm64', 'darwin-x64', 'win32-x64']) {
                    const spec = optional[`@gjsify/node-runtime-${target}`];
                    expect(typeof spec).toBe('string');
                    // The checkout-relative `file:` edge is resolved to the
                    // release train on the way into `dist-templates`.
                    expect(/^\^\d+\.\d+\.\d+/.test(spec ?? '')).toBe(true);
                }
            });

            await it('leaves no template sentinel in any path or text file', () => {
                for (const rel of paths) {
                    expect(rel.includes('org.gjsify.example')).toBe(false);
                    expect(rel.includes('new-gjsify-app')).toBe(false);
                }
                for (const rel of paths) {
                    const full = join(projectDir, rel);
                    if (!statSync(full).isFile()) continue;
                    const content = readFileSync(full, 'utf-8');
                    expect(content.includes('new-gjsify-app')).toBe(false);
                }
            });

            await it('ships a typed stylesheet a scaffolded app needs no css.d.ts for', () => {
                // Three files are one feature: the bundler already turns a `.css` import into
                // a string default export, but only `./types` declares that, and only a
                // dependency the scaffold can install reaches it. Drop any one of them and
                // `npm run check` fails in a fresh project with TS2307 on `./style.css`.
                expect(paths).toContain('src/style.css');
                expect(readFileSync(join(projectDir, 'src/style.css'), 'utf-8')).toContain('.demo-status');

                const tsconfig = readFileSync(join(projectDir, 'tsconfig.json'), 'utf-8');
                expect(tsconfig).toContain('"@gjsify/rolldown-plugin-gjsify/types"');

                // `workspace:^` / `file:` are resolved to the release train on the way into
                // `dist-templates` — same rule as the optional runtimes above.
                const spec = pkg.devDependencies?.['@gjsify/rolldown-plugin-gjsify'];
                expect(/^\^\d+\.\d+\.\d+/.test(spec ?? '')).toBe(true);
            });
        } finally {
            process.chdir(cwd);
            rmSync(sandbox, { recursive: true, force: true });
        }
    });
};
