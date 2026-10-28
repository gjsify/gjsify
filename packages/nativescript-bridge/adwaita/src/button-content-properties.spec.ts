// `Adw.ButtonContent`'S FOUR PROPERTIES AS DECLARED GObject PROPERTIES, measured on the pure-JS leg
// (ADR 0105 § 2, route D).
//
// `AdwButtonContent extends withProperties(StackLayout, …)` declares `icon-name`, `label`,
// `use-underline` and `can-shrink` — the four `Adw.ButtonContent` has. The widget used to hold
// them in accessors that wrote straight through and emitted nothing, so `connect('notify::label')`
// reached nobody. On Android with the real engine they are a registered GType; here, on iOS and
// in the browser, the seam's own store. `tests/integration/nativescript-gi/app/specs/button-content.ts`
// runs the same cases on a device.
//
// `host-button` is NOT one of them, and the last describe pins that. GJS has no such property on
// `Adw.ButtonContent` (C walks `gtk_widget_get_ancestor`), and its value is a NativeScript `View`,
// which is not a GObject, so no ParamSpec could hold it. It stays a plain accessor with identity
// equality and no notify. For comparison, GJS's rule for a real object-typed property, probed with
// the installed `gjs`: the same object twice notifies once, a different object notifies, `null`
// notifies, `null` again does not — identity.
//
// This lives on the TREES entry (`src/test.trees.mts`): `extends StackLayout` evaluates
// `@nativescript/core` at module scope, reachable only under that entry's `--alias`.

import { describe, expect, it } from '@gjsify/unit';
import { StackLayout } from '@nativescript/core';

import * as Adw from './namespace/adw.js';
import {
    NOTIFY_BUTTON_CONTENT_CAN_SHRINK,
    NOTIFY_BUTTON_CONTENT_ICON_NAME,
    NOTIFY_BUTTON_CONTENT_LABEL,
    NOTIFY_BUTTON_CONTENT_USE_UNDERLINE,
} from './widgets/adw-button-content.js';
import { BUTTON_CONTENT_CAN_SHRINK_CLASS, BUTTON_CONTENT_STYLE_CLASS } from './widgets/button-content.js';

interface ContentParts {
    _icon: { iconName: string };
    _label: { text: string; visibility: string };
}

const partsOf = (content: Adw.ButtonContent): ContentParts => content as unknown as ContentParts;

/** What NativeScript's XML builder does to an attribute: assign the raw string. */
function xml(content: Adw.ButtonContent, name: string, value: string): void {
    (content as unknown as Record<string, unknown>)[name] = value;
}

const hasClass = (className: string | undefined, name: string): boolean =>
    (className ?? '').split(/\s+/).includes(name);

