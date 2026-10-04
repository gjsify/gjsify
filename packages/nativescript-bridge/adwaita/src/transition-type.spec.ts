// `Gtk.RevealerTransitionType` / `Gtk.StackTransitionType` — accepted, validated, never rendered.
//
// The two lists are held against the typelib-read constants in gtk-host's committed
// `generated/enum-values.mts`: a position in the list IS the GIR constant, which is what lets
// a number from a GJS snippet (`Gtk.StackTransitionType.SLIDE_LEFT`) mean the same member.

import { describe, expect, it } from '@gjsify/unit';

import { GTK_REVEALER_TRANSITIONS, GTK_STACK_TRANSITIONS, transitionNick } from './widgets/transition-type.js';

export default async () => {
    // Position-for-constant against the typelib-read values is held by arm 8 of
    // `scripts/check-nativescript-xml-doors.mjs`; these are the measured anchors a number from
    // a GJS snippet depends on (`generated/enum-values.mts`).
    await describe('the transition lists', async () => {
        await it('GTK_REVEALER_TRANSITIONS has the 14 members and the anchors GJS constants rely on', () => {
            expect(GTK_REVEALER_TRANSITIONS.length).toBe(14);
            expect(GTK_REVEALER_TRANSITIONS[4]).toBe('slide-up');
            expect(GTK_REVEALER_TRANSITIONS[13]).toBe('fade-slide-down');
        });

        await it('GTK_STACK_TRANSITIONS has the 23 members and the anchors GJS constants rely on', () => {
            expect(GTK_STACK_TRANSITIONS.length).toBe(23);
            expect(GTK_STACK_TRANSITIONS[6]).toBe('slide-left-right');
            expect(GTK_STACK_TRANSITIONS[22]).toBe('rotate-left-right');
        });
    });

    await describe('transitionNick', async () => {
        await it('takes a nick as written', () => {
            expect(transitionNick('slide-up', GTK_REVEALER_TRANSITIONS, 'Gtk.RevealerTransitionType')).toBe('slide-up');
        });

        await it("takes Blueprint's underscore spelling — `transition-type: slide_up;`", () => {
            expect(transitionNick('slide_up', GTK_REVEALER_TRANSITIONS, 'Gtk.RevealerTransitionType')).toBe('slide-up');
            expect(transitionNick('over_left_right', GTK_STACK_TRANSITIONS, 'Gtk.StackTransitionType')).toBe(
                'over-left-right',
            );
        });

        await it('takes the constant a GJS snippet writes', () => {
            expect(transitionNick(3, GTK_STACK_TRANSITIONS, 'Gtk.StackTransitionType')).toBe('slide-left');
        });

        await it('refuses a word that is not a member, naming the members', () => {
            expect(() => transitionNick('slide-sideways', GTK_STACK_TRANSITIONS, 'Gtk.StackTransitionType')).toThrow(
                'is not a Gtk.StackTransitionType',
            );
        });

        await it('refuses a constant past the end, and a non-integer', () => {
            expect(() => transitionNick(99, GTK_REVEALER_TRANSITIONS, 'Gtk.RevealerTransitionType')).toThrow();
            expect(() => transitionNick(1.5, GTK_REVEALER_TRANSITIONS, 'Gtk.RevealerTransitionType')).toThrow();
        });

        await it('a revealer-only member is not a stack member, and the other way round', () => {
            expect(() => transitionNick('swing-up', GTK_STACK_TRANSITIONS, 'Gtk.StackTransitionType')).toThrow();
            expect(() => transitionNick('over-up', GTK_REVEALER_TRANSITIONS, 'Gtk.RevealerTransitionType')).toThrow();
        });
    });
};
