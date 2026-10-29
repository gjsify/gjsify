import { describe, expect, it } from '@gjsify/unit';

import { registerDefaultTranslate, registeredDefaultTranslate } from './default-translate.js';

export default async () => {
    await describe('default translate slot', async () => {
        await it('starts empty and holds the last registration', () => {
            registerDefaultTranslate(undefined);
            expect(registeredDefaultTranslate()).toBe(undefined);
            const translate = (text: string) => text;
            registerDefaultTranslate(translate);
            expect(registeredDefaultTranslate()).toBe(translate);
            registerDefaultTranslate(undefined);
            expect(registeredDefaultTranslate()).toBe(undefined);
        });
    });
};
