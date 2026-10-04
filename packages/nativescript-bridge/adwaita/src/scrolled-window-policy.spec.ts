// `Gtk.PolicyType` folded onto the one axis a NativeScript `ScrollView` scrolls on.

import { describe, expect, it } from '@gjsify/unit';

import {
    DEFAULT_SCROLLBAR_POLICY,
    GTK_POLICY_TYPES,
    normalizePolicy,
    policyScrolls,
    scrollOrientationFor,
} from './widgets/scrolled-window-policy.js';

export default async () => {
    await describe('GTK_POLICY_TYPES against the GIR', async () => {
        // Position-for-constant is held by arm 8 of `check-nativescript-xml-doors.mjs`.
        await it('is GtkPolicyType: `never` is constant 2, as Gtk.PolicyType.NEVER', () => {
            expect(GTK_POLICY_TYPES.length).toBe(4);
            expect(GTK_POLICY_TYPES[2]).toBe('never');
        });

        await it('starts both axes automatic, as gtk_scrolled_window_init does', () => {
            expect(DEFAULT_SCROLLBAR_POLICY).toBe('automatic');
        });
    });

    await describe('normalizePolicy', async () => {
        await it('takes a nick and the constant, and refuses anything else', () => {
            expect(normalizePolicy('never', 'hscrollbar-policy')).toBe('never');
            expect(normalizePolicy(2, 'hscrollbar-policy')).toBe('never');
            expect(() => normalizePolicy('sometimes', 'vscrollbar-policy')).toThrow('vscrollbar-policy');
            expect(() => normalizePolicy(9, 'vscrollbar-policy')).toThrow('Gtk.PolicyType');
        });
    });

    await describe('scrollOrientationFor', async () => {
        await it('only `never` stops an axis scrolling', () => {
            expect(policyScrolls('never')).toBe(false);
            for (const policy of ['always', 'automatic', 'external'] as const) expect(policyScrolls(policy)).toBe(true);
        });

        await it('scrolls vertically by default and when only the vertical axis scrolls', () => {
            expect(scrollOrientationFor('automatic', 'automatic')).toBe('vertical');
            expect(scrollOrientationFor('never', 'automatic')).toBe('vertical');
        });

        await it('flips to horizontal only when ONLY the horizontal axis scrolls', () => {
            expect(scrollOrientationFor('automatic', 'never')).toBe('horizontal');
            expect(scrollOrientationFor('always', 'never')).toBe('horizontal');
        });

        await it('a window that scrolls neither way is still vertical, since a ScrollView cannot refuse', () => {
            expect(scrollOrientationFor('never', 'never')).toBe('vertical');
        });
    });
};
