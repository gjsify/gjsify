// @gjsify/adwaita-app — installDockReopen tests (ADR 0141).
// Runs on GJS + Node: the bridge is a stub `imports.gi`, the OS an argument.

import { describe, expect, it } from '@gjsify/unit';
import type { GiImportsView } from '@gjsify/utils/core';
import { installDockReopen, nodeHostGi } from './dock-reopen.js';

function stubGi(install: () => boolean): { gi: GiImportsView; calls: () => number } {
    let calls = 0;
    const gi = {
        GjsifyQuartz: {
            install_reopen_handler: () => {
                calls++;
                return install();
            },
        },
    } as unknown as GiImportsView;
    return { gi, calls: () => calls };
}

export default async () => {
    await describe('installDockReopen', async () => {
        await it('calls the bridge on darwin and reports its answer', () => {
            const { gi, calls } = stubGi(() => true);
            expect(installDockReopen('darwin', gi)).toBe(true);
            expect(calls()).toBe(1);
        });

        await it('reports false when GTK already has the handler (bridge retired)', () => {
            expect(installDockReopen('darwin', stubGi(() => false).gi)).toBe(false);
        });

        await it('never touches the bridge off darwin', () => {
            const { gi, calls } = stubGi(() => true);
            expect(installDockReopen('linux', gi)).toBe(false);
            expect(installDockReopen('win32', gi)).toBe(false);
            expect(calls()).toBe(0);
        });

        await it('is a no-op when the bridge is not installed', () => {
            expect(installDockReopen('darwin', {} as unknown as GiImportsView)).toBe(false);
        });

        await it('swallows a throwing bridge', () => {
            const { gi } = stubGi(() => {
                throw new Error('boom');
            });
            expect(installDockReopen('darwin', gi)).toBe(false);
        });
    });

    await describe('nodeHostGi', async () => {
        await it('builds an imports.gi view holding the requested namespace', () => {
            const asked: string[][] = [];
            const view = nodeHostGi((id) => {
                expect(id).toBe('@gjsify/node-gi/gi');
                return {
                    requireGi: (ns: string, version?: string) => {
                        asked.push([ns, String(version)]);
                        return { install_reopen_handler: () => true };
                    },
                };
            });
            expect(asked).toStrictEqual([['GjsifyQuartz', '1.0']]);
            expect(installDockReopen('darwin', view)).toBe(true);
        });

        await it('is undefined when node-gi cannot be loaded', () => {
            expect(
                nodeHostGi(() => {
                    throw new Error('Cannot find module');
                }),
            ).toBe(undefined);
        });

        await it('is undefined when the typelib is absent', () => {
            const view = nodeHostGi(() => ({
                requireGi: () => {
                    throw new Error('Typelib not found');
                },
            }));
            expect(view).toBe(undefined);
        });

        await it('is undefined when node-gi has no requireGi', () => {
            expect(nodeHostGi(() => ({}))).toBe(undefined);
        });
    });
};
