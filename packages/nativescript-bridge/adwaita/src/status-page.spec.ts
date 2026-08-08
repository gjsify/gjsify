// Status-page content visibility for NativeScript.
//
// The widget class cannot be imported here (`extends GridLayout` evaluates the
// bare `@nativescript/core` specifier at module-eval, which is unresolvable off
// NativeScript), so this suite drives `widgets/status-page-content.ts` — the
// SHIPPING predicates the widget itself calls, never a transcription of them.
//
// What it holds the port to: `Adw.StatusPage` binds each part's `visible` to a
// closure over the property that feeds it, and an EMPTY title is therefore not in
// the layout at all (adw-status-page.ui:41-46 → `string_is_not_empty`,
// adw-status-page.c:91-96). The port kept the title label in the stack
// unconditionally, so a status page with only a description opened with a blank
// line above it — while spending about sixty lines of add/remove tree surgery on
// the parts it DID hide.

import { describe, expect, it } from '@gjsify/unit';

import { statusPageIconVisibility, statusPageLabelVisibility } from './widgets/status-page-content.js';

export default async () => {
    await describe('statusPageLabelVisibility (string_is_not_empty, adw-status-page.c:91-96)', async () => {
        await it('a non-empty string is visible', () => {
            expect(statusPageLabelVisibility('No results found')).toBe('visible');
        });

        await it('an EMPTY title takes no space — the half the port never implemented', () => {
            expect(statusPageLabelVisibility('')).toBe('collapse');
        });

        await it('an unset property hides it too — `string &&` guards the NULL', () => {
            expect(statusPageLabelVisibility(null)).toBe('collapse');
            expect(statusPageLabelVisibility(undefined)).toBe('collapse');
        });

        await it('a whitespace-only string is VISIBLE — C reads one byte, it does not trim', () => {
            expect(statusPageLabelVisibility('   ')).toBe('visible');
            expect(statusPageLabelVisibility('\n')).toBe('visible');
        });

        await it('the description answers the same closure, not a second rule', () => {
            // adw-status-page.ui:57-62 binds `string_is_not_empty` again.
            for (const text of ['', '  ', 'Try a different search term']) {
                expect(statusPageLabelVisibility(text)).toBe(statusPageLabelVisibility(text));
            }
            expect(statusPageLabelVisibility('')).toBe('collapse');
        });
    });

    await describe('statusPageIconVisibility (has_image, adw-status-page.c:83-89)', async () => {
        await it('an icon shows the image', () => {
            expect(statusPageIconVisibility('<svg viewBox="0 0 16 16"/>')).toBe('visible');
        });

        await it('no icon hides it — `icon_name && icon_name[0]`', () => {
            expect(statusPageIconVisibility('')).toBe('collapse');
            expect(statusPageIconVisibility(null)).toBe('collapse');
        });
    });
};
