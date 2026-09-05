// Avatar fallback rendering for NativeScript.
//
// The widget class cannot be imported here (`extends GridLayout` evaluates the bare
// `@nativescript/core` specifier at module-eval, which is unresolvable off
// NativeScript), so this suite drives `widgets/avatar-view.ts` — the SHIPPING helpers
// `AdwAvatar` itself calls, never a transcription of them.
//
// The MODE is asserted against the shared vectors rather than re-derived, which is what
// makes this a check on the NativeScript half and not a second copy of the C. Colour and
// initials are covered in `index.spec.ts`.
//
// WHAT IT STILL CANNOT REACH: the three assignments inside `AdwAvatar` that put the
// answer on the two children. `avatarViewState` exists to make everything BEFORE them
// falsifiable; the assignments themselves are only checked by running the app.

import { describe, expect, it } from '@gjsify/unit';

import { avatarIconSize, avatarMode } from '@gjsify/adwaita-core';
import { AVATAR_MODE_VECTORS } from '@gjsify/adwaita-core/conformance';
import { avatarDefaultSymbolic, imageMissingSymbolic } from '@gjsify/adwaita-icons/status';

import { extractIconPaths } from './widgets/icon-path.js';
import { AVATAR_DEFAULT_ICON, avatarIconSvg, avatarViewState, avatarVisibilities } from './widgets/avatar-view.js';

export default async () => {
    await describe('avatarVisibilities (Adw.Avatar update_visibility, adw-avatar.c:117-124)', async () => {
        for (const { hasCustomImage, showInitials, text, mode, rule } of AVATAR_MODE_VECTORS) {
            await it(`${JSON.stringify({ hasCustomImage, showInitials, text })} -> ${mode} — ${rule}`, () => {
                // Through `avatarMode`, the way the widget reaches it: the vectors say
                // which mode, this file says what NativeScript does with the answer.
                const visibilities = avatarVisibilities(avatarMode({ hasCustomImage, showInitials, text }));
                expect(visibilities.label).toBe(mode === 'initials' ? 'visible' : 'collapse');
                expect(visibilities.icon).toBe(mode === 'icon' ? 'visible' : 'collapse');
            });
        }

        await it('never puts both children in the layout at once', () => {
            const both: string[] = [];
            for (const mode of ['image', 'initials', 'icon'] as const) {
                const { label, icon } = avatarVisibilities(mode);
                if (label === 'visible' && icon === 'visible') both.push(mode);
            }
            expect(both).toStrictEqual([]);
        });

        await it("the `image` mode shows NEITHER — it is not folded into 'icon'", () => {
            // The port has no `custom-image` counterpart yet, and the mode still has to
            // be expressible: the web element shipped a hardcoded `hasCustomImage: false`
            // that no vector could falsify, and that is the shape being avoided here.
            expect(avatarVisibilities('image')).toStrictEqual({ label: 'collapse', icon: 'collapse' });
        });
    });

    await describe('avatarIconSvg (Adw.Avatar update_icon, adw-avatar.c:192-195)', async () => {
        await it("an unset icon falls back to the default, the way C's NULL icon-name does", () => {
            expect(avatarIconSvg('')).toBe(AVATAR_DEFAULT_ICON);
            expect(avatarIconSvg(null)).toBe(AVATAR_DEFAULT_ICON);
            expect(avatarIconSvg(undefined)).toBe(AVATAR_DEFAULT_ICON);
        });

        await it('a caller-supplied SVG is passed through unchanged', () => {
            // The SVG source IS the icon identity on this runtime — there is no
            // icon-theme name to resolve, and no lookup is attempted.
            expect(avatarIconSvg(imageMissingSymbolic)).toBe(imageMissingSymbolic);
        });

        await it("the default is the icon THEME's asset, not libadwaita's own", () => {
            expect(AVATAR_DEFAULT_ICON).toBe(avatarDefaultSymbolic);
        });

        await it('the default icon actually renders — it has fillable path data', () => {
            // The substitution exists because libadwaita's own `adw-avatar-default.svg`
            // is `fill="none"` plus a stroke, and this renderer FILLS every path it
            // extracts, so that asset would paint a solid disc. A default whose paths
            // this parser cannot find would be an invisible fallback, which is the
            // failure the whole property is supposed to remove.
            const paths = extractIconPaths(AVATAR_DEFAULT_ICON);
            expect(paths.length > 0).toBe(true);
            expect(paths.every((path) => path.d.length > 0)).toBe(true);
            // `null` fill means "take the caller's colour", which is what makes the
            // glyph follow the avatar's palette `fg`.
            expect(paths.every((path) => path.fill === null)).toBe(true);
        });
    });

    await describe('avatarIconSize (the glyph inside the circle)', async () => {
        await it('gives the fallback icon a box the circle can hold', () => {
            // At the sizes this port actually ships avatars at.
            const outside = [24, 32, 48, 96, 128].filter((size) => avatarIconSize(size) > size / 1.4142);
            expect(outside).toStrictEqual([]);
        });

        await it('is the same number the web renderer draws at', () => {
            // Both renderers call the core helper; this pins the value so a local
            // "simplification" back to a hand-typed factor fails here.
            expect(avatarIconSize(96)).toBe(53);
            expect(avatarIconSize(48)).toBe(26);
        });
    });

    await describe('avatarViewState (everything AdwAvatar decides)', async () => {
        await it('a bare avatar carrying a name shows the fallback icon', () => {
            // The break this PR is about, from the caller's side: `showInitials` is
            // FALSE by default, so a name alone no longer switches the label on.
            const state = avatarViewState({ showInitials: false, text: 'Ada Lovelace', iconName: '' });
            expect(state.mode).toBe('icon');
            expect(state.label).toBe('collapse');
            expect(state.icon).toBe('visible');
            expect(state.iconSvg).toBe(AVATAR_DEFAULT_ICON);
        });

        await it('asking for initials switches the label on and the icon off', () => {
            const state = avatarViewState({ showInitials: true, text: 'Ada Lovelace', iconName: '' });
            expect(state.mode).toBe('initials');
            expect(state.label).toBe('visible');
            expect(state.icon).toBe('collapse');
        });

        await it("a caller's own SVG replaces the default in the icon arm", () => {
            const state = avatarViewState({ showInitials: false, text: '', iconName: imageMissingSymbolic });
            expect(state.iconSvg).toBe(imageMissingSymbolic);
        });

        await it('never reports the image mode, because the port cannot draw one', () => {
            // `hasCustomImage` is hard-wired FALSE here; the day it is not, this is the
            // test that has to change, rather than a silent third branch appearing.
            const modes = [true, false].flatMap((showInitials) =>
                ['', 'Ada'].map((text) => avatarViewState({ showInitials, text, iconName: '' }).mode),
            );
            expect(modes.includes('image')).toBe(false);
        });
    });
};
