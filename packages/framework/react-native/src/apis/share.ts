// `Share` — the clipboard, because a desktop has no share sheet.
//
// The support table's planning entry named `clipboard + Gtk.UriLauncher`, and the
// second half is not used here. That is a decision rather than an omission:
// `Gtk.UriLauncher` OPENS a URI in another application, and opening a link is the
// opposite of sharing it — a `<Pressable onPress={() => Share.share({ url })}>`
// that navigated the user away from the app would be a share sheet's exact
// behavioural inverse. `Linking.openURL` is where that call belongs and where it
// is. The support table's `gtk` field is corrected to `Gdk.Clipboard` to match.
//
// TWO MEASUREMENTS. `Gdk.Clipboard.set_text` DOES NOT EXIST under introspection
// (`cb.set_text is not a function`, gjs 1.88.1) — the C convenience is variadic and
// not in the typelib. The introspectable route is `clipboard.set(value)`, ONE
// argument, and it round-trips: measured, `set('hello one arg')` followed by
// `read_text_async` read back `"hello one arg"`. `@girs/gdk-4.0` types it as
// `set(value: GObject.Value | any)`, so a string passes the type check as well as
// the runtime.
//
// WHAT `action` REPORTS AND WHY IT IS ALWAYS `sharedAction`. React Native's
// `dismissedAction` means "the user closed the share sheet without choosing".
// Nothing here asks the user anything, so there is no dismissal that can occur —
// reporting one would be inventing an event. `dismissedAction` is still exported,
// because ported code compares against it and an absent constant is a
// `MISSING_EXPORT` rather than a comparison that is simply never true.

import Gdk from 'gi://Gdk?version=4.0';

import { PrimitiveError } from '../primitives/errors.js';

/** React Native's `ShareContent`, as much of it as a clipboard can carry. */
export interface ShareContent {
    readonly message?: string;
    readonly url?: string;
    /** Carried for parity and unused: a clipboard has no title. */
    readonly title?: string;
}

export interface ShareAction {
    readonly action: 'sharedAction' | 'dismissedAction';
    /** Always undefined: there is no activity to name. */
    readonly activityType?: string;
}

export const Share = {
    /** React Native's own two constants. */
    sharedAction: 'sharedAction' as const,
    dismissedAction: 'dismissedAction' as const,

    /**
     * Put the shared text on the clipboard.
     *
     * `message` and `url` are joined with a newline when both are given, which is
     * what every desktop "copy link" affordance produces and what a user pasting
     * into a message expects. Neither given is a named refusal rather than an empty
     * clipboard: clearing the user's clipboard because a call site forgot its
     * payload is a destructive no-op.
     */
    share(content: ShareContent): Promise<ShareAction> {
        const parts = [content.message, content.url].filter(
            (part): part is string => typeof part === 'string' && part !== '',
        );
        if (parts.length === 0) {
            throw new PrimitiveError(
                'Share',
                'share',
                'was given neither `message` nor `url`. There is nothing to put on the clipboard, and writing an empty string there would DISCARD whatever the user had copied',
            );
        }
        const display = Gdk.Display.get_default();
        if (display === null) {
            throw new PrimitiveError(
                'Share',
                'share',
                'needs a `Gdk.Display` to reach the clipboard, and there is none — this ran before `Gtk.init()` or outside a session',
            );
        }
        display.get_clipboard().set(parts.join('\n'));
        return Promise.resolve({ action: Share.sharedAction });
    },
} as const;
