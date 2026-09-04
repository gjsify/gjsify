// Who owns the window's header bar when the tree is generated from the file system.
//
// THE PROBLEM IS THE FILE CONVENTION, not the widget mapping. `Adw.NavigationView`
// and `Adw.ViewStack`+`Adw.ViewSwitcher` are the right widgets, and an
// `Adw.NavigationPage` carries its own `Adw.HeaderBar` by design — so a `_layout`
// inside a `_layout` describes a header bar inside a header bar, and a five-tab
// application entered at its index route drew THREE, each with its own close button
// (#1460). In a hand-written Adwaita application the author places the bars, so the
// question never comes up; here nothing decided which level owns the chrome.
//
// THE RULE, and it is the one a hand-written application follows: **one header bar per
// window, owned by the OUTERMOST navigator; inner levels contribute their title
// widget to it rather than growing a second bar.** Three consequences, all of them
// load-bearing:
//
//   1. The outermost navigator claims the window's own header bar (`window-chrome.ts`)
//      and renders the chrome itself — but only if it will render a bar AT ALL, see
//      `useChrome`. For a `<Stack>` that means the PAGES carry it, which is Adwaita's
//      own composition and the only one where the back button and the page title
//      appear at all.
//   2. An inner `<Tabs>` puts its `Adw.ViewSwitcher` into the enclosing bar's title
//      slot — where a hand-written application puts it — instead of building a bar
//      around it. That is the contribution `titleSlot` carries.
//   3. Where a level genuinely needs its own bar and one already carries the window
//      controls above it — an inner `<Stack>`, whose pages need their own back
//      buttons — the bar is rendered WITHOUT them. `Adw.NavigationSplitView` splits
//      the same decoration across its two visible bars, which is why the invariant
//      holding all of this is "one set of window controls per side", not "one header
//      bar".
//
// SO THE WINDOW CONTROLS GO ON THE OUTERMOST BAR OF EACH PATH, and `decorated` is
// that one bit. It is NOT the same question as ownership, and conflating them was
// wrong twice — both caught by `windowChromeProblems`' other half, which refuses a
// window whose chrome draws nothing at all:
//
//   - a screen with `headerShown: false` has no bar, so a navigator inside it is
//     neither the owner nor decorated from above; with one bit for both, its fallback
//     bar dropped the controls and the window's ONLY header bar offered no way to
//     close it;
//   - a claim made unconditionally takes the window's bar from a root navigator that
//     renders none (`<Tabs headerShown={false}>`), which measured 0 mapped header bars
//     and no window control anywhere — on a window that was closable before.
//
// The contribution travels through a STATE UPDATE from the contributor's layout
// effect, which is upstream's own shape for the same problem (`navigation.setOptions`
// from a screen). React has no way for a child to render into an ancestor's subtree
// during the same pass, so the switcher lands on the commit after the page's, and
// `tabs.ts` wires the stack from the switcher's ref for exactly that reason.

