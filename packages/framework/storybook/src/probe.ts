// StorybookProbe — env-gated in-process self-verification of the storybook.
//
// When `GJSIFY_STORYBOOK_PROBE` is truthy, {@link StorybookApplication} installs
// this probe after the window is populated + presented. It drives the storybook
// HEADLESSLY and IN-PROCESS — NO DBus session bus (unlike the `@gjsify/devtools`
// DBus surface), so it is robust on a CI runner with no session bus (windows-latest):
//
//   1. the sidebar lists the component categories (`controller.listStories()`),
//   2. the storybook CHROME is present in the widget tree (DumpTree — the
//      NavigationSplitView + the sidebar GtkListBox + the controls OverlaySplitView),
//   3. a representative story opens + renders its OWN widget subtree (DumpTree of
//      the active story, optionally asserting a specific widget type is present),
//   4. the window rasterises through the GSK renderer to a non-empty PNG (the same
//      in-process capture `@gjsify/devtools` `Screenshot` uses — render-to-texture,
//      no visible desktop needed).
//
// It logs a machine-readable `STORYBOOK PROBE: PASS|FAIL <json>` line, writes the
// JSON result to `GJSIFY_STORYBOOK_PROBE_OUT` when set, then quits the app (exit 0
// on PASS, `process.exitCode = 1` on FAIL).
//
// A STRICT no-op unless `GJSIFY_STORYBOOK_PROBE` is set, so a production
// `gjsify storybook` run is byte-unchanged (mirrors `installDevtools` /
// `GJSIFY_DEVTOOLS`). This is how `gjsify storybook --runtime node` (node-gi consumer
// #1) proves the full Adwaita gallery renders on Node — on Linux (system GTK) AND on
// Windows (the batteries-included `--windowing` GTK bundle, no gvsbuild).
//
// Reference: @gjsify/devtools screenshot.ts (captureWidgetPng) + widget-tree.ts
// (dumpTree/widgetType); refs/libadwaita. Copyright (c) GNOME contributors, MIT/LGPL.

import type Adw from '@girs/adw-1';
import GLib from '@girs/glib-2.0';
import type Gtk from '@girs/gtk-4.0';
import { captureWidgetPng, dumpTree, type NodeInfo } from '@gjsify/devtools';
import type { StorybookWindow } from './window.js';

/** Chrome widget types the storybook window always builds — the DumpTree floor. */
const DEFAULT_REQUIRED_CHROME = ['AdwNavigationSplitView', 'GtkListBox', 'AdwOverlaySplitView'];

/** Options for {@link installStorybookProbe} (env vars supply the CI-side defaults). */
export interface StorybookProbeOptions {
    /** Story `Category/Name` title to open as the representative render. Default: `GJSIFY_STORYBOOK_PROBE_STORY`, else the first story. */
    story?: string;
    /** A widget type (e.g. `AdwSwitchRow`) that MUST appear in the opened story's subtree. Default: `GJSIFY_STORYBOOK_PROBE_STORY_WIDGET`. */
    storyWidget?: string;
    /** Chrome widget types required in the DumpTree. Default: NavigationSplitView + sidebar ListBox + controls OverlaySplitView. */
    requireChrome?: string[];
    /** Path to write the JSON result. Default: `GJSIFY_STORYBOOK_PROBE_OUT`. */
    out?: string;
    /** Max ms to wait for the surface to realize before capturing. Default 8000. */
    timeoutMs?: number;
}

/** The result the probe logs + writes — the machine-readable proof record. */
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
 * Install the storybook self-verification probe. A no-op unless it is called
 * (the caller gates on {@link probeEnabled}). Opens a representative story, then
 * polls for the GSK render, asserts the chrome + story subtree + a non-empty PNG,
 * logs `STORYBOOK PROBE: PASS|FAIL`, writes the JSON result, and quits the app.
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

    // --- Drive synchronously: pick + open the representative story -----------
    const stories = window.controller.listStories();
    const categories = [...new Set(stories.map((s) => s.category))];
    const target = options.story ?? GLib.getenv('GJSIFY_STORYBOOK_PROBE_STORY') ?? stories[0]?.title;
    const opened = target ? window.openStoryByTitle(target) : false;
    const active = window.activeStory;

    // --- DumpTree the chrome (structural — valid before the surface realizes) -
    const chromeTypes = new Set<string>();
    collectTypes(dumpTree(window, 60, 'toplevel:0'), chromeTypes);
    const missingChrome = requireChrome.filter((t) => !chromeTypes.has(t));

    // --- DumpTree the opened story's OWN subtree -----------------------------
    const storyTypes = new Set<string>();
    if (active) collectTypes(dumpTree(active as unknown as Gtk.Widget, 60, 'story'), storyTypes);
    // The story root itself counts as one; require MORE than the bare root.
    const storySubtreeWidgets = storyTypes.size;
    const storyWidgetPresent = wantWidget ? storyTypes.has(wantWidget) : null;

    const finish = (result: StorybookProbeResult): void => {
        const line = JSON.stringify(result);
        if (result.ok) {
            console.log(`STORYBOOK PROBE: PASS ${line}`);
        } else {
            console.error(`STORYBOOK PROBE: FAIL ${line}`);
            // Node (the --app node target): a non-zero exit fails the CI step once
            // runAsync resolves + the top-level await settles. Guarded — harmless
            // where `process` is a stub.
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

    // --- Poll for the GSK render, then assert (mirrors widgets.test.mjs) ------
    let waited = 0;
    const step = 100;
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, step, () => {
        waited += step;
        const windowPng = captureWidgetPng(window);
        const realized = window.get_width() > 0 && window.get_height() > 0;
        const timedOut = waited >= timeoutMs;
        // Keep polling until a non-empty PNG is captured or the budget elapses.
        if (!windowPng && !timedOut) return GLib.SOURCE_CONTINUE;

        const storyPng = active ? captureWidgetPng(active as unknown as Gtk.Widget) : null;

        // MINIMUM tier (display-independent): stories + categories + chrome + a
        // representative story opened with a non-trivial subtree.
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

        // A requested story-widget type must appear in the opened story's subtree.
        if (ok && wantWidget && !storyTypes.has(wantWidget)) {
            ok = false;
            reason = `story widget ${wantWidget} not found in the opened story subtree`;
        }

        // STRONGER tier (when the surface realized): a non-empty GSK-rendered PNG.
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
