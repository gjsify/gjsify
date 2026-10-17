// `GtkCheckButton:group` as observable behaviour: exclusivity, joining, leaving, and the active
// member a user cannot click off. The SAME vectors run on real `gi://Gtk` (the ORACLE: a vector
// that fails there is wrong, never a port bug) and on each port's check button.
//
// Reference: refs/gtk/gtk/gtkcheckbutton.c:395-396,617-622,932-974,1088-1144
// Copyright (c) The GTK Team. LGPLv2.1+.

import type { ConstructHarness } from './constructs.js';

/** The part of a check button the vectors touch, spelled as GJS has it. */
export interface CheckButtonLike {
    active: boolean;
    set_active(active: boolean): void;
    get_active(): boolean;
    set_group(group: CheckButtonLike | null): void;
}

export interface CheckGroupSubject {
    readonly name: string;
    readonly isOracle: boolean;
    /** A fresh, inactive check button. */
    make(): CheckButtonLike;
    /** Activates `button` the way a user does (`gtk_widget_activate`, a click, a tap). */
    activate(button: CheckButtonLike): void;
    /** Counts `toggled` on `button` from now on; the returned function reads the count. */
    countToggled(button: CheckButtonLike): () => number;
}

export interface CheckGroupVector {
    readonly row: string;
    readonly rule: string;
    readonly observe: (subject: CheckGroupSubject) => unknown;
    readonly shows: unknown;
}

const actives = (buttons: CheckButtonLike[]): boolean[] => buttons.map((button) => button.active);

function trio(subject: CheckGroupSubject): CheckButtonLike[] {
    const buttons = [subject.make(), subject.make(), subject.make()];
    buttons[1].set_group(buttons[0]);
    buttons[2].set_group(buttons[0]);
    return buttons;
}

export const CHECK_GROUP_VECTORS: readonly CheckGroupVector[] = [
    {
        row: 'exclusive',
        rule: 'activating a member deactivates the one that was active (gtkcheckbutton.c:955-968)',
        observe(subject) {
            const buttons = trio(subject);
            buttons[0].active = true;
            const seen = [actives(buttons)];
            buttons[1].set_active(true);
            seen.push(actives(buttons));
            return seen;
        },
        shows: [
            [true, false, false],
            [false, true, false],
        ],
    },
    {
        row: 'join-through-member',
        rule: 'set_group with any member joins that whole group',
        observe(subject) {
            const [a, b, c] = [subject.make(), subject.make(), subject.make()];
            b.set_group(a);
            c.set_group(b);
            a.active = true;
            c.active = true;
            return actives([a, b, c]);
        },
        shows: [false, false, true],
    },
    {
        row: 'join-keeps-state',
        rule: 'joining a group changes no `active`, even when two members are then active',
        observe(subject) {
            const [a, b] = [subject.make(), subject.make()];
            a.active = true;
            b.active = true;
            b.set_group(a);
            return actives([a, b]);
        },
        shows: [true, true],
    },
    {
        row: 'leave',
        rule: 'set_group(null) takes the button out: it no longer deactivates the others',
        observe(subject) {
            const buttons = trio(subject);
            buttons[2].set_group(null);
            buttons[0].active = true;
            buttons[2].active = true;
            return actives(buttons);
        },
        shows: [true, false, true],
    },
    {
        row: 'no-click-off',
        rule: 'a user cannot activate the active member of a group off (gtkcheckbutton.c:617-622)',
        observe(subject) {
            const buttons = trio(subject);
            buttons[1].active = true;
            subject.activate(buttons[1]);
            return actives(buttons);
        },
        shows: [false, true, false],
    },
    {
        row: 'click-selects',
        rule: 'a user activating an inactive member selects it and deactivates the active one',
        observe(subject) {
            const buttons = trio(subject);
            buttons[0].active = true;
            subject.activate(buttons[2]);
            return actives(buttons);
        },
        shows: [false, false, true],
    },
    {
        row: 'ungrouped-toggles',
        rule: 'a button without a group still toggles off when activated',
        observe(subject) {
            const button = subject.make();
            button.active = true;
            subject.activate(button);
            return button.get_active();
        },
        shows: false,
    },
    {
        row: 'toggled',
        rule: '`toggled` fires once on the button that lost and once on the one that won',
        observe(subject) {
            const buttons = trio(subject);
            buttons[0].active = true;
            const counts = buttons.map((button) => subject.countToggled(button));
            buttons[1].active = true;
            return counts.map((count) => count());
        },
        shows: [1, 1, 0],
    },
];

export async function driveCheckGroupVectors(
    subject: CheckGroupSubject,
    harness: ConstructHarness,
    vectors: readonly CheckGroupVector[] = CHECK_GROUP_VECTORS,
): Promise<void> {
    const { describe, it, expect } = harness;
    await describe(`${subject.name}: Gtk.CheckButton group`, async () => {
        for (const vector of vectors) {
            await it(`${vector.row}: ${vector.rule}`, async () => {
                const observed = await vector.observe(subject);
                expect(JSON.stringify(observed)).toBe(JSON.stringify(vector.shows));
            });
        }
    });
}