import { createContext, createElement, useCallback, useContext, useLayoutEffect, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { RouterError } from './errors.js';
import { useWindowChrome } from '../window-chrome.js';

/** Where an inner level puts what it wants the window's one header bar to show. */
export interface ChromeSlot {
    /**
     * Set the owning header bar's title widget, or `null` to give it back.
     *
     * The element needs `slot: 'title'` — it is rendered as a child of the owner's
     * `AdwHeaderBar`, and that is `Adw.HeaderBar.set_title_widget`.
     */
    setTitleWidget(element: ReactElement | null): void;
}

/**
 * What a navigator finds at the level it was rendered.
 *
 * There is deliberately no "am I the owner" field: ownership is only ever the answer
 * to "who claims the window's bar", `useChrome` does that itself, and a navigator that
 * read it would be tempted to decide the window controls by it — which is the mistake
 * the header records.
 */
export interface Chrome {
    /** A header bar above already carries the window controls, so this level's must not. */
    readonly decorated: boolean;
    /** The enclosing header bar's title slot, or `null` when there is no bar above. */
    readonly titleSlot: ChromeSlot | null;
}

/** What a level publishes to the subtree below it. */
interface ChromeLevel {
    /** A navigator above already claimed the window's header bar. */
    readonly taken: boolean;
    /** A header bar between the window and here carries the window controls. */
    readonly decorated: boolean;
    /** That level's header bar title slot, when the level has a bar at all. */
    readonly titleSlot: ChromeSlot | null;
}

/** No navigator above, no bar above, nothing to contribute to — the outermost view. */
const OUTERMOST: ChromeLevel = { taken: false, decorated: false, titleSlot: null };

const ChromeContext = createContext<ChromeLevel>(OUTERMOST);

/**
 * Publish a level to everything a navigator renders below it.
 *
 * EVERY navigator has to do this for every screen it renders, including the ones with
 * no bar to contribute to (`titleSlot: null`): without it a nested navigator reads the
 * default and believes it is outermost, and its claim on the window's header bar is
 * then the second one — a refusal, at mount, in an application that was only nesting
 * two navigators.
 */
export const provideChromeLevel = (level: ChromeLevel, children: ReactNode): ReactElement =>
    createElement(ChromeContext.Provider, { value: level }, children);

/**
 * The level below a header bar: whatever else is true, the controls are accounted for.
 *
 * `decorated: true` unconditionally, and that is arithmetic rather than a choice — the
 * bar either carried the controls (because nothing above it had them) or something
 * above it did.
 */
export const underHeaderBar = (titleSlot: ChromeSlot | null): ChromeLevel => ({
    taken: true,
    decorated: true,
    titleSlot,
});

/** The level below a navigator level that rendered no bar: only ownership changed. */
export const withoutHeaderBar = (decorated: boolean): ChromeLevel => ({
    taken: true,
    decorated,
    titleSlot: null,
});

/**
 * What this navigator finds, and the window claim that goes with being outermost.
 *
 * `rendersChrome` is the navigator's own answer to "will I put a header bar at this
 * level at all", and the claim depends on it. A `<Tabs headerShown={false}>` or a
 * stack whose every screen sets `headerShown: false` renders no bar, and taking the
 * window's away would leave the window with NO chrome — an Adwaita window carries no
 * titlebar of its own, so that is a window that cannot be closed. Which is also why
 * `decorated` is TRUE in that case: the window's own bar is still there, carrying the
 * controls, and a bar further down must not carry a second set.
 *
 * The claim is a layout EFFECT with an undo, so a navigator that unmounts gives the
 * window its bar back — which is what makes a re-render, a route change and a
 * hot-reloaded root layout safe rather than one-shot.
 */
export function useChrome(navigator: string, rendersChrome: boolean): Chrome {
    const level = useContext(ChromeContext);
    const windowChrome = useWindowChrome();
    const outermost = !level.taken;
    const claims = outermost && rendersChrome;
    useLayoutEffect(() => {
        if (!claims || windowChrome === null) return;
        return windowChrome.claim(`<${navigator}>`);
    }, [claims, windowChrome, navigator]);
    const windowKeepsItsBar = outermost && !claims && windowChrome !== null;
    return { decorated: level.decorated || windowKeepsItsBar, titleSlot: level.titleSlot };
}

/** One title slot per header bar, plus whatever has been contributed to each. */
export interface TitleSlots {
    /** The widget contributed for this key, or `null` while nothing has been. */
    titleWidgetFor(key: string): ReactElement | null;
    /** The slot for this key, with an identity that survives every re-render. */
    slotFor(key: string): ChromeSlot;
}

/**
 * The contributions a navigator's header bars hold, keyed by bar.
 *
 * The slots are CACHED by key for the reason `usePageBindings` records one file over:
 * a fresh object per render would make the context value change on every commit and
 * re-run every consumer's effect, which for this consumer means clearing and
 * re-setting the contribution in a loop.
 *
 * A SECOND live contribution to one bar REFUSES. The cleanup in a contributor's
 * effect clears the slot before it re-runs, so the same contributor re-setting is
 * never the occupied case — an occupied slot means two navigators are pointing at one
 * title, and a silent overwrite would show one of them and lose the other with no
 * message anywhere.
 */
export function useTitleSlots(navigator: string): TitleSlots {
    const [widgets, setWidgets] = useState<Readonly<Record<string, ReactElement>>>({});
    // Beside `widgets` and not derived from it: the occupancy question is asked from
    // inside an effect, where the state of the render that is being committed is not
    // readable yet, and a stale answer there would let the second contributor through.
    const held = useRef(new Map<string, ReactElement>());
    const slots = useRef(new Map<string, ChromeSlot>());

    const slotFor = useCallback(
        (key: string): ChromeSlot => {
            const existing = slots.current.get(key);
            if (existing !== undefined) return existing;
            const slot: ChromeSlot = {
                setTitleWidget(element: ReactElement | null): void {
                    const current = held.current.get(key);
                    if (element === null) {
                        if (current === undefined) return;
                        held.current.delete(key);
                        setWidgets((previous) => {
                            const { [key]: _gone, ...rest } = previous;
                            return rest;
                        });
                        return;
                    }
                    if (current === element) return;
                    if (current !== undefined) {
                        throw new RouterError(
                            'chrome-taken',
                            `<${navigator}>`,
                            'was asked for a second title widget for one header bar. A window has one header bar ' +
                                'per level and that bar has one title, so two navigators inside the same screen ' +
                                'cannot both put their switcher in it — give one of them its own route group',
                        );
                    }
                    held.current.set(key, element);
                    setWidgets((previous) => ({ ...previous, [key]: element }));
                },
            };
            slots.current.set(key, slot);
            return slot;
        },
        [navigator],
    );

    const titleWidgetFor = useCallback((key: string): ReactElement | null => widgets[key] ?? null, [widgets]);
    return { titleWidgetFor, slotFor };
}
