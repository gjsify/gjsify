// `Dimensions` — the WINDOW, and the screen only when the screen is what was asked for.
//
// ADR 0032's planning entry says "window size, not screen size — a desktop app is not
// full-screen", and that is a decision about which number answers
// `Dimensions.get('window')`. It is not a decision to refuse `'screen'`: a monitor is
// a real thing and asking for it is a different question, answered by
// `apis/display.ts` from the monitor the window is on.
//
// The measurements and their preconditions are in `apis/display.ts`. The one that
// shapes this file: there is no window before the application builds one, and
// `Dimensions.get` is synchronous with no honest zero to return — so it throws by
// name, which is the difference between "you read this too early" and a layout
// computed from 0.

import { onWindowMetricsChange, screenMetrics, windowMetrics, type DisplayMetrics } from './display.js';
import { PrimitiveError } from '../primitives/errors.js';
import type { EventSubscription } from '../event-emitter.js';

/** React Native's own two dimension keys. */
export type DimensionKey = 'window' | 'screen';

export const Dimensions = {
    /**
     * The size of the window, or of the monitor it is on.
     *
     * A named throw for an unknown key rather than `undefined`: React Native's own
     * `get` throws too, and the shape of the failure matters here — the caller is
     * about to read `.width` off the answer.
     */
    get(dimension: DimensionKey): DisplayMetrics {
        if (dimension === 'window') return windowMetrics();
        if (dimension === 'screen') return screenMetrics();
        throw new PrimitiveError(
            'Dimensions',
            `get("${String(dimension)}")`,
            'is not a dimension React Native defines. It has two: "window" (the application window, which is what a desktop layout is about) and "screen" (the monitor it is on)',
        );
    },

    /**
     * Re-render on resize, imperatively.
     *
     * React Native's own event name is `'change'` and its payload carries BOTH
     * dimensions, which is why the listener is handed both rather than the one that
     * moved: a window dragged to another monitor changes `screen` without changing
     * `window`, and a subscriber that only saw the window's number would miss it.
     *
     * `screen` is read defensively — a display with no monitors is a headless session
     * and `screenMetrics` refuses it by name — because a resize notification must not
     * be lost to a question the subscriber did not ask. `window` is not: this callback
     * only fires while a window exists.
     */
    addEventListener(type: 'change', listener: (metrics: DimensionsPayload) => void): EventSubscription {
        if (type !== 'change') {
            throw new PrimitiveError(
                'Dimensions',
                `addEventListener("${String(type)}")`,
                'is not an event React Native defines. There is one: "change"',
            );
        }
        const dispose = onWindowMetricsChange(() => {
            listener({ window: windowMetrics(), screen: safeScreen() });
        });
        return { remove: dispose };
    },

    /**
     * Refused by name: React Native's native side calls it to PUBLISH the numbers.
     *
     * It is not an application API — `Dimensions.set` is how the bridge tells
     * JavaScript what the device measured. There is no bridge here; GTK is asked
     * directly, every time, so there is nothing to store and a stored value would be
     * a second answer that could disagree with the window.
     */
    set(): never {
        throw new PrimitiveError(
            'Dimensions',
            'set',
            'is how React Native’s native side PUBLISHES the device metrics to JavaScript. There is no bridge here — GTK is asked directly on every `get`, so a value set from outside would be a second answer that could disagree with the window it describes',
        );
    },
} as const;

/** What a `'change'` listener receives — React Native's own payload shape. */
export interface DimensionsPayload {
    readonly window: DisplayMetrics;
    readonly screen: DisplayMetrics | null;
}

/**
 * The monitor's metrics, or null in the one session that has none.
 *
 * The `catch` is NOT defensive padding and it is the only one in this file: the
 * subscriber asked about the window, and refusing to deliver a resize because a
 * headless session has no monitor would drop the event the API exists for.
 * `Dimensions.get('screen')` still refuses that session by name, which is where the
 * question was actually asked.
 */
function safeScreen(): DisplayMetrics | null {
    try {
        return screenMetrics();
    } catch (error) {
        if (error instanceof PrimitiveError) return null;
        throw error;
    }
}
