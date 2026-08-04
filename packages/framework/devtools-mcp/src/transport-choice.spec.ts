// @gjsify/devtools-mcp — bridge-side transport precedence tests.
// Cross-platform (pure logic): runs identically on Node and GJS.

import { describe, expect, it } from '@gjsify/unit';
import { chooseClientTransport } from './transport-choice.js';

export default async () => {
    await describe('chooseClientTransport', async () => {
        await it('prefers an explicit option address over everything', async () => {
            expect(
                chooseClientTransport({
                    optionAddress: 'unix:path=/tmp/a.sock',
                    envAddress: 'unix:path=/tmp/b.sock',
                    addressFileValue: 'unix:path=/tmp/c.sock',
                    sessionBusAvailable: true,
                }),
            ).toStrictEqual({ kind: 'peer', address: 'unix:path=/tmp/a.sock', source: 'option' });
        });

        await it('then the env var', async () => {
            expect(
                chooseClientTransport({
                    envAddress: 'unix:path=/tmp/b.sock',
                    addressFileValue: 'unix:path=/tmp/c.sock',
                    sessionBusAvailable: true,
                }),
            ).toStrictEqual({ kind: 'peer', address: 'unix:path=/tmp/b.sock', source: 'env' });
        });

        await it('then a published address file — even when a session bus exists', async () => {
            // The file is positive evidence that an app of this id is listening
            // on a peer socket right now; "a session bus exists" says nothing
            // about the app, and dialling it would report the app as absent.
            expect(
                chooseClientTransport({
                    addressFileValue: 'unix:path=/tmp/c.sock',
                    sessionBusAvailable: true,
                }),
            ).toStrictEqual({ kind: 'peer', address: 'unix:path=/tmp/c.sock', source: 'address-file' });
        });

        await it('falls back to the session bus with nothing published (Linux unchanged)', async () => {
            expect(chooseClientTransport({ sessionBusAvailable: true })).toStrictEqual({ kind: 'session-bus' });
        });

        await it('reports unavailable when there is no bus and nothing published', async () => {
            expect(chooseClientTransport({ sessionBusAvailable: false })).toStrictEqual({ kind: 'unavailable' });
        });

        await it('ignores empty strings rather than dialling ""', async () => {
            expect(
                chooseClientTransport({ optionAddress: '', envAddress: '', sessionBusAvailable: true }),
            ).toStrictEqual({ kind: 'session-bus' });
        });
    });
};
