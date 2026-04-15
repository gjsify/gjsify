// For each template under <monorepoRoot>/templates/<name>/, resolves
// workspace:^ dependency specifiers to real versions and copies the resolved
// output to dist-templates/<name>/. Run as part of:
//   yarn workspace @gjsify/create-app build

import { readFileSync, writeFileSync, mkdirSync, cpSync, readdirSync, rmSync, statSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(__dirname, '..');
// PROJECT_CWD is set by Yarn when running workspace scripts
const monoRepoRoot = process.env.PROJECT_CWD ?? join(pkgRoot, '..', '..', '..');
const templatesSrcRoot = join(monoRepoRoot, 'templates');
const distTemplatesRoot = join(pkgRoot, 'dist-templates');

const EXCLUDE_BASENAMES = new Set(['node_modules', 'dist', 'lib']);
const EXCLUDE_EXT = /\.tsbuildinfo$/;

function buildVersionMap() {
    const output = execFileSync('yarn', ['workspaces', 'list', '--json'], {
        cwd: monoRepoRoot,
        encoding: 'utf8',
    });
    const map = new Map();
    for (const line of output.trim().split('\n')) {
        let entry;
        try {
            entry = JSON.parse(line);
        } catch {
            continue;
        }
        const { name, location } = entry;
        if (!name || !location) continue;
        try {
            const pkg = JSON.parse(readFileSync(join(monoRepoRoot, location, 'package.json'), 'utf8'));
            if (pkg.version) map.set(name, pkg.version);
        } catch {
            // workspace package.json unreadable — skip
        }
    }
    return map;
}

function resolveWorkspaceDeps(deps, versionMap, templateName) {
    if (!deps) return deps;
    return Object.fromEntries(
        Object.entries(deps).map(([name, spec]) => {
            if (typeof spec === 'string' && spec.startsWith('workspace:')) {
                const version = versionMap.get(name);
                if (!version) {
                    throw new Error(
                        `process-template: workspace package "${name}" referenced by template "${templateName}" not found in monorepo. ` +
                        `Ensure it is registered in root package.json workspaces and "yarn install" has been run.`,
                    );
                }
                if (spec === 'workspace:^' || spec === 'workspace:*') {
                    return [name, `^${version}`];
                } else if (spec === 'workspace:~') {
                    return [name, `~${version}`];
                } else {
                    return [name, spec.replace(/^workspace:/, '')];
                }
            }
            return [name, spec];
        }),
    );
}

function copyFilter(src) {
    const name = basename(src);
    if (EXCLUDE_BASENAMES.has(name)) return false;
    if (EXCLUDE_EXT.test(name)) return false;
    return true;
}

function processTemplate(name, versionMap) {
    const srcDir = join(templatesSrcRoot, name);
    const destDir = join(distTemplatesRoot, name);

    // Wipe destination
    if (existsSync(destDir)) rmSync(destDir, { recursive: true, force: true });
    mkdirSync(destDir, { recursive: true });

    // Copy everything except excluded files
    for (const entry of readdirSync(srcDir)) {
        if (entry === 'package.json') continue; // handled separately
        const entrySrc = join(srcDir, entry);
        const entryDest = join(destDir, entry);
        const st = statSync(entrySrc);
        if (st.isDirectory()) {
            cpSync(entrySrc, entryDest, { recursive: true, filter: copyFilter });
        } else if (copyFilter(entrySrc)) {
            cpSync(entrySrc, entryDest);
        }
    }

    // Resolve and write package.json
    const pkgPath = join(srcDir, 'package.json');
    if (!existsSync(pkgPath)) {
        throw new Error(`process-template: template "${name}" is missing package.json`);
    }
    const templatePkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    // Overwrite the workspace name with the sentinel; createProject() replaces it with the user's project name.
    templatePkg.name = 'new-gjsify-app';
    templatePkg.dependencies = resolveWorkspaceDeps(templatePkg.dependencies, versionMap, name);
    templatePkg.devDependencies = resolveWorkspaceDeps(templatePkg.devDependencies, versionMap, name);
    writeFileSync(join(destDir, 'package.json'), JSON.stringify(templatePkg, null, 4) + '\n');

    console.log(`process-template: wrote dist-templates/${name}/`);
}

if (!existsSync(templatesSrcRoot)) {
    throw new Error(`process-template: templates directory not found at ${templatesSrcRoot}`);
}

// Reset output
if (existsSync(distTemplatesRoot)) rmSync(distTemplatesRoot, { recursive: true, force: true });
mkdirSync(distTemplatesRoot, { recursive: true });

const versionMap = buildVersionMap();
const templates = readdirSync(templatesSrcRoot).filter((n) => {
    const p = join(templatesSrcRoot, n);
    return statSync(p).isDirectory() && existsSync(join(p, 'package.json'));
});

if (templates.length === 0) {
    throw new Error(`process-template: no templates found in ${templatesSrcRoot}`);
}

for (const name of templates) processTemplate(name, versionMap);
console.log(`process-template: processed ${templates.length} template(s)`);
