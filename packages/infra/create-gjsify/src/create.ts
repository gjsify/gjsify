import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, cpSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { discoverTemplates, findTemplate, type TemplateInfo } from './discover-templates.js';

export { discoverTemplates, findTemplate } from './discover-templates.js';
export type { TemplateInfo } from './discover-templates.js';

/**
 * Package managers a scaffolded project can be installed with. All four work:
 * the templates declare every dependency they need explicitly — including
 * `@gjsify/rolldown-native`, which npm/yarn/pnpm would otherwise skip as an
 * optional peer of `@gjsify/cli`.
 *
 * `gjsify` is gjsify's own installer and the only one of the four that works on
 * a host with no Node.js at all.
 */
export const PACKAGE_MANAGERS = ['npm', 'yarn', 'pnpm', 'gjsify'] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

/** The `install` argv for each package manager. */
const INSTALL_ARGV: Record<PackageManager, string[]> = {
    npm: ['install', '--no-audit', '--no-fund'],
    yarn: ['install'],
    pnpm: ['install'],
    gjsify: ['install'],
};

export interface CreateProjectOptions {
    projectName: string;
    /** Template short name, e.g. "gtk-minimal". If omitted, the caller is responsible for providing one via prompt. */
    template: string;
    /** Allow scaffolding into an existing non-empty directory. */
    force?: boolean;
    /** Install dependencies in the scaffolded directory after writing files. */
    install?: boolean;
    /** Which package manager to install with, and to name in the printed next steps. */
    packageManager?: PackageManager;
}

/** Sentinel replaced by the user's project name in every text file under the template. */
const PROJECT_NAME_SENTINEL = 'new-gjsify-app';

/** File extensions we treat as text and scan for the sentinel. */
const TEXT_FILE_EXT = new Set([
    '.json',
    '.md',
    '.ts',
    '.tsx',
    '.js',
    '.mjs',
    '.cjs',
    '.blp',
    '.html',
    '.css',
    '.scss',
    '.xml',
    '.ui',
    '.txt',
]);

/** npm package names: lowercase, digits, -, _, .; no leading . or _. */
export function sanitizeProjectName(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) throw new Error('Project name cannot be empty.');
    const cleaned = trimmed
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^[._-]+/, '')
        .replace(/[._-]+$/, '');
    if (!cleaned) throw new Error(`"${raw}" is not a valid npm package name.`);
    return cleaned;
}

function isDirEmpty(path: string): boolean {
    if (!existsSync(path)) return true;
    return readdirSync(path).length === 0;
}

export async function createProject(options: CreateProjectOptions): Promise<void> {
    const projectName = sanitizeProjectName(options.projectName);
    const { template, force = false, install = false, packageManager = 'npm' } = options;

    const info = findTemplate(template);
    if (!info) {
        const available = discoverTemplates()
            .map((t) => t.name)
            .join(', ');
        throw new Error(
            `Unknown template "${template}". Available templates: ${available || '(none — run "yarn build" first)'}`,
        );
    }

    const targetDir = resolve(process.cwd(), projectName);
    if (existsSync(targetDir) && !isDirEmpty(targetDir) && !force) {
        console.error(
            `Error: Directory "${projectName}" exists and is not empty. Use --force to scaffold into it anyway.`,
        );
        // `return` — a bare `process.exit()` is deferred under GJS (no atexit),
        // so execution fell through and scaffolded into the non-empty
        // directory the message just refused.
        return process.exit(1);
    }

    console.log(`Creating new Gjsify project in ${targetDir} (template: ${info.name})...`);

    mkdirSync(targetDir, { recursive: true });
    cpSync(info.path, targetDir, { recursive: true });
    substituteProjectName(targetDir, projectName);

    if (install) {
        const argv = INSTALL_ARGV[packageManager];
        console.log(`Running ${packageManager} ${argv[0]}...`);
        // `shell: true` is what makes this work on Windows, where `npm` is
        // `npm.cmd`: `CreateProcess` appends only `.exe` when it searches PATH
        // for a bare name, so `spawnSync('npm', …)` is ENOENT there — and
        // `spawnSync` leaves `status` NULL on a spawn error, so the `!== 0`
        // below fired and told the user npm had failed. `npm create gjsify
        // my-app` therefore scaffolded a project, never installed anything, and
        // blamed npm for it. `shell: true` is the exemption the invariant in
        // `@gjsify/cli`'s `utils/spawn.ts` sanctions for exactly this case. It
        // applies to all four managers, which all ship as `.cmd` shims there.
        const result = spawnSync(packageManager, argv, {
            cwd: targetDir,
            stdio: 'inherit',
            shell: true,
        });
        // Report the spawn error itself when there is one. Without it a failure
        // to START the package manager and a failure OF it read identically,
        // which is how the Windows case stayed invisible.
        if (result.error) {
            console.warn(`${packageManager} install could not start (${result.error.message}); re-run it manually.`);
        } else if (result.status !== 0) {
            console.warn(`${packageManager} install failed; re-run it manually in the project directory.`);
        }
    }

    printNextSteps(projectName, info, install, packageManager);
}

