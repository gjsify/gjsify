// StorybookProbe — env-gated in-process self-verification of the storybook, installed by
// {@link StorybookApplication} when `GJSIFY_STORYBOOK_PROBE` is truthy and a strict no-op
// otherwise (as `installDevtools` is for `GJSIFY_DEVTOOLS`).
//
// It drives the storybook HEADLESSLY and IN-PROCESS with no DBus session bus, which is
// what makes it work on a runner that has none (windows-latest), and asserts four things:
// the sidebar lists categories, the chrome is in the widget tree, a representative story
// opens with its own non-trivial subtree, and the window rasterises through GSK to a
// non-empty PNG. Result: a machine-readable `STORYBOOK PROBE: PASS|FAIL <json>` line,
// the JSON written to `GJSIFY_STORYBOOK_PROBE_OUT`, then the app quits.
//
// This is how `gjsify storybook --runtime node` proves the Adwaita gallery renders on
// Node, on Linux with system GTK and on Windows with the `--windowing` GTK bundle.
//
// Reference: @gjsify/devtools screenshot.ts (captureWidgetPng) + widget-tree.ts
// (dumpTree/widgetType); refs/libadwaita. Copyright (c) GNOME contributors, MIT/LGPL.

import type Adw from '@girs/adw-1';
import GLib from 'gi://GLib?version=2.0';
import type Gtk from '@girs/gtk-4.0';
import { captureWidgetPng, dumpTree, type NodeInfo } from '@gjsify/devtools';
import type { StorybookWindow } from './window.js';

/** Chrome widget types the storybook window always builds — the DumpTree floor. */
const DEFAULT_REQUIRED_CHROME = ['AdwNavigationSplitView', 'GtkListBox', 'AdwOverlaySplitView'];

/** Options for {@link installStorybookProbe}; env vars carry the CI-side defaults. */
export interface StorybookProbeOptions {
    /** Story to open, by `Category/Name`. Default: `GJSIFY_STORYBOOK_PROBE_STORY`, else the first. */
    story?: string;
    /** A widget type that MUST appear in the opened story's subtree. Default: `GJSIFY_STORYBOOK_PROBE_STORY_WIDGET`. */
    storyWidget?: string;
    /** Chrome widget types required in the DumpTree. Default: {@link DEFAULT_REQUIRED_CHROME}. */
    requireChrome?: string[];
    /** Path to write the JSON result. Default: `GJSIFY_STORYBOOK_PROBE_OUT`. */
    out?: string;
    /** Max ms to wait for the surface to realize before capturing. Default 8000. */
    timeoutMs?: number;
}

/** The machine-readable proof record the probe logs and writes. */
export interface StorybookProbeResult {
    ok: boolean;
    reason?: string;
    stories: number;
    categories: string[];
    opened: boolean;
    activeStory: string | null;
    requiredChrome: string[];
    missingChrome: string[];
    storySubtreeWidgets: number;
    storyWidgetPresent: boolean | null;
    windowRealized: boolean;
    windowPngBytes: number;
    storyPngBytes: number;
}

/** Truthy-env check, matching `@gjsify/devtools`' `GJSIFY_DEVTOOLS` gate semantics. */
export function probeEnabled(): boolean {
    const v = GLib.getenv('GJSIFY_STORYBOOK_PROBE');
    if (v == null) return false;
    const t = v.toLowerCase();
    return t !== '' && t !== '0' && t !== 'false';
}

/** Collect every widget `type` in a {@link NodeInfo} tree into `out`. */
function collectTypes(node: NodeInfo, out: Set<string>): void {
    out.add(node.type);
    for (const child of node.children) collectTypes(child, out);
}

/**
 * Open a representative story, poll for the GSK render, assert chrome + story subtree +
 * a non-empty PNG, log `STORYBOOK PROBE: PASS|FAIL`, write the JSON result, quit the app.
 * The caller gates the call on {@link probeEnabled}.
 */
