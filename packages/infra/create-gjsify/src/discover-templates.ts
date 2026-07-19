import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface TemplateInfo {
    /** Short name, e.g. "gtk-minimal" */
    name: string;
    /** One-line description (from template package.json `description` or a built-in fallback) */
    description: string;
    /** Absolute path to the template directory inside dist-templates/ */
    path: string;
}

/**
 * Locate the shipped `dist-templates/` directory across the three shapes this
 * module runs in:
 *
 *   1. **`lib/` layout** (Node/Bun/Deno via `@gjsify/create-app/lib`): the
 *      templates sit next to the package as `../dist-templates` relative to
 *      this file. This is the common case.
 *   2. **Bundled into the CLI** (`gjsify create` under the committed
 *      `dist/cli.gjs.mjs` GJS bundle, or a `--app node` CLI bundle): here
 *      `import.meta.url` points at the CLI bundle, NOT this package, so the
 *      `../dist-templates` sibling does not exist. Resolve the real
 *      `@gjsify/create-app` package via `createRequire` (works under GJS via
 *      `@gjsify/module`'s node_modules walker, the same anchor `showcase`
 *      uses) and read its `dist-templates`.
 *   3. **Co-located with a standalone bundle**: a self-contained install may
 *      ship `dist-templates/` next to the bundle — probe `<dir>/dist-templates`.
 *
 * Returns the first existing candidate, or `undefined` when none is found.
 */
function resolveTemplatesRoot(): string | undefined {
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates: string[] = [
        // 1. lib/ layout — templates are a sibling of lib/.
        join(here, '..', 'dist-templates'),
        // 3. co-located next to a standalone bundle.
        join(here, 'dist-templates'),
    ];

    // 2. Bundled: resolve the create-app package itself and read its templates.
    try {
        const require = createRequire(import.meta.url);
        const pkgJson = require.resolve('@gjsify/create-app/package.json');
        candidates.splice(1, 0, join(dirname(pkgJson), 'dist-templates'));
    } catch {
        // Not resolvable as a package (e.g. fully self-contained install with
        // no node_modules) — the co-located candidate above still applies.
    }

    return candidates.find((c) => existsSync(c));
}

const FALLBACK_DESCRIPTIONS: Record<string, string> = {
    'gtk-minimal': 'Minimal GTK4 app — Gtk.Window + Gtk.Label (no Adwaita, no Blueprint).',
    cli: 'Command-line tool using yargs (Node.js + GJS).',
    'adw-canvas2d': 'Adwaita app with HTML Canvas 2D rendering (Blueprint UI).',
    'adw-webgl': 'Adwaita app with WebGL + three.js (Blueprint UI).',
    'adw-game': 'Adwaita game shell using Excalibur.js, WebGL → Canvas2D fallback.',
    'web-server-hono': 'HTTP server using Hono (Web-standard fetch-style API).',
    'web-server-express': 'HTTP server using Express (familiar Node.js stack).',
};

/**
 * Discover all shipped templates by scanning dist-templates/ next to this file.
 * Returns templates sorted alphabetically by name.
 */
export function discoverTemplates(): TemplateInfo[] {
    const templatesRoot = resolveTemplatesRoot();
    if (!templatesRoot) return [];

    const templates: TemplateInfo[] = [];
    for (const name of readdirSync(templatesRoot)) {
        const path = join(templatesRoot, name);
        const pkgJsonPath = join(path, 'package.json');
        if (!statSync(path).isDirectory() || !existsSync(pkgJsonPath)) continue;

        let description = FALLBACK_DESCRIPTIONS[name] ?? '';
        try {
            const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as Record<string, unknown>;
            if (typeof pkg.description === 'string' && pkg.description.trim()) {
                description = pkg.description;
            }
        } catch {
            // Fall back to built-in description
        }

        templates.push({ name, description, path });
    }

    templates.sort((a, b) => a.name.localeCompare(b.name));
    return templates;
}

export function findTemplate(name: string): TemplateInfo | undefined {
    return discoverTemplates().find((t) => t.name === name);
}
