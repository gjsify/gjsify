import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, cpSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { discoverTemplates, findTemplate, type TemplateInfo } from './discover-templates.js';

export { discoverTemplates, findTemplate } from './discover-templates.js';
export type { TemplateInfo } from './discover-templates.js';

export interface CreateProjectOptions {
    projectName: string;
    /** Template short name, e.g. "gtk-minimal". If omitted, the caller is responsible for providing one via prompt. */
    template: string;
    /** Allow scaffolding into an existing non-empty directory. */
    force?: boolean;
    /** Run `npm install` in the scaffolded directory after writing files. */
    install?: boolean;
}

/** Sentinel replaced by the user's project name in every text file under the template. */
const PROJECT_NAME_SENTINEL = 'new-gjsify-app';

/** File extensions we treat as text and scan for the sentinel. */
const TEXT_FILE_EXT = new Set([
    '.json', '.md', '.ts', '.tsx', '.js', '.mjs', '.cjs',
    '.blp', '.html', '.css', '.scss', '.xml', '.ui', '.txt',
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
        const available = discoverTemplates().map((t) => t.name).join(', ');
        throw new Error(
            `Unknown template "${template}". Available templates: ${available || '(none — run "yarn build" first)'}`,
        );
    }

    const targetDir = resolve(process.cwd(), projectName);
    if (existsSync(targetDir) && !isDirEmpty(targetDir) && !force) {
        console.error(
            `Error: Directory "${projectName}" exists and is not empty. Use --force to scaffold into it anyway.`,
        );
        process.exit(1);
    }

    console.log(`Creating new Gjsify project in ${targetDir} (template: ${info.name})...`);

    mkdirSync(targetDir, { recursive: true });
    cpSync(info.path, targetDir, { recursive: true });
    substituteProjectName(targetDir, projectName);

    if (install) {
        console.log('Running npm install...');
        const result = spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
            cwd: targetDir,
            stdio: 'inherit',
        });
        if (result.status !== 0) {
            console.warn('npm install failed; re-run it manually in the project directory.');
        }
    }

    printNextSteps(projectName, info, install);
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

function printNextSteps(projectName: string, template: TemplateInfo, installed: boolean): void {
    console.log('');
    console.log(`Project created from template "${template.name}".`);
    console.log('');
    console.log('Next steps:');
    console.log(`  cd ${projectName}`);
    if (!installed) console.log('  npm install');
    console.log('  npm run dev');
    console.log('');
}
