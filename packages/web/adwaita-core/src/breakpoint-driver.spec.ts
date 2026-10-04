import { describe, expect, it } from '@gjsify/unit';

import { createBreakpointDriver } from './breakpoint-driver.js';

/** Two objects as plain records, so the property door is observable. */
function world() {
    const label = { text: 'wide', opacity: 1 };
    const log: string[] = [];
    const io = {
        read: (object: typeof label, property: string) => (object as Record<string, unknown>)[property],
        write: (object: typeof label, property: string, value: unknown) => {
            log.push(`${property}=${String(value)}`);
            (object as Record<string, unknown>)[property] = value;
        },
    };
    return { label, log, io };
}

export default async () => {
    await describe('createBreakpointDriver', async () => {
        await it('applies a matching breakpoint and restores what registration captured', () => {
            const { label, io } = world();
            const driver = createBreakpointDriver(
                [{ condition: 'max-width: 400px', setters: [{ object: label, property: 'text', value: 'narrow' }] }],
                io,
            );
            driver.evaluate({ width: 300, height: 600 });
            expect(label.text).toBe('narrow');
            driver.evaluate({ width: 800, height: 600 });
            expect(label.text).toBe('wide');
        });

        await it('reads the original at registration, not at apply', () => {
            const { label, io } = world();
            const driver = createBreakpointDriver(
                [{ condition: 'max-width: 400px', setters: [{ object: label, property: 'text', value: 'narrow' }] }],
                io,
            );
            label.text = 'changed later';
            driver.evaluate({ width: 300, height: 600 });
            driver.evaluate({ width: 800, height: 600 });
            expect(label.text).toBe('wide');
        });

        await it('lets the LAST matching breakpoint win and does not restore a property set again', () => {
            const { label, log, io } = world();
            const driver = createBreakpointDriver(
                [
                    { condition: 'max-width: 800px', setters: [{ object: label, property: 'text', value: 'mid' }] },
                    { condition: 'max-width: 400px', setters: [{ object: label, property: 'text', value: 'low' }] },
                ],
                io,
            );
            driver.evaluate({ width: 700, height: 600 });
            expect(label.text).toBe('mid');
            log.length = 0;
            driver.evaluate({ width: 300, height: 600 });
            expect(label.text).toBe('low');
            expect(log.join()).toBe('text=low');
            expect(driver.current).toBe(1);
        });

        await it('does not write while the applied breakpoint is unchanged', () => {
            const { label, log, io } = world();
            const driver = createBreakpointDriver(
                [{ condition: 'max-width: 400px', setters: [{ object: label, property: 'text', value: 'narrow' }] }],
                io,
            );
            driver.evaluate({ width: 300, height: 600 });
            log.length = 0;
            driver.evaluate({ width: 200, height: 600 });
            expect(log.length).toBe(0);
        });
    });
};
