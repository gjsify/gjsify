// `gjsify workspace <name> <script> [args..]` — yarn-workspace shortcut.
//
// Equivalent to `yarn workspace <name> run <script>`: locates the named
// workspace in the current monorepo, then runs the script there. Used
// extensively in gjsify's own root `package.json` (17 call sites).

import { spawn } from 'node:child_process';
import type { Command } from '../types/index.js';
import { discoverWorkspaces } from '@gjsify/workspace';
import { findWorkspaceRoot } from '../utils/workspace-root.js';

interface WorkspaceCmdOptions {
    name: string;
    script: string;
    args?: string[];
}

export const workspaceCommand: Command<any, WorkspaceCmdOptions> = {
    command: 'workspace <name> <script> [args..]',
    description: 'Run a workspace script (`yarn workspace <name> run <script>` equivalent).',
    builder: (yargs) =>
        yargs
            .positional('name', {
                description: 'Workspace name (matches package.json `name` field).',
                type: 'string',
                demandOption: true,
            })
            .positional('script', {
                description: 'Script name to run inside that workspace.',
                type: 'string',
                demandOption: true,
            })
            .positional('args', {
                description: 'Extra arguments forwarded to the script.',
                type: 'string',
                array: true,
            }),
    handler: async (args) => {
        // Walk up to the monorepo root — `gjsify workspace` is often
        // invoked from a child workspace's script (e.g. website's
        // `build:deps` calls `gjsify workspace @gjsify/adwaita-web …`),
        // where process.cwd() is the child workspace, not the monorepo root.
        const root = findWorkspaceRoot(process.cwd()) ?? process.cwd();
        const workspaces = discoverWorkspaces(root);
        const target = workspaces.find((w) => w.name === args.name);
        if (!target) {
            console.error(
                `gjsify workspace: no workspace named "${args.name}" — discovered ${workspaces.length} workspace(s)`,
            );
            process.exit(1);
        }
        const scripts = (target.manifest.scripts as Record<string, string> | undefined) ?? {};
        if (typeof scripts[args.script] !== 'string') {
            console.error(`gjsify workspace: workspace "${args.name}" has no script "${args.script}"`);
            process.exit(1);
        }
        const runner = detectPackageManager();
        const argv =
            runner === 'gjsify'
                ? ['run', args.script, ...(args.args ?? [])]
                : ['run', args.script, ...(args.args && args.args.length > 0 ? ['--', ...args.args] : [])];
        // Default FORCE_COLOR=1 unless the user explicitly opted out (matches
        // yarn / npm / gjsify run behaviour) — without this, tools that key
        // on isTTY (chalk, picocolors, biome) drop colors when stdout is a
        // pipe, including GitHub Actions where the log viewer renders ANSI
        // fine.
        const colorEnv =
            process.env.FORCE_COLOR !== undefined || process.env.NO_COLOR !== undefined ? {} : { FORCE_COLOR: '1' };
        await new Promise<void>((resolve, reject) => {
            const child = spawn(runner, argv, {
                cwd: target.location,
                stdio: 'inherit',
                env: { ...process.env, ...colorEnv },
            });
            child.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`${runner} ${argv.join(' ')} exited with code ${code}`));
            });
            child.on('error', reject);
        }).catch((err: Error) => {
            console.error(err.message);
            process.exit(1);
        });
        // ensureMainLoop() (called inside spawn) keeps GJS alive after the
        // child exits — without an explicit process.exit() the success path
        // would park the loop forever.
        process.exit(0);
    },
};

function detectPackageManager(): 'yarn' | 'npm' | 'gjsify' {
    const ua = process.env.npm_config_user_agent ?? '';
    if (ua.startsWith('yarn/')) return 'yarn';
    if (ua.startsWith('gjsify/')) return 'gjsify';
    return 'npm';
}
