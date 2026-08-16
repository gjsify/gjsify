// `classifyInstall` — the question `self-update` must get right before it writes.
//
// Every case here is a real install layout, not a synthetic string: getting this
// wrong in either direction has a cost. A false `managedElsewhere` bricks
// `self-update` for the users it exists for; a false `xdg-global` writes a second
// copy over a package manager's install, which is the defect it was added for.

import { describe, expect, it } from '@gjsify/unit';
import { classifyInstall } from './install-provenance.js';

const XDG = '/home/dev/.local/share/gjsify/global';

export default async () => {
    await describe('classifyInstall', async () => {
        await it('recognises the layout install.mjs and `install -g` produce', async () => {
            const v = classifyInstall({
                selfDir: `${XDG}/node_modules/@gjsify/cli`,
                xdgPrefix: XDG,
                env: {},
                platform: 'linux',
            });
            expect(v.kind).toBe('xdg-global');
            expect(v.managedElsewhere).toBe(false);
        });

        await it('recognises a Flatpak by its id, wherever the tree is mounted', async () => {
            const v = classifyInstall({
                selfDir: '/somewhere/else/cli',
                xdgPrefix: XDG,
                env: { FLATPAK_ID: 'io.github.gjsify.Cli' },
                platform: 'linux',
            });
            expect(v.kind).toBe('flatpak');
            expect(v.managedElsewhere).toBe(true);
            expect(v.updateWith).toBe('flatpak update io.github.gjsify.Cli');
        });

        await it('recognises a Flatpak by its /app prefix with no id in the env', async () => {
            const v = classifyInstall({
                selfDir: '/app/lib/gjsify',
                xdgPrefix: XDG,
                env: {},
                platform: 'linux',
            });
            expect(v.kind).toBe('flatpak');
        });

        await it('recognises a distro package under a system prefix', async () => {
            for (const dir of ['/usr/lib/gjsify', '/opt/gjsify/lib', '/snap/gjsify/current/lib']) {
                const v = classifyInstall({ selfDir: dir, xdgPrefix: XDG, env: {}, platform: 'linux' });
                expect(v.kind).toBe('system-package');
                expect(v.managedElsewhere).toBe(true);
            }
        });

        await it('does NOT name a specific package manager it cannot know', async () => {
            const v = classifyInstall({ selfDir: '/usr/lib/gjsify', xdgPrefix: XDG, env: {}, platform: 'linux' });
            // One path serves .deb and .rpm alike; guessing sends the user to a
            // package manager that does not know this file.
            expect(v.updateWith?.includes('apt upgrade')).toBe(true);
            expect(v.updateWith?.includes('dnf upgrade')).toBe(true);
            expect(v.updateWith?.includes('releases/latest')).toBe(true);
        });

        await it('recognises an npm-global install', async () => {
            const v = classifyInstall({
                selfDir: '/home/dev/.nvm/versions/node/v24.0.0/lib/node_modules/@gjsify/cli',
                xdgPrefix: XDG,
                env: {},
                platform: 'linux',
            });
            expect(v.kind).toBe('npm-global');
            expect(v.managedElsewhere).toBe(true);
        });

        await it('prefers the system verdict over the node_modules one', async () => {
            // A .deb stages a node_modules-shaped tree under /usr/lib, so the npm
            // test alone would claim it and send the user to `npm install -g`.
            const v = classifyInstall({
                selfDir: '/usr/lib/gjsify/node_modules/@gjsify/cli',
                xdgPrefix: XDG,
                env: {},
                platform: 'linux',
            });
            expect(v.kind).toBe('system-package');
        });

        await it('prefers the XDG verdict for a HOME that lives under a system prefix', async () => {
            // `$HOME=/opt/someuser` is unusual and real. The narrow question is
            // asked first so that user is not told to run `dnf`.
            const prefix = '/opt/someuser/.local/share/gjsify/global';
            const v = classifyInstall({
                selfDir: `${prefix}/node_modules/@gjsify/cli`,
                xdgPrefix: prefix,
                env: {},
                platform: 'linux',
            });
            expect(v.kind).toBe('xdg-global');
            expect(v.managedElsewhere).toBe(false);
        });

        await it('leaves a checkout alone rather than guessing', async () => {
            const v = classifyInstall({
                selfDir: '/home/dev/src/gjsify/packages/infra/cli',
                xdgPrefix: XDG,
                env: {},
                platform: 'linux',
            });
            expect(v.kind).toBe('unknown');
            // Refusing here would break `self-update` for a contributor testing it.
            expect(v.managedElsewhere).toBe(false);
        });

        await it('answers for the TARGET platform, not the host it runs on', async () => {
            // The four cases above are POSIX-shaped. They ran green on Linux and red
            // on the win32 leg of `main`, because the implementation resolved paths
            // with the HOST's `node:path`: `resolve('/app/lib')` is `C:\\app\\lib`
            // there and `sep` is a backslash. Pinned here so a host-path regression
            // fails on every runner rather than only on the one nobody's PR runs.
            const v = classifyInstall({
                selfDir: '/usr/lib/gjsify',
                xdgPrefix: XDG,
                env: {},
                platform: 'linux',
            });
            expect(v.kind).toBe('system-package');
        });

        await it('reads a Windows layout with Windows separators', async () => {
            const prefix = 'C:\\Users\\dev\\AppData\\Local\\gjsify\\global';
            const v = classifyInstall({
                selfDir: `${prefix}\\node_modules\\@gjsify\\cli`,
                xdgPrefix: prefix,
                env: {},
                platform: 'win32',
            });
            expect(v.kind).toBe('xdg-global');
            expect(v.managedElsewhere).toBe(false);
        });

        await it('does not read a system prefix on win32, where those paths mean nothing', async () => {
            const v = classifyInstall({
                selfDir: 'C:\\\\Users\\\\dev\\\\AppData\\\\gjsify',
                xdgPrefix: XDG,
                env: {},
                platform: 'win32',
            });
            expect(v.kind).toBe('unknown');
        });
    });
};
