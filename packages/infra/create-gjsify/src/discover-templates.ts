import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
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

const FALLBACK_DESCRIPTIONS: Record<string, string> = {
    'gtk-minimal':        'Minimal GTK4 app — Gtk.Window + Gtk.Label (no Adwaita, no Blueprint).',
    'cli':                'Command-line tool using yargs (Node.js + GJS).',
    'adw-canvas2d':       'Adwaita app with HTML Canvas 2D rendering (Blueprint UI).',
    'adw-webgl':          'Adwaita app with WebGL + three.js (Blueprint UI).',
    'adw-game':           'Adwaita game shell using Excalibur.js, WebGL → Canvas2D fallback.',
    'web-server-hono':    'HTTP server using Hono (Web-standard fetch-style API).',
    'web-server-express': 'HTTP server using Express (familiar Node.js stack).',
};

/**
 * Discover all shipped templates by scanning dist-templates/ next to this file.
 * Returns templates sorted alphabetically by name.
 */
export function discoverTemplates(): TemplateInfo[] {
    const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
    const templatesRoot = join(pkgRoot, 'dist-templates');

    if (!existsSync(templatesRoot)) return [];

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