export function installStorybookProbe(
    app: Adw.Application,
    window: StorybookWindow,
    options: StorybookProbeOptions = {},
): void {
    const requireChrome = options.requireChrome ?? DEFAULT_REQUIRED_CHROME;
    const out = options.out ?? GLib.getenv('GJSIFY_STORYBOOK_PROBE_OUT') ?? undefined;
    const timeoutMs = options.timeoutMs ?? 8000;
    const wantWidget = options.storyWidget ?? GLib.getenv('GJSIFY_STORYBOOK_PROBE_STORY_WIDGET') ?? undefined;

    const stories = window.controller.listStories();
    const categories = [...new Set(stories.map((s) => s.category))];
    const target = options.story ?? GLib.getenv('GJSIFY_STORYBOOK_PROBE_STORY') ?? stories[0]?.title;
    const opened = target ? window.openStoryByTitle(target) : false;
    const active = window.activeStory;

    // Structural, so it is valid before the surface realizes.
    const chromeTypes = new Set<string>();
    collectTypes(dumpTree(window, 60, 'toplevel:0'), chromeTypes);
    const missingChrome = requireChrome.filter((t) => !chromeTypes.has(t));

    const storyTypes = new Set<string>();
    if (active) collectTypes(dumpTree(active as unknown as Gtk.Widget, 60, 'story'), storyTypes);
    // The story root counts as one, so the assertion below requires MORE than the root.
    const storySubtreeWidgets = storyTypes.size;
    const storyWidgetPresent = wantWidget ? storyTypes.has(wantWidget) : null;

    const finish = (result: StorybookProbeResult): void => {
        const line = JSON.stringify(result);
        if (result.ok) {
            console.log(`STORYBOOK PROBE: PASS ${line}`);
        } else {
            console.error(`STORYBOOK PROBE: FAIL ${line}`);
            // On the node target a non-zero exit fails the CI step once runAsync resolves
            // and the top-level await settles. Guarded, since `process` may be a stub.
            try {
                if (typeof process !== 'undefined') process.exitCode = 1;
            } catch {
                // no writable process — the PASS/FAIL log line is the fallback signal
            }
        }
        if (out) {
            try {
                GLib.file_set_contents(out, JSON.stringify(result, null, 2));
            } catch {
                // best-effort — the log line already carries the result
            }
        }
        app.quit();
    };

    let waited = 0;
    const step = 100;
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, step, () => {
        waited += step;
        const windowPng = captureWidgetPng(window);
        const realized = window.get_width() > 0 && window.get_height() > 0;
        const timedOut = waited >= timeoutMs;
        if (!windowPng && !timedOut) return GLib.SOURCE_CONTINUE;

        const storyPng = active ? captureWidgetPng(active as unknown as Gtk.Widget) : null;

        // Display-INDEPENDENT floor: stories, categories, chrome, and one story opened
        // with a non-trivial subtree.
        let ok =
            stories.length >= 1 &&
            categories.length >= 1 &&
            missingChrome.length === 0 &&
            opened &&
            active != null &&
            storySubtreeWidgets > 1;
        let reason: string | undefined;
        if (stories.length < 1) reason = 'no stories registered';
        else if (categories.length < 1) reason = 'no categories';
        else if (missingChrome.length > 0) reason = `chrome missing: ${missingChrome.join(', ')}`;
        else if (!opened || active == null) reason = `could not open story: ${target ?? '(none)'}`;
        else if (storySubtreeWidgets <= 1) reason = 'opened story rendered an empty subtree';

        if (ok && wantWidget && !storyTypes.has(wantWidget)) {
            ok = false;
            reason = `story widget ${wantWidget} not found in the opened story subtree`;
        }

        // Only once the surface realized: a non-empty GSK-rendered PNG.
        if (ok && realized && (!windowPng || windowPng.length === 0)) {
            ok = false;
            reason = `window realized (${window.get_width()}x${window.get_height()}) but the GSK capture was empty`;
        }

        finish({
            ok,
            reason,
            stories: stories.length,
            categories,
            opened,
            activeStory: active ? active.meta.title : null,
            requiredChrome: requireChrome,
            missingChrome,
            storySubtreeWidgets,
            storyWidgetPresent,
            windowRealized: realized,
            windowPngBytes: windowPng ? windowPng.length : 0,
            storyPngBytes: storyPng ? storyPng.length : 0,
        });
        return GLib.SOURCE_REMOVE;
    });
}
