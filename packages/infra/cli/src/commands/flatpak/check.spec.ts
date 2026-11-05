// Unit tests for `gjsify flatpak check`'s appstreamcli argv — the part that decides
// whether validation touches the network; the spawn is `spawnToCompletion`'s.

import { describe, expect, it } from '@gjsify/unit';
import { appstreamValidateArgs } from './check.js';

export default async () => {
    await describe('gjsify flatpak check — appstreamValidateArgs', async () => {
        await it('validates offline by default', () => {
            expect(appstreamValidateArgs('/x/a.metainfo.xml')).toStrictEqual([
                'validate',
                '--strict',
                '--no-net',
                '/x/a.metainfo.xml',
            ]);
        });

        await it('drops --no-net when the network is opted in', () => {
            const args = appstreamValidateArgs('/x/a.metainfo.xml', true);
            expect(args.includes('--no-net')).toBe(false);
            expect(args).toStrictEqual(['validate', '--strict', '/x/a.metainfo.xml']);
        });
    });
};
