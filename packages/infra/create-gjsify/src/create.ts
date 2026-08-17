import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, cpSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { discoverTemplates, findTemplate, type TemplateInfo } from './discover-templates.js';
import {
    INSTALL_ARGV,
    defaultRuntimeFor,
    hostRuntime,
    packageManagersForRuntime,
    runScriptCommand,
    startScriptFor,
    type PackageManager,
} from './runtimes.js';

export { discoverTemplates, findTemplate } from './discover-templates.js';
export type { TemplateInfo } from './discover-templates.js';
export {
    PACKAGE_MANAGERS,
    INSTALL_ARGV,
    RUNTIME_PACKAGE_MANAGERS,
    RUNTIME_DESCRIPTIONS,
    packageManagersForRuntime,
    isKnownRuntime,
    hostRuntime,
    defaultRuntimeFor,
    runScriptCommand,
    startScriptFor,
    type PackageManager,
} from './runtimes.js';
// Re-exported through the package's `.` entry (which is this file, not
// `index.ts`) so `gjsify create` can reach the same decisions the standalone bin
// makes instead of re-deriving them — a second derivation is a second answer.
export { selectRuntime, selectPackageManager, type Selection } from './select.js';

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
    /**
     * Which of the template's declared runtimes the user intends to run on.
     *
     * It changes no scaffolded byte — a template ships every runtime it declares
     * — but it decides which package manager is legal and which of the `start:*`
     * scripts the next steps name. Omitted, it resolves the same way the
     * non-interactive path does: the host runtime when the template supports it.
     */
    runtime?: string;
}

/** Sentinel replaced by the user's project name in every text file under the template. */
const PROJECT_NAME_SENTINEL = 'new-gjsify-app';

/**
 * Sentinel replaced by the scaffolded project's own application id.
 *
 * A GApplication id is a session-bus NAME and the first app to claim it owns it.
 * Every scaffolded project shipped this same literal, so starting a second one
 * while the first ran made GTK treat it as a REMOTE INSTANCE: it forwarded
 * `activate` to the other project's window and exited 0, with no window and no
 * error of its own (measured on `gtk-minimal` + `adw-canvas2d`).
 */
const APPLICATION_ID_SENTINEL = 'org.gjsify.example';

/**
 * The bus name a project scaffolded as `projectName` announces. A D-Bus element
 * holds only `[A-Za-z0-9_-]` and may not begin with a digit where an npm name may
 * hold `.` and begin with one, and `Gtk.Application` refuses to construct with an
 * invalid id — so `npm create @gjsify/app 2048` would fail at startup, the one
 * place only a launched app can see.
 */
export function applicationIdFor(projectName: string): string {
    const element = projectName.replace(/[^A-Za-z0-9_-]/g, '-');
    return `org.gjsify.${/^[0-9]/.test(element) ? `app-${element}` : element}`;
}

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
    const { template, force = false, install = false } = options;

    const info = findTemplate(template);
    if (!info) {
        const available = discoverTemplates()
            .map((t) => t.name)
            .join(', ');
        throw new Error(
            `Unknown template "${template}". Available templates: ${available || '(none — run "yarn build" first)'}`,
        );
    }

    // Resolve the runtime BEFORE the manager: which managers are legal is a
    // function of the runtime, so a caller passing neither must not land on npm
    // for a template that only runs on gjs. A template that declares NOTHING is
    // unconstrained — the reading `@gjsify/cli`'s `readDeclaredRuntimes` gives a
    // null declaration — so it falls through to the host rather than to an
    // arbitrary first entry.
    const offered = supportedRuntimes(info);
    const runtime = options.runtime ?? defaultRuntimeFor(offered, options.packageManager) ?? hostRuntime();
    const managers = packageManagersForRuntime(runtime);
    if (!managers) {
        throw new Error(
            `Template "${info.name}" was asked for runtime "${runtime}", which this version of ` +
                '@gjsify/create-app has no installer mapping for. Upgrade it, or pick one of: ' +
                `${offered.join(', ') || '(none)'}.`,
        );
    }
    const packageManager = options.packageManager ?? managers[0];
    if (!managers.includes(packageManager)) {
        throw new Error(
            `"${packageManager}" cannot install a project you intend to run on ${runtime}. ` +
                `Package managers for ${runtime}: ${managers.join(', ')}.`,
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
    substituteTemplateSentinels(targetDir, projectName);

    if (install) {
        const argv = [...INSTALL_ARGV[packageManager]];
        console.log(`Running ${packageManager} ${argv[0]}...`);
        // `shell: true` is what makes this work on Windows, where `npm` is
        // `npm.cmd`: `CreateProcess` appends only `.exe` when it searches PATH
        // for a bare name, so `spawnSync('npm', …)` is ENOENT there — and
        // `spawnSync` leaves `status` NULL on a spawn error, so the `!== 0`
        // below fired and told the user npm had failed. `npm create gjsify
        // my-app` therefore scaffolded a project, never installed anything, and
        // blamed npm for it. `shell: true` is the exemption the invariant in
        // `@gjsify/cli`'s `utils/spawn.ts` sanctions for exactly this case. It
        // applies to every manager here: npm/yarn/pnpm/gjsify ship as `.cmd`
        // shims on Windows, and bun/deno as `.exe`, which the bare-name search
        // finds — but the shell path is correct for both and costs nothing.
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

    printNextSteps(projectName, info, install, packageManager, runtime);
}

/**
 * Walk the scaffolded tree and replace every template sentinel in every text file.
 * Skips node_modules / dist / lib and non-text files by extension.
 */
function substituteTemplateSentinels(rootDir: string, projectName: string): void {
    const sentinels: Array<[string, string]> = [
        [PROJECT_NAME_SENTINEL, projectName],
        [APPLICATION_ID_SENTINEL, applicationIdFor(projectName)],
    ];
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
            let replaced = content;
            for (const [sentinel, value] of sentinels) replaced = replaced.replaceAll(sentinel, value);
            if (replaced !== content) writeFileSync(full, replaced);
        }
    }
}

