// @gjsify/storybook-nativescript — unit tests.
//
// These run on GJS (and Node), where neither the NativeScript runtime globals
// nor `@nativescript/core` exist. The renderer-agnostic logic (story base,
// registry, control binding, app controller, devtools surface) now lives in
// `@gjsify/storybook-core` and is fully tested there (92 specs, GJS + Node +
// browser), so this spec no longer re-tests it via a lockstep mock — the old
// `MockStoryView` + the registry/control-binding lockstep suites are GONE.
//
// What remains is NS-adapter-specific + NS-core-free:
//   - `argsFromControls` (re-exported contract) derives defaults correctly,
//   - the NS `isNsStoryModule` narrowing guard.
//
// IMPORTANT: we still do NOT import `./story-view.js`, `./controls.js`,
// `./app.js`, `./devtools.js` or the package root `./index.js` here — those
// modules `import { ... } from '@nativescript/core'` (and subclass it) at
// module-eval, an unresolvable bare specifier off NativeScript that would fail
// the test bundle before any test runs. The NS adapter's view/factory behaviour
// is screenshot-validated on-device, not unit-tested off-device (same stance as
// `@gjsify/adwaita-nativescript`'s spec). We import only the pure
// `@gjsify/stories` contract (which the package re-exports verbatim) and
// `./types.js` (a pure narrowing guard whose `StoryView` import is type-only,
// so it carries no `@nativescript/core` runtime dependency).

import { describe, it, expect } from '@gjsify/unit';
import { ControlType, argsFromControls } from '@gjsify/stories';
import { isNsStoryModule } from './types.js';

export default async () => {
    await describe('@gjsify/storybook-nativescript contract re-export', async () => {
        await it('argsFromControls derives defaults from the control list', () => {
            expect(
                argsFromControls([
                    { type: ControlType.TEXT, name: 'title', label: 'Title', defaultValue: 'Hello' },
                    { type: ControlType.BOOLEAN, name: 'activatable', label: 'Activatable', defaultValue: true },
                    {
                        type: ControlType.SELECT,
                        name: 'icon',
                        label: 'Icon',
                        options: [
                            { label: 'Folder', value: 'folder' },
                            { label: 'Star', value: 'star' },
                        ],
                        defaultValue: 'folder',
                    },
                    {
                        type: ControlType.NUMBER,
                        name: 'count',
                        label: 'Count',
                        min: 0,
                        max: 10,
                        step: 1,
                        defaultValue: 3,
                    },
                ]),
            ).toStrictEqual({
                title: 'Hello',
                activatable: true,
                icon: 'folder',
                count: 3,
            });
        });

        await it('argsFromControls falls back to kind-appropriate empties', () => {
            const args = argsFromControls([
                { type: ControlType.TEXT, name: 't', label: 'T' },
                { type: ControlType.COLOR, name: 'c', label: 'C' },
                { type: ControlType.BOOLEAN, name: 'b', label: 'B' },
                { type: ControlType.NUMBER, name: 'n', label: 'N', min: 5 },
            ]);
            expect(args).toStrictEqual({ t: '', c: '#000000', b: false, n: 5 });
        });
    });

    await describe('isNsStoryModule', async () => {
        await it('accepts an object with a stories array', () => {
            expect(isNsStoryModule({ stories: [] })).toBe(true);
        });

        await it('rejects non-modules', () => {
            expect(isNsStoryModule(null)).toBe(false);
            expect(isNsStoryModule({})).toBe(false);
            expect(isNsStoryModule({ stories: 'x' })).toBe(false);
        });
    });
};
