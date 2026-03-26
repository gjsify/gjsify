// Ported from refs/node-test/parallel/test-sqlite.js
// Original: MIT license, Node.js contributors

import { describe, it, expect } from '@gjsify/unit';

export default async () => {
    await describe('sqlite.DatabaseSync', async () => {
        await it('should be importable', async () => {
            const { DatabaseSync } = await import('node:sqlite');
            expect(DatabaseSync).toBeDefined();
        });
    });
};
