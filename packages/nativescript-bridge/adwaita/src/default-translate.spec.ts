// A `_()`-marked string with no `translate` option goes through the translator the platform
// registered — the default-domain gettext GtkBuilder itself would use (ADR 0093 i18n).
//
// This lives on the TREES entry (`src/test.trees.mts`): it builds the port's real widget classes.

import { describe, expect, it } from '@gjsify/unit';
import { registerDefaultTranslate } from '@gjsify/adwaita-core';

import { build } from './builder/index.js';

const marked = { tag: 'GtkLabel', props: { label: 'Help' }, translatable: { label: {} } } as Parameters<
    typeof build
>[0];
const markedWithContext = {
    tag: 'GtkLabel',
    props: { label: 'Open' },
    translatable: { label: { context: 'menu' } },
} as Parameters<typeof build>[0];

const labelOf = (tree: Parameters<typeof build>[0], options?: Parameters<typeof build>[1]): unknown =>
    (build(tree, options) as unknown as { label: unknown }).label;

export const AdwDefaultTranslateNsTest = async () => {
    await describe('builder default translate', async () => {
        await it('leaves a marked string as authored while the slot is empty', () => {
            registerDefaultTranslate(undefined);
            expect(labelOf(marked)).toBe('Help');
        });

        await it('translates through the registered translator, context included', () => {
            registerDefaultTranslate((text, context) =>
                context === undefined ? `de(${text})` : `de(${context}|${text})`,
            );
            try {
                expect(labelOf(marked)).toBe('de(Help)');
                expect(labelOf(markedWithContext)).toBe('de(menu|Open)');
            } finally {
                registerDefaultTranslate(undefined);
            }
        });

        await it("prefers the caller's translate over the registered one", () => {
            registerDefaultTranslate(() => 'default');
            try {
                expect(labelOf(marked, { translate: () => 'caller' })).toBe('caller');
            } finally {
                registerDefaultTranslate(undefined);
            }
        });
    });
};
