// Reads template/package.json, resolves workspace:^ to real versions,
// then copies the resolved output to templates/ (the build artifact directory).
// Run as part of: yarn workspace @gjsify/create-app build

import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(__dirname, '..');
// PROJECT_CWD is set by Yarn automatically to the monorepo root when running workspace scripts
const monoRepoRoot = process.env.PROJECT_CWD ?? join(pkgRoot, '..', '..', '..');

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

function resolveWorkspaceDeps(deps, versionMap) {
    if (!deps) return deps;
    return Object.fromEntries(
        Object.entries(deps).map(([name, spec]) => {
            if (typeof spec === 'string' && spec.startsWith('workspace:')) {
                const version = versionMap.get(name);
                if (!version) {
                    throw new Error(
                        `process-template: workspace package "${name}" not found in monorepo. ` +
                        `Ensure it is registered in root package.json workspaces and "yarn install" has been run.`
                    );
                }
                if (spec === 'workspace:^' || spec === 'workspace:*') {
                    return [name, `^${version}`];
                } else if (spec === 'workspace:~') {
                    return [name, `~${version}`];
                } else {
                    // workspace:^1.2.3 or exact — strip the workspace: prefix
                    return [name, spec.replace(/^workspace:/, '')];
                }
            }
            return [name, spec];
        })
    );
}

const versionMap = buildVersionMap();
const templatePkg = JSON.parse(readFileSync(join(pkgRoot, 'template', 'package.json'), 'utf8'));
templatePkg.dependencies = resolveWorkspaceDeps(templatePkg.dependencies, versionMap);
templatePkg.devDependencies = resolveWorkspaceDeps(templatePkg.devDependencies, versionMap);

mkdirSync(join(pkgRoot, 'templates', 'src'), { recursive: true });
writeFileSync(join(pkgRoot, 'templates', 'package.json'), JSON.stringify(templatePkg, null, 4) + '\n');
console.log('process-template: wrote templates/package.json');

cpSync(join(pkgRoot, 'template', 'tsconfig.json'), join(pkgRoot, 'templates', 'tsconfig.json'));
console.log('process-template: wrote templates/tsconfig.json');

cpSync(join(pkgRoot, 'template', 'src', 'index.ts'), join(pkgRoot, 'templates', 'src', 'index.ts'));
console.log('process-template: wrote templates/src/index.ts');