function printNextSteps(
    projectName: string,
    template: TemplateInfo,
    installed: boolean,
    packageManager: PackageManager,
    runtime: string,
): void {
    const run = runScriptCommand(packageManager);
    const scripts = templateScripts(template);
    const start = startScriptFor(runtime);

    console.log('');
    console.log(`Project created from template "${template.name}", set up for ${runtime}.`);
    console.log('');
    console.log('Next steps:');
    console.log(`  cd ${projectName}`);
    if (!installed) console.log(`  ${packageManager} install`);
    // `dev` is the gjs one-liner (build the gjs bundle, then launch it); every
    // other runtime consumes the `--app node` bundle, which `dev` does not
    // produce. Printing `dev` for a `--runtime deno` user sent them to a script
    // that rebuilds the wrong target and starts the wrong file.
    if (runtime === 'gjs' && scripts['dev']) {
        console.log(`  ${run} dev`);
    } else {
        console.log(`  ${run} build`);
        console.log(`  ${run} ${start}`);
    }
    console.log('');
    // The OTHER runtimes the template DECLARES, not a fixed list: a GJS-only
    // template must not advertise `start:node`, and a portable one must not hide
    // it. Only those whose launch script the template actually ships are listed —
    // a declaration with no script behind it is not a runnable offer.
    const alternatives = supportedRuntimes(template).filter((rt) => rt !== runtime && scripts[startScriptFor(rt)]);
    if (alternatives.length > 0) {
        console.log(`Also runs on ${alternatives.join(', ')}:`);
        for (const rt of alternatives) console.log(`  ${run} ${startScriptFor(rt)}`);
        console.log('');
    }
}

/** The template manifest, or `{}` when it cannot be read. */
function templateManifest(template: TemplateInfo): {
    scripts?: Record<string, unknown>;
    gjsify?: { example?: { runtimes?: unknown } };
} {
    try {
        return JSON.parse(readFileSync(join(template.path, 'package.json'), 'utf-8'));
    } catch {
        // A template with no readable manifest cannot be scaffolded at all —
        // `createProject` already failed by here. Nothing to advertise.
        return {};
    }
}

/** The template's package scripts, keyed by name. */
function templateScripts(template: TemplateInfo): Record<string, string> {
    const scripts = templateManifest(template).scripts;
    if (!scripts) return {};
    return Object.fromEntries(
        Object.entries(scripts).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
}

/**
 * The runtimes a template can actually be scaffolded for: what it DECLARES in
 * `gjsify.example.runtimes`, minus any name this scaffolder has no installer
 * mapping for.
 *
 * Filtering rather than trusting the declaration wholesale keeps an older
 * scaffolder usable against a newer template: it offers the runtimes it can
 * serve instead of listing one in the picker and then failing on the install.
 */
export function supportedRuntimes(template: TemplateInfo): string[] {
    const declared = templateManifest(template).gjsify?.example?.runtimes;
    if (!Array.isArray(declared)) return [];
    return declared.filter((rt): rt is string => typeof rt === 'string' && packageManagersForRuntime(rt) !== undefined);
}