export const AdwButtonContentPropertiesNsTest = async () => {
    await describe('Adw.ButtonContent properties on the pure-JS engine', async () => {
        await it('runs on the subset here, which is what the rest of this suite measures', () => {
            const mixin = Object.getPrototypeOf(Adw.ButtonContent) as object;
            expect(Object.hasOwn(mixin, '$gtype')).toBe(false);
        });

        await it("starts at adw_button_content_init's defaults, having emitted nothing", () => {
            const content = new Adw.ButtonContent();
            expect(content.iconName).toBe('');
            expect(content.label).toBe('');
            expect(content.useUnderline).toBe(false);
            expect(content.canShrink).toBe(false);
            // An empty label collapses its view; an empty icon still shows `image-missing`.
            expect(partsOf(content)._label.visibility).toBe('collapse');
            expect(content.iconIsFallback).toBe(true);
        });

        await it('answers each property in all three GObject spellings, typed', () => {
            const content = new Adw.ButtonContent();
            const loose = content as unknown as Record<string, unknown>;
            content.iconName = 'folder-symbolic';
            content.useUnderline = true;
            content.canShrink = true;
            expect(loose['icon-name']).toBe('folder-symbolic');
            expect(loose.icon_name).toBe('folder-symbolic');
            expect(loose['use-underline']).toBe(true);
            expect(loose['can-shrink']).toBe(true);
        });

        await it('A/B: each property emits notify::<name> on a change and on nothing else', () => {
            // Without the declaration the accessors wrote straight through and nothing was ever
            // emitted, so every count below is 0.
            const content = new Adw.ButtonContent();
            const seen: string[] = [];
            content.connect(NOTIFY_BUTTON_CONTENT_ICON_NAME, () => seen.push('icon-name'));
            content.connect(NOTIFY_BUTTON_CONTENT_LABEL, () => seen.push('label'));
            content.connect(NOTIFY_BUTTON_CONTENT_USE_UNDERLINE, () => seen.push('use-underline'));
            content.connect(NOTIFY_BUTTON_CONTENT_CAN_SHRINK, () => seen.push('can-shrink'));
            content.label = 'Save';
            content.label = 'Save';
            content.iconName = 'document-save-symbolic';
            content.iconName = 'document-save-symbolic';
            content.useUnderline = true;
            content.useUnderline = true;
            content.canShrink = true;
            content.canShrink = true;
            content.canShrink = false;
            expect(seen).toStrictEqual(['label', 'icon-name', 'use-underline', 'can-shrink', 'can-shrink']);
        });

        await it('renders each property from its own notify', () => {
            const content = new Adw.ButtonContent();
            const parts = partsOf(content);
            content.label = 'Save';
            expect(parts._label.text).toBe('Save');
            expect(parts._label.visibility).toBe('visible');
            content.useUnderline = true;
            content.label = '_Save';
            expect(parts._label.text).toBe('Save');
            content.label = '';
            expect(parts._label.visibility).toBe('collapse');
            content.iconName = 'folder-symbolic';
            expect(content.iconIsFallback).toBe(false);
            expect(parts._icon.iconName).toBe('folder-symbolic');
            content.canShrink = true;
            expect(hasClass(content.className, BUTTON_CONTENT_CAN_SHRINK_CLASS)).toBe(true);
            content.canShrink = false;
            expect(hasClass(content.className, BUTTON_CONTENT_CAN_SHRINK_CLASS)).toBe(false);
        });

        await it('reads a null string write as the empty string, and an equal one as no change', () => {
            const content = new Adw.ButtonContent({ label: 'Save' });
            let runs = 0;
            content.connect(NOTIFY_BUTTON_CONTENT_LABEL, () => runs++);
            (content as unknown as { label: unknown }).label = null;
            expect(content.label).toBe('');
            (content as unknown as { label: unknown }).label = null;
            expect(runs).toBe(1);
        });

        await it('A/B: coerces XML strings to the declared type, and refuses what is neither', () => {
            // `xmlBoolean` used to fall back to the held value for 'maybe' and say nothing.
            const content = new Adw.ButtonContent();
            xml(content, 'useUnderline', 'true');
            xml(content, 'canShrink', 'TRUE');
            expect(content.useUnderline).toBe(true);
            expect(content.canShrink).toBe(true);
            xml(content, 'canShrink', 'false');
            expect(content.canShrink).toBe(false);
            expect(() => xml(content, 'useUnderline', 'maybe')).toThrow();
            expect(content.useUnderline).toBe(true);
        });

        await it('takes the four from the construct-props bag', () => {
            const content = new Adw.ButtonContent({
                iconName: 'folder-symbolic',
                label: 'Open',
                useUnderline: true,
                canShrink: true,
            });
            expect(content.label).toBe('Open');
            expect(content.iconIsFallback).toBe(false);
            expect(partsOf(content)._label.text).toBe('Open');
            expect(content.canShrink).toBe(true);
        });
    });

    await describe('Adw.ButtonContent host-button is a plain NativeScript accessor', async () => {
        await it('is not a declared property: no write ever emits notify::host-button', () => {
            const content = new Adw.ButtonContent();
            let runs = 0;
            content.connect('notify::host-button', () => runs++);
            const host = new StackLayout();
            content.hostButton = host;
            content.hostButton = new StackLayout();
            content.hostButton = null;
            expect(runs).toBe(0);
        });

        await it('stamps image-text-button on the host and takes it off a replaced one', () => {
            const content = new Adw.ButtonContent();
            const first = new StackLayout();
            const second = new StackLayout();
            content.hostButton = first;
            expect(hasClass(first.className, BUTTON_CONTENT_STYLE_CLASS)).toBe(true);
            content.hostButton = second;
            expect(hasClass(first.className, BUTTON_CONTENT_STYLE_CLASS)).toBe(false);
            expect(hasClass(second.className, BUTTON_CONTENT_STYLE_CLASS)).toBe(true);
            content.hostButton = null;
            expect(hasClass(second.className, BUTTON_CONTENT_STYLE_CLASS)).toBe(false);
            expect(content.hostButton).toBe(null);
        });

        await it('compares by identity: the same view twice is one stamp, not two', () => {
            const content = new Adw.ButtonContent();
            const host = new StackLayout();
            content.hostButton = host;
            const once = host.className;
            content.hostButton = host;
            expect(host.className).toBe(once);
            expect(content.hostButton === host).toBe(true);
        });
    });
};
