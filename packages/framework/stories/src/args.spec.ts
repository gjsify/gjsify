// @gjsify/stories — argsFromControls + isStoryModule tests.
// Cross-platform (pure TS): runs identically on Node and GJS.

import { describe, expect, it } from '@gjsify/unit';
import { argsFromControls } from './args.js';
import { ControlType, isStoryModule, type StoryControl } from './types.js';

export default async () => {
    await describe('argsFromControls — explicit defaults', async () => {
        await it('uses each control defaultValue verbatim', async () => {
            const controls: StoryControl[] = [
                { name: 'label', label: 'Label', type: ControlType.TEXT, defaultValue: 'Hi' },
                { name: 'size', label: 'Size', type: ControlType.NUMBER, min: 0, max: 10, defaultValue: 4 },
                { name: 'on', label: 'On', type: ControlType.BOOLEAN, defaultValue: true },
                {
                    name: 'mode',
                    label: 'Mode',
                    type: ControlType.SELECT,
                    options: [
                        { label: 'A', value: 'a' },
                        { label: 'B', value: 'b' },
                    ],
                    defaultValue: 'b',
                },
                { name: 'tint', label: 'Tint', type: ControlType.COLOR, defaultValue: '#3584e4' },
            ];
            expect(argsFromControls(controls)).toStrictEqual({
                label: 'Hi',
                size: 4,
                on: true,
                mode: 'b',
                tint: '#3584e4',
            });
        });
    });

    await describe('argsFromControls — derived fallbacks', async () => {
        await it('falls back to kind-appropriate empty values', async () => {
            const controls: StoryControl[] = [
                { name: 'text', label: 'Text', type: ControlType.TEXT },
                { name: 'color', label: 'Color', type: ControlType.COLOR },
                { name: 'flag', label: 'Flag', type: ControlType.BOOLEAN },
                { name: 'count', label: 'Count', type: ControlType.NUMBER, min: 3, max: 9 },
                { name: 'zoom', label: 'Zoom', type: ControlType.RANGE },
                {
                    name: 'pick',
                    label: 'Pick',
                    type: ControlType.SELECT,
                    options: [{ label: 'First', value: 1 }],
                },
            ];
            expect(argsFromControls(controls)).toStrictEqual({
                text: '',
                color: '#000000',
                flag: false,
                count: 3,
                zoom: 0,
                pick: 1,
            });
        });

        await it('returns an empty map for no controls', async () => {
            expect(argsFromControls()).toStrictEqual({});
            expect(argsFromControls([])).toStrictEqual({});
        });

        await it('yields null for a SELECT with no options', async () => {
            const controls: StoryControl[] = [{ name: 'empty', label: 'Empty', type: ControlType.SELECT, options: [] }];
            expect(argsFromControls(controls)).toStrictEqual({ empty: null });
        });
    });

    await describe('isStoryModule', async () => {
        await it('accepts an object with a stories array', async () => {
            expect(isStoryModule({ stories: [] })).toBeTruthy();
        });

        await it('rejects non-modules', async () => {
            expect(isStoryModule(null)).toBeFalsy();
            expect(isStoryModule({})).toBeFalsy();
            expect(isStoryModule({ stories: 'nope' })).toBeFalsy();
            expect(isStoryModule(42)).toBeFalsy();
        });
    });
};
