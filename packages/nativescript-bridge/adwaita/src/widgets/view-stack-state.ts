// AdwViewStack's NativeScript-specific half — the parts that are not the
// selection state machine.
//
// The selection itself (name lookup, index guards, the first-VISIBLE-page
// auto-pick, the remove/hide fallbacks and which paths notify) is HEADLESS and
// lives in `@gjsify/adwaita-core` as `ViewStackState` (ADR 0004), shared with
// `@gjsify/adwaita-web` and pinned by the conformance vectors. What is
// NativeScript-specific is only how a selection becomes pixels: NS has no page
// stack, so pages overlay in a `GridLayout` and swap by toggling `visibility`
// between `visible` and `collapse`.
//
// This module imports only TYPES from `@nativescript/core` — like `icon-path.ts`,
// `row-press.ts` and `avatar-color.ts` — so it carries no runtime
// `@nativescript/core` value import and loads, and is unit-testable, off-device.
// `adw-view-stack.ts` cannot serve that role: it `extends GridLayout`, which
// evaluates the bare specifier at module-eval and is unresolvable on GJS/Node.
// Before this split the NS suite tested a `MockViewStack` that transcribed the
// widget's own guards — a test that copies the code under test cannot detect the
// drift it exists to catch.
//
// Reference: refs/libadwaita/src/adw-view-stack.c (AdwViewStack)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import type { View } from '@nativescript/core';
import { ViewStackState } from '@gjsify/adwaita-core';
import type { AdwViewStackPageInfo, ViewStackStateChange } from '@gjsify/adwaita-core';

/** One page registered with an `AdwViewStack`, as a bound switcher reads it. */
export type AdwViewStackPage = AdwViewStackPageInfo<View>;

/** The two `View.visibility` values a stacked page ever takes. */
export type NsPageVisibility = 'visible' | 'collapse';

/** The selection machine an `AdwViewStack` delegates to, typed on the NS `View`. */
export function createViewStackState(): ViewStackState<View> {
    return new ViewStackState<View>();
}

/**
 * The `visibility` each page's content view must carry for the current
 * selection, in page order. Exactly one entry is `'visible'` — none when nothing
 * is selected, which is a real state here (an empty stack, every page hidden, or
 * the visible page removed).
 */
export function pageVisibilities(state: ViewStackState<View>): NsPageVisibility[] {
    const selected = state.visibleIndex;
    return state.pages.map((_page, index) => (index === selected ? 'visible' : 'collapse'));
}

/** Push {@link pageVisibilities} onto the real content views. */
export function applyViewStackVisibility(state: ViewStackState<View>): void {
    const visibilities = pageVisibilities(state);
    state.pages.forEach((page, index) => {
        if (page.content) page.content.visibility = visibilities[index]!;
    });
}

/** The data half of the `notify::visible-child` event (minus NS's `eventName`/`object`). */
export interface ViewStackNotifyPayload {
    /** The newly-visible page's index, `-1` when nothing is selected. */
    index: number;
    /** The newly-visible page's name, `''` when nothing is selected. */
    name: string;
    /** The newly-visible page's title, `''` when nothing is selected. */
    title: string;
    /** `false` for an auto-pick (add / hide / show), `true` for an explicit select. */
    interactive: boolean;
}

/**
 * Project a core change onto the event payload. Kept as a function rather than
 * spreading the change directly so the `page` descriptor — a live model object —
 * never leaks into an event a consumer might hold on to.
 */
export function viewStackNotifyPayload(change: ViewStackStateChange<View>): ViewStackNotifyPayload {
    return { index: change.index, name: change.name, title: change.title, interactive: change.interactive };
}
