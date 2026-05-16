// For each template under <monorepoRoot>/templates/<name>/, resolves
// workspace:^ dependency specifiers to real versions and copies the resolved
// output to dist-templates/<name>/. Run as part of:
//   yarn workspace @gjsify/create-app build

import { readFileSync, writeFileSync, mkdirSync, cpSync, readdirSync, rmSync, statSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(__dirname, '..');
// `PROJECT_CWD` was set by Yarn for workspace scripts; npm doesn't set an
// equivalent. Walk up from the package root to find the monorepo root
// (4 levels: create-gjsify → infra → packages → repo root).
const monoRepoRoot = process.env.PROJECT_CWD ?? join(pkgRoot, '..', '..', '..');
const templatesSrcRoot = join(monoRepoRoot, 'templates');
const distTemplatesRoot = join(pkgRoot, 'dist-templates');

const EXCLUDE_BASENAMES = new Set(['node_modules', 'dist', 'lib']);
const EXCLUDE_EXT = /\.tsbuildinfo$/;

// Inline workspace discovery — walks `pkg.workspaces` globs and reads
// `name` + `version` from each member. We can't depend on
// `@gjsify/workspace` here because this script runs as part of
// `@gjsify/create-app build`, which sits earlier in `build:infra` than
// `@gjsify/workspace build:types` — at this point `workspace/lib/` may
// not exist yet on a fresh checkout.
function buildVersionMap() {
    const map = new Map();
    const rootPkg = JSON.parse(readFileSync(join(monoRepoRoot, 'package.json'), 'utf8'));
    const patterns = Array.isArray(rootPkg.workspaces)
        ? rootPkg.workspaces
        : (rootPkg.workspaces?.packages ?? []);
    for (const pattern of patterns) {
        for (const dir of expandGlob(monoRepoRoot, pattern)) {
            try {
                const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
                if (pkg.name && typeof pkg.version === 'string') {
                    map.set(pkg.name, pkg.version);
                }
            } catch { /* not a workspace */ }
        }
    }
    return map;
}

// Minimal glob expansion: only the trailing-`*` form (`packages/node/*`,
// `examples/dom/*`) and bare paths (`tests/browser`, `website`). Mirrors
// the only two shapes used in this monorepo's `pkg.workspaces`.
function expandGlob(rootDir, pattern) {
    if (!pattern.endsWith('/*')) {
        const dir = join(rootDir, pattern);
        return existsSync(join(dir, 'package.json')) ? [dir] : [];
    }
    const parent = join(rootDir, pattern.slice(0, -2));
    if (!existsSync(parent)) return [];
    return readdirSync(parent, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => join(parent, d.name))
        .filter((dir) => existsSync(join(dir, 'package.json')));
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
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        templatePkg[field] = resolveWorkspaceDeps(templatePkg[field], versionMap, name);
    }
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
