// SPDX-License-Identifier: MIT
// Bare `gettext` on `--app nativescript` must reach the GLib gettext (libintl reader),
// not an unresolved GJS built-in: shared UI code imports it the same way on GNOME.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from '@gjsify/unit';
import { ALIASES_GJS_FOR_NODE } from '@gjsify/rolldown-plugin-gjsify';
import { ALIASES_NODE_FOR_NATIVESCRIPT } from '@gjsify/resolve-npm';

// The bridge is not a dependency of the CLI, so read its source instead of importing it.
function bridgeDir(name: string): string | undefined {
    for (let dir = process.cwd(); ; dir = dirname(dir)) {
        const root = join(dir, 'packages/nativescript-bridge');
        if (existsSync(root)) {
            return readdirSync(root)
                .map((d) => join(root, d))
                .find((d) => {
                    const pkg = join(d, 'package.json');
                    return existsSync(pkg) && JSON.parse(readFileSync(pkg, 'utf8')).name === name;
                });
        }
        if (dirname(dir) === dir) return undefined;
    }
}

export default async () => {
    await describe('--app nativescript: bare gettext alias', async () => {
        await it('routes gettext to @gjsify/node-gi/gettext', async () => {
            expect(ALIASES_NODE_FOR_NATIVESCRIPT['gettext']).toBe('@gjsify/node-gi/gettext');
        });
        await it('uses the same target as the node reverse bridge', async () => {
            expect(ALIASES_NODE_FOR_NATIVESCRIPT['gettext']).toBe(ALIASES_GJS_FOR_NODE['gettext']);
        });
    });

    // `import fs from 'node:fs'` is everywhere in real packages; a bridge aliased to a Node
    // built-in with only named exports fails the consumer's build with MISSING_EXPORT "default".
    await describe('--app nativescript: native bridges aliased to a node: builtin', async () => {
        const bridges = [
            ...new Set(
                Object.values(ALIASES_NODE_FOR_NATIVESCRIPT).filter((v) => /^@gjsify\/native-[a-z-]+-bridge$/.test(v)),
            ),
        ];
        await it('finds at least the fs bridge', async () => {
            expect(bridges.includes('@gjsify/native-fs-bridge')).toBe(true);
        });
        for (const name of bridges) {
            await it(`${name} has a default export`, async () => {
                const dir = bridgeDir(name);
                expect(dir !== undefined).toBe(true);
                const src = readFileSync(join(dir as string, 'src/index.ts'), 'utf8');
                expect(/^export default\b/m.test(src)).toBe(true);
            });
        }
    });
};
