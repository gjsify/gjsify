// SPDX-License-Identifier: MIT
// Regression guard: `setImmediate` / `clearImmediate` are free identifiers on NS V8.
// Node code (nodemailer, Node streams) calls them bare; the NS runtime has neither,
// and the build must install them before any module evaluates.
import { describe, it, expect } from '../reporter.js';

export default async function timersSmoke(): Promise<void> {
    await describe('setImmediate / clearImmediate globals', async () => {
        await it('are functions', () => {
            expect(typeof setImmediate).toBe('function');
            expect(typeof clearImmediate).toBe('function');
        });
        await it('runs the callback with its arguments', async () => {
            const got = await new Promise<string>((resolve) => {
                setImmediate((a: string, b: string) => resolve(a + b), 'x', 'y');
            });
            expect(got).toBe('xy');
        });
        await it('fires after pending microtasks, like Node', async () => {
            const order: string[] = [];
            await new Promise<void>((resolve) => {
                setImmediate(() => {
                    order.push('immediate');
                    resolve();
                });
                Promise.resolve().then(() => order.push('microtask'));
            });
            expect(order.join(',')).toBe('microtask,immediate');
        });
        await it('clearImmediate cancels', async () => {
            let ran = false;
            const h = setImmediate(() => {
                ran = true;
            });
            clearImmediate(h);
            await new Promise<void>((resolve) => setTimeout(resolve, 20));
            expect(ran).toBe(false);
        });
    });
}
