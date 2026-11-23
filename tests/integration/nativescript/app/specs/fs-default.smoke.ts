// SPDX-License-Identifier: MIT
// Smoke spec for the `fs` / `fs/promises` aliases (→ @gjsify/native-fs-bridge) on NS V8:
// packages such as nodemailer write `import fs from 'node:fs'`, which needs a default export.
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import { describe, it, expect } from '../reporter.js';

export default async function fsDefaultSmoke(): Promise<void> {
    await describe('node:fs default import (native-fs-bridge)', async () => {
        await it('fs default exposes the file functions', () => {
            expect(typeof fs.readFile).toBe('function');
            expect(typeof fs.openSync).toBe('function');
        });
        await it('fs.promises is the promise surface', () => {
            expect(typeof fs.promises.readFile).toBe('function');
        });
        await it('fs/promises default exposes readFile', () => {
            expect(typeof fsPromises.readFile).toBe('function');
        });
    });
}
