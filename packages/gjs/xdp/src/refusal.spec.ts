import { describe, expect, it } from '@gjsify/unit';

import { refusal, subsetOf } from './refusal.js';

export default async () => {
    await describe('refusal', async () => {
        await it('names the member, module and platform', async () => {
            const error = refusal('Portal.open_file', 'windows');
            expect(error.message.includes('Portal.open_file')).toBe(true);
            expect(error.message.includes('windows')).toBe(true);
            expect(error.code).toBe('ENOTSUP');
            expect(error.gjsifyMember).toBe('Portal.open_file');
        });
    });
    await describe('subsetOf', async () => {
        const target = { request_background: 1, open_file: 2 };
        const subset = subsetOf(target, new Set(['request_background']), 'windows');
        await it('passes a member of the subset', async () => {
            expect(subset.request_background).toBe(1);
        });
        await it('throws, naming the member, for one outside it', async () => {
            let message = '';
            try {
                void subset.open_file;
            } catch (error) {
                message = (error as Error).message;
            }
            expect(message.includes('Portal.open_file')).toBe(true);
        });
    });
};
