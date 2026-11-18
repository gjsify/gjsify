import { describe, expect, it } from '@gjsify/unit';

import { launchArgv } from './launch-argv.js';

export default async () => {
    await describe('launchArgv', async () => {
        await it('forwards the program name and the process arguments by default', async () => {
            expect(launchArgv(undefined, 'tool', ['gui', '--x'])).toStrictEqual(['tool', 'gui', '--x']);
        });

        await it('takes an explicit argv verbatim, so a subcommand never reaches GApplication', async () => {
            expect(launchArgv(['tool'], 'tool', ['gui'])).toStrictEqual(['tool']);
        });

        await it('keeps an explicit empty argv instead of falling back', async () => {
            expect(launchArgv([], 'tool', ['gui'])).toStrictEqual([]);
        });
    });
};
