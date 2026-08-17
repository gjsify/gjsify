// Unit coverage for the two decisions `gjsify create` makes before it writes
// anything: which runtime, and which package manager.
//
// The non-TTY half is what this file is for — reachable before only by spawning
// the binary without a terminal, so the rules that apply only there had no
// coverage at all.

import { describe, expect, it } from '@gjsify/unit';
import { selectPackageManager, selectRuntime } from './select.js';
import { hostRuntime } from './runtimes.js';

const ALL = ['gjs', 'node', 'bun', 'deno'];

export default async () => {
    await describe('create-app: selectRuntime', async () => {
        await it('takes --runtime when the template declares it', () => {
            const s = selectRuntime({ flag: 'deno', offered: ALL, interactive: false });
            expect(s.kind).toBe('value');
            expect(s.kind === 'value' && s.value).toBe('deno');
        });

        await it('refuses --runtime the template does not declare', () => {
            const s = selectRuntime({ flag: 'deno', offered: ['gjs'], interactive: true });
            expect(s.kind).toBe('error');
            expect(s.kind === 'error' && s.message).toContain('does not run on "deno"');
        });

        await it('does not ask when the template declares one runtime', () => {
            const s = selectRuntime({ offered: ['gjs'], interactive: true });
            expect(s.kind).toBe('value');
            expect(s.kind === 'value' && s.value).toBe('gjs');
        });

        await it('prompts on a TTY, opening on the host runtime', () => {
            const s = selectRuntime({ offered: ALL, interactive: true });
            expect(s.kind).toBe('prompt');
            expect(s.kind === 'prompt' && s.initial).toBe(hostRuntime());
            expect(s.kind === 'prompt' && [...s.choices]).toStrictEqual(ALL);
        });

        await it('defaults with a notice off a TTY — never silently', () => {
            const s = selectRuntime({ offered: ALL, interactive: false });
            expect(s.kind).toBe('auto');
            expect(s.kind === 'auto' && s.value).toBe(hostRuntime());
            expect(s.kind === 'auto' && s.notice).toContain('--runtime not given');
        });

        await it('lets --package-manager answer the runtime question', () => {
            // Without this, `-p bun` resolved the runtime to the host and then
            // refused bun there — a combination the user had spelled out.
            for (const [manager, runtime] of [
                ['bun', 'bun'],
                ['deno', 'deno'],
                ['npm', 'node'],
                ['gjsify', 'gjs'],
            ] as const) {
                const s = selectRuntime({ offered: ALL, manager, interactive: true });
                expect(s.kind).toBe('auto');
                expect(s.kind === 'auto' && s.value).toBe(runtime);
            }
        });

        await it('refuses a manager no declared runtime installs with', () => {
            const s = selectRuntime({ offered: ['gjs', 'bun'], manager: 'npm', interactive: true });
            expect(s.kind).toBe('error');
            expect(s.kind === 'error' && s.message).toContain('installs with "npm"');
        });
    });

    await describe('create-app: selectPackageManager', async () => {
        await it('takes --package-manager the runtime can use', () => {
            const s = selectPackageManager({ flag: 'pnpm', runtime: 'node', install: true, interactive: false });
            expect(s.kind).toBe('value');
            expect(s.kind === 'value' && s.value).toBe('pnpm');
        });

        await it('refuses a manager that cannot install for the runtime', () => {
            const s = selectPackageManager({ flag: 'npm', runtime: 'deno', install: false, interactive: true });
            expect(s.kind).toBe('error');
            expect(s.kind === 'error' && s.message).toContain('run on deno');
        });

        await it('does not prompt when the runtime offers exactly one', () => {
            for (const [runtime, manager] of [
                ['gjs', 'gjsify'],
                ['bun', 'bun'],
                ['deno', 'deno'],
            ] as const) {
                const s = selectPackageManager({ runtime, install: true, interactive: true });
                expect(s.kind).toBe('auto');
                expect(s.kind === 'auto' && s.value).toBe(manager);
                expect(s.kind === 'auto' && s.notice).toContain('the only package manager');
            }
        });

        await it('prompts on a TTY when node offers four', () => {
            const s = selectPackageManager({ runtime: 'node', install: true, interactive: true });
            expect(s.kind).toBe('prompt');
            expect(s.kind === 'prompt' && [...s.choices]).toStrictEqual(['npm', 'yarn', 'pnpm', 'gjsify']);
        });

        await it('requires the flag off a TTY when --install would run one', () => {
            const s = selectPackageManager({ runtime: 'node', install: true, interactive: false });
            expect(s.kind).toBe('error');
            expect(s.kind === 'error' && s.message).toContain('--package-manager is required with --install');
        });

        await it('defaults with a notice off a TTY when nothing is installed', () => {
            const s = selectPackageManager({ runtime: 'node', install: false, interactive: false });
            expect(s.kind).toBe('auto');
            expect(s.kind === 'auto' && s.value).toBe('npm');
        });

        await it('refuses a runtime it has no managers for', () => {
            const s = selectPackageManager({ runtime: 'python', install: false, interactive: true });
            expect(s.kind).toBe('error');
            expect(s.kind === 'error' && s.message).toContain('no package manager known');
        });
    });
};
