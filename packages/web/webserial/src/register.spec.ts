import { describe, expect, it } from '@gjsify/unit';

import { Serial } from './serial.js';
import { SerialPort } from './serial-port.js';

// Loaded dynamically: the package pins `sideEffects` to lib/esm/register.js, so a bare
// `import './register.js'` of the source file is tree-shaken out of the test bundle.
export default async () => {
    await import('./register.js');

    await describe('@gjsify/webserial/register', async () => {
        await it('installs navigator.serial', async () => {
            expect((globalThis.navigator as unknown as { serial?: unknown }).serial instanceof Serial).toBe(true);
        });

        await it('installs the Serial and SerialPort constructors', async () => {
            const g = globalThis as unknown as { Serial?: unknown; SerialPort?: unknown };
            expect(g.Serial).toBe(Serial);
            expect(g.SerialPort).toBe(SerialPort);
        });
    });
};
