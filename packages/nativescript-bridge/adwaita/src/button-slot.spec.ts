// `Gtk.Button`'s one child and the three ways to fill it, driven off-device.
//
// `gtk-button.ts` cannot be imported here (`extends GridLayout` evaluates the bare
// `@nativescript/core` specifier at module eval), so this drives `widgets/button-slot.ts`
// — the shipping rule the widget's `_fill` reads to decide what to detach.
//
// THE EXPECTATIONS ARE GTK'S, measured under gjs 1.88.1 / gtk 4.22.4 on a `Gtk.Button`
// with `get_child()` and `get_label()` read back after each write:
//
//   set_label('Pill')                   child is a GtkLabel, label 'Pill'
//   then set_icon_name('list-add')      child is a GtkImage, label null
//   then set_child(content)             child is the content, label null
//   then set_child(null)                child is null
//   set_label('')                       child is STILL a GtkLabel, label ''
//
// The last row is the one this file exists for: an empty label does NOT empty the button.
// A port that read `''` as "clear it" would drop the child a caller who blanked a label
// still expects to be holding the padding.

import { describe, expect, it } from '@gjsify/unit';

import { buttonSlotAfterWrite, buttonSlotDetaches } from './widgets/button-slot.js';

/** Stands in for a `View`: the slot rule only ever asks whether it is null. */
const someView = { id: 'content' };

export default async () => {
    await describe('buttonSlotAfterWrite — the last write wins, with no precedence', async () => {
        await it('a label write shows the label, whatever was there before', () => {
            expect(buttonSlotAfterWrite('label', 'Pill')).toBe('label');
        });

        await it('an EMPTY label is still the label slot — the button keeps its child', () => {
            expect(buttonSlotAfterWrite('label', '')).toBe('label');
        });

        await it('an icon write shows the icon, and an empty icon name is still the icon slot', () => {
            expect(buttonSlotAfterWrite('icon', 'a-symbolic-svg')).toBe('icon');
            expect(buttonSlotAfterWrite('icon', '')).toBe('icon');
        });

        await it('a child write shows the child', () => {
            expect(buttonSlotAfterWrite('child', someView)).toBe('child');
        });

        await it('only `set_child(null)` empties the button', () => {
            expect(buttonSlotAfterWrite('child', null)).toBe('empty');
            expect(buttonSlotAfterWrite('child', undefined)).toBe('empty');
        });
    });

    await describe('buttonSlotDetaches — two views in one grid cell paint over each other', async () => {
        await it('detaches when the slot changes, in every direction', () => {
            expect(buttonSlotDetaches('label', 'icon')).toBe(true);
            expect(buttonSlotDetaches('icon', 'child')).toBe(true);
            expect(buttonSlotDetaches('child', 'label')).toBe(true);
            expect(buttonSlotDetaches('label', 'empty')).toBe(true);
        });

        await it('does NOT detach when the slot is unchanged, so a re-label reuses the view', () => {
            expect(buttonSlotDetaches('label', 'label')).toBe(false);
            expect(buttonSlotDetaches('icon', 'icon')).toBe(false);
            expect(buttonSlotDetaches('child', 'child')).toBe(false);
        });

        await it('has nothing to detach from an empty button', () => {
            expect(buttonSlotDetaches('empty', 'label')).toBe(false);
            expect(buttonSlotDetaches('empty', 'child')).toBe(false);
            expect(buttonSlotDetaches('empty', 'empty')).toBe(false);
        });
    });

    await describe('the sequence GTK was measured on, replayed through the two rules', async () => {
        await it('label -> icon -> child -> null detaches at every step but the first', () => {
            const writes: Array<['label' | 'icon' | 'child', unknown]> = [
                ['label', 'Pill'],
                ['icon', 'a-symbolic-svg'],
                ['child', someView],
                ['child', null],
            ];
            const trail: Array<[string, boolean]> = [];
            let slot: ReturnType<typeof buttonSlotAfterWrite> = 'empty';
            for (const [wrote, value] of writes) {
                const next = buttonSlotAfterWrite(wrote, value);
                trail.push([next, buttonSlotDetaches(slot, next)]);
                slot = next;
            }
            expect(trail).toStrictEqual([
                ['label', false],
                ['icon', true],
                ['child', true],
                ['empty', true],
            ]);
        });
    });
};
