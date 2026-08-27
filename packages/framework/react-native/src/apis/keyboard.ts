// `Keyboard` — a declared no-op that refuses its EVENTS by name.
//
// Every member of this API is about an on-screen keyboard appearing and disappearing,
// and on a desktop neither happens. That makes the shape of the answer the whole
// question, and it is not "return something harmless":
//
// - `addListener` REFUSES. A subscription that resolves, hands back a
//   `{ remove }` and then never fires is the exact silent drop this layer exists to
//   remove — a `keyboardDidShow` handler that never runs looks like a bug in the
//   application's own code, for ever, and there is no message anywhere. Refusing names
//   the reason at the call site instead.
// - `dismiss` and `removeAllListeners` are NO-OPS, because "dismiss the keyboard" on a
//   desktop is a request that is already satisfied. Nothing was shown, so nothing has
//   to be hidden, and a throw there would break a `Keyboard.dismiss()` that ported
//   code sprinkles into every scroll handler.
// - `isVisible` answers FALSE and `metrics` answers `undefined`, which are React
//   Native's own answers for a hidden keyboard. A question with a correct answer gets
//   it; only the ones whose answer would have to be invented refuse.
//
// So the file is the same distinction the primitive table draws between an `ignored`
// route and a `refused` one, one layer up: a recognised name with nothing to do is not
// the same thing as a name whose contract cannot be honoured.

import { PrimitiveError } from '../primitives/errors.js';

/** React Native's `KeyboardEventName`, in full, so a refusal can name what was asked for. */
const EVENTS = [
    'keyboardWillShow',
    'keyboardDidShow',
    'keyboardWillHide',
    'keyboardDidHide',
    'keyboardWillChangeFrame',
    'keyboardDidChangeFrame',
] as const;

export const Keyboard = {
    /**
     * Refused by name. See the header: a listener that never fires is the silent drop.
     */
    addListener(eventName?: string): never {
        throw new PrimitiveError(
            'Keyboard',
            `addListener("${eventName ?? ''}")`,
            `reports an ON-SCREEN keyboard appearing or disappearing (${EVENTS.join(', ')}), and a desktop window never sees one — a hardware keyboard takes no space and has no frame. This refuses instead of handing back a subscription that never fires, because a handler that silently never runs is indistinguishable from a bug in your own code. Delete the subscription, or branch on Platform.OS`,
        );
    },

    /** A declared no-op: nothing is shown, so nothing has to be hidden. */
    dismiss(): void {},

    /** A declared no-op: `addListener` refuses, so there is nothing registered to remove. */
    removeAllListeners(): void {},

    /** False, always — React Native's own answer for a keyboard that is not up. */
    isVisible(): boolean {
        return false;
    },

    /** `undefined`, which is React Native's own answer while the keyboard is hidden. */
    metrics(): undefined {
        return undefined;
    },

    /**
     * Refused by name: it schedules a `LayoutAnimation`, which is tier P3.
     *
     * Not a keyboard question at all — it asks the animated layout subsystem to
     * animate the next commit. `LayoutAnimation` is `planned` for the same reason
     * `Animated` is: it is a subsystem, and doing it badly is worse than not doing it.
     */
    scheduleLayoutAnimation(): never {
        throw new PrimitiveError(
            'Keyboard',
            'scheduleLayoutAnimation',
            'asks the LayoutAnimation subsystem to animate the next layout pass. That is `LayoutAnimation`’s own entry (tier P3, `planned`) — an animated layout pass, not a keyboard behaviour — and it needs the same subsystem `Animated` does',
        );
    },
} as const;