/**
 * Walk the scaffolded tree and replace the sentinel in every text file.
 * Skips node_modules / dist / lib and non-text files by extension.
 */
function substituteProjectName(rootDir: string, projectName: string): void {
    const skipDirs = new Set(['node_modules', 'dist', 'lib']);
    const stack: string[] = [rootDir];
    while (stack.length > 0) {
        const dir = stack.pop() as string;
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!skipDirs.has(entry.name)) stack.push(full);
                continue;
            }
            if (!entry.isFile()) continue;
            const dot = entry.name.lastIndexOf('.');
            const ext = dot >= 0 ? entry.name.slice(dot) : '';
            if (!TEXT_FILE_EXT.has(ext)) continue;
            const content = readFileSync(full, 'utf-8');
            if (!content.includes(PROJECT_NAME_SENTINEL)) continue;
            writeFileSync(full, content.replaceAll(PROJECT_NAME_SENTINEL, projectName));
        }
    }
}

function printNextSteps(
    projectName: string,
    template: TemplateInfo,
    installed: boolean,
    packageManager: PackageManager,
): void {
    // `npm run <script>` / `yarn <script>` / `pnpm <script>` / `gjsify run
    // <script>` — the same script, four spellings. Printing the one that
    // matches the manager the user actually chose is the whole point of
    // threading it this far.
    const run = packageManager === 'npm' ? 'npm run' : packageManager === 'gjsify' ? 'gjsify run' : packageManager;

    console.log('');
    console.log(`Project created from template "${template.name}".`);
    console.log('');
    console.log('Next steps:');
    console.log(`  cd ${projectName}`);
    if (!installed) console.log(`  ${packageManager} install`);
    console.log(`  ${run} dev`);
    console.log('');
    // The runtimes the template DECLARES, not a fixed list: a GJS-only template
    // must not advertise `start:node`, and a portable one must not hide it.
    const runtimes = declaredRuntimes(template);
    if (runtimes.length > 1) {
        console.log(`Runs on ${runtimes.join(', ')}:`);
        console.log(`  ${run} build`);
        for (const runtime of runtimes) {
            console.log(`  ${run} ${runtime === 'gjs' ? 'start' : `start:${runtime}`}`);
        }
        console.log('');
    }
}

/** `gjsify.example.runtimes` from the template's manifest; `[]` when unstated. */
function declaredRuntimes(template: TemplateInfo): string[] {
    try {
        const pkg = JSON.parse(readFileSync(join(template.path, 'package.json'), 'utf-8')) as {
            gjsify?: { example?: { runtimes?: unknown } };
        };
        const runtimes = pkg.gjsify?.example?.runtimes;
        return Array.isArray(runtimes) ? runtimes.filter((r): r is string => typeof r === 'string') : [];
    } catch {
        // A template with no readable manifest cannot be scaffolded at all —
        // `createProject` already failed by here. Nothing to advertise.
        return [];
    }
}
