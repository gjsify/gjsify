// Ported from `@gjsify/adwaita-nativescript`'s index.spec.ts alongside the dialog
// move (ADR 0004) — the NS package keeps only the `present()` binding onto native
// `confirm()`/`action()`. The response ordering + confirm/action resolution the NS
// mock re-implemented is exercised HERE against the real model, extended with the
// appearance/enabled registry the mock omitted.

import { describe, it, expect } from '@gjsify/unit';

import { AdwAlertResponses } from './dialog.js';

export default async () => {
    await describe('AdwAlertResponses registry (Adw.AlertDialog responses)', async () => {
        await it('registers responses with id/label and default appearance/enabled', () => {
            const d = new AdwAlertResponses('Delete file?', 'This cannot be undone.');
            expect(d.heading).toBe('Delete file?');
            expect(d.body).toBe('This cannot be undone.');
            d.addResponse('cancel', 'Cancel');
            d.addResponse('delete', 'Delete', { appearance: 'destructive' });
            expect(d.responses.length).toBe(2);
            expect(d.hasResponse('delete')).toBe(true);
            expect(d.getResponseAppearance('delete')).toBe('destructive');
            expect(d.getResponseAppearance('cancel')).toBe('default');
            expect(d.getResponseEnabled('cancel')).toBe(true);
        });

        await it('addResponses registers id/label pairs', () => {
            const d = new AdwAlertResponses();
            d.addResponses('a', 'A', 'b', 'B');
            expect(d.responses.map((r) => r.id)).toStrictEqual(['a', 'b']);
            expect(d.responses.map((r) => r.label)).toStrictEqual(['A', 'B']);
        });

        await it('a repeated id updates the response in place (no duplicate)', () => {
            const d = new AdwAlertResponses();
            d.addResponse('ok', 'OK');
            d.addResponse('ok', 'Okay', { appearance: 'suggested' });
            expect(d.responses.length).toBe(1);
            expect(d.responses[0]!.label).toBe('Okay');
            expect(d.getResponseAppearance('ok')).toBe('suggested');
        });

        await it('sets appearance/enabled after registration; unknown ids are inert', () => {
            const d = new AdwAlertResponses();
            d.addResponse('save', 'Save');
            d.setResponseAppearance('save', 'suggested');
            d.setResponseEnabled('save', false);
            expect(d.getResponseAppearance('save')).toBe('suggested');
            expect(d.getResponseEnabled('save')).toBe(false);
            // Unknown id: setters no-op, getters return the documented defaults.
            d.setResponseAppearance('nope', 'destructive');
            expect(d.getResponseAppearance('nope')).toBe('default');
            expect(d.getResponseEnabled('nope')).toBe(true);
        });
    });

    await describe('AdwAlertResponses ordering (OK / cancel / neutral slots)', async () => {
        await it('default→ok, last→cancel, middle→neutral', () => {
            const d = new AdwAlertResponses();
            d.addResponse('save', 'Save');
            d.addResponse('discard', 'Discard');
            d.addResponse('cancel', 'Cancel');
            d.defaultResponse = 'save';
            const ordered = d.orderResponses();
            expect(ordered.ok?.id).toBe('save'); // default = OK
            expect(ordered.cancel?.id).toBe('cancel'); // last = cancel
            expect(ordered.neutral?.id).toBe('discard'); // middle = neutral
        });

        await it('falls back to the first response as OK when no default is set', () => {
            const d = new AdwAlertResponses();
            d.addResponse('yes', 'Yes');
            d.addResponse('no', 'No');
            const ordered = d.orderResponses();
            expect(ordered.ok?.id).toBe('yes');
            expect(ordered.cancel?.id).toBe('no');
            expect(ordered.neutral).toBe(undefined);
        });

        await it('switches to an action sheet for more than three responses', () => {
            const d = new AdwAlertResponses();
            d.addResponses('a', 'A', 'b', 'B', 'c', 'C');
            expect(d.usesActionSheet).toBe(false);
            d.addResponse('d', 'D');
            expect(d.usesActionSheet).toBe(true);
        });
    });

    await describe('AdwAlertResponses resolve-to-chosen-id contract', async () => {
        await it('resolveById validates against the registry, falling back to closeResponse', () => {
            const d = new AdwAlertResponses();
            d.addResponse('ok', 'OK');
            d.closeResponse = 'dismissed';
            expect(d.resolveById('ok')).toBe('ok');
            expect(d.resolveById('ghost')).toBe('dismissed'); // unknown id
            expect(d.resolveById(null)).toBe('dismissed'); // dismissal
            expect(d.resolveById(undefined)).toBe('dismissed');
        });

        await it('closeResponse defaults to "close" and rejects an empty override', () => {
            const d = new AdwAlertResponses();
            expect(d.closeResponse).toBe('close');
            d.closeResponse = '';
            expect(d.closeResponse).toBe('close');
            expect(d.resolveById(null)).toBe('close');
        });

        await it('resolveLabel maps an action-sheet label to its id, else closeResponse', () => {
            const d = new AdwAlertResponses();
            d.addResponse('save', 'Save');
            d.addResponse('discard', 'Discard');
            expect(d.resolveLabel('Discard')).toBe('discard');
            expect(d.resolveLabel('Nonexistent')).toBe('close'); // no such label
            expect(d.resolveLabel(undefined)).toBe('close'); // cancelled sheet
        });

        await it('maps ordered slots to ids like a native confirm() (default emphasis)', () => {
            // Mirrors the NS `_presentConfirm` mapping: true→ok, false→cancel,
            // undefined→neutral, driven off orderResponses() + resolveById().
            const d = new AdwAlertResponses();
            d.addResponse('save', 'Save');
            d.addResponse('discard', 'Discard');
            d.addResponse('cancel', 'Cancel');
            d.defaultResponse = 'save';
            const o = d.orderResponses();
            expect(d.resolveById(o.ok?.id)).toBe('save');
            expect(d.resolveById(o.cancel?.id)).toBe('cancel');
            expect(d.resolveById(o.neutral?.id)).toBe('discard');
        });
    });
};
