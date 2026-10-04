// `Gtk.RevealerTransitionType` and `Gtk.StackTransitionType` — accepted, not performed.
//
// A `.blp` writes `transition-type: slide_up;` on every revealer and stack it animates, and
// the shared-tree builder refuses a write to a property nothing declares. NativeScript's CSS
// subset has no transform or animation, so this port swaps `visibility` instantly (the same
// compromise `AdwViewStack` documents) — which makes the type a value the widget holds and
// reads back and never renders. It is still VALIDATED: a word that is not a member of the GIR
// enum is the caller's typo, and swallowing it would be the drop this package refuses
// everywhere else.
//
// The lists are the enum members in declaration order, so a position IS the constant
// (`GtkRevealerTransitionType.slide-up` is 4 in `generated/enum-values.mts`, which
// `transition-type.spec.ts` holds the lists against). Blueprint spells a member with
// underscores (`slide_up`) and GJS with the nick (`slide-up`); both mean the same member.
//
// Reference: refs/gtk gtk/gtkrevealer.h (GtkRevealerTransitionType)
// Reference: refs/gtk gtk/gtkstack.h (GtkStackTransitionType)
// Copyright (c) The GTK Team. LGPLv2.1+.

export const GTK_REVEALER_TRANSITIONS = [
    'none',
    'crossfade',
    'slide-right',
    'slide-left',
    'slide-up',
    'slide-down',
    'swing-right',
    'swing-left',
    'swing-up',
    'swing-down',
    'fade-slide-right',
    'fade-slide-left',
    'fade-slide-up',
    'fade-slide-down',
] as const;

export const GTK_STACK_TRANSITIONS = [
    'none',
    'crossfade',
    'slide-right',
    'slide-left',
    'slide-up',
    'slide-down',
    'slide-left-right',
    'slide-up-down',
    'over-up',
    'over-down',
    'over-left',
    'over-right',
    'under-up',
    'under-down',
    'under-left',
    'under-right',
    'over-up-down',
    'over-down-up',
    'over-left-right',
    'over-right-left',
    'rotate-left',
    'rotate-right',
    'rotate-left-right',
] as const;

export type GtkRevealerTransitionNick = (typeof GTK_REVEALER_TRANSITIONS)[number];
export type GtkStackTransitionNick = (typeof GTK_STACK_TRANSITIONS)[number];

/** `GtkStack:transition-duration` default, in ms. */
export const DEFAULT_STACK_TRANSITION_DURATION = 200;

/** `GtkRevealer:transition-duration` default, in ms. */
export const DEFAULT_REVEALER_TRANSITION_DURATION = 250;

/**
 * The nick a transition write means: a nick, its Blueprint underscore spelling, or the
 * constant — or throw, naming the members.
 */
export function transitionNick<Nick extends string>(value: unknown, members: readonly Nick[], property: string): Nick {
    if (typeof value === 'number' && Number.isInteger(value) && members[value] !== undefined) return members[value]!;
    if (typeof value === 'string') {
        const nick = value.trim().replaceAll('_', '-');
        const found = members.find((member) => member === nick);
        if (found !== undefined) return found;
    }
    throw new TypeError(`'${String(value)}' is not a ${property}. The members are ${members.join(', ')}.`);
}
