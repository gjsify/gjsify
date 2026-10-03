// The GTK/GDK reach behind `on('Gl', …)`, split out of `index.ts` on purpose: `index.ts` is in
// EVERY `@gjsify/unit` consumer's module graph, and a `--app gjs`/`--app node` build keeps an
// externalized `gi://` specifier's TEXT verbatim in its output for the native loader to resolve
// (see `externalsPlugin` in `@gjsify/rolldown-plugin-gjsify`) — so a `gi://Gtk`/`gi://Gdk` import
// anywhere in `index.ts` landed in every test bundle whether or not a suite ever asked about GL,
// tripping a consumer's headless-bundle guard that scans built bundles for GUI typelib imports
// (`gi://Gtk` found in `dist/test.gjs.mjs` even though no test used `on('Gl', …)`). Importing
// THIS module — `@gjsify/unit/gl` — is what pulls GTK/GDK into the graph; a suite that never
// imports it never carries the specifier, and `on('Gl', …)` answers "no prober registered" (a
// skip, not a crash).
//
// A suite that uses `on('Gl', …)` must `import '@gjsify/unit/gl';` once, anywhere in its entry
// file, before `run()` — see `packages/framework/webgl/src/ts/test.ts` for the pattern.

import { registerGlProbe } from './index.js';

/**
 * The slice of GTK/GDK the GL probe calls — typed at the call surface rather than
 * importing the GTK typings into a runner that must load without GTK.
 */
interface GlProbeGi {
    Gtk: { init_check(): boolean };
    Gdk: {
        Display: { get_default(): { create_gl_context(): { realize(): boolean } } | null };
        GLContext: { clear_current(): void };
    };
}

/** The message of whatever was thrown, for a diagnostic that must not throw itself. */
const errorMessage = (error: unknown): string => (error as { message?: string })?.message ?? String(error);

/**
 * Load GTK/GDK the portable way: `gi://`, which GJS resolves natively and the node target
 * rewrites to a LAZY `@gjsify/node-gi` proxy (resolved on first access, so a node bundle without
 * node-gi throws HERE, inside the probe, and answers no), and a browser build maps to an empty
 * module (no `default`, answers no). NOT `globalThis.imports.gi`: that object is the GJS host, and
 * on node it exists only when a build predicted the bundle needed it (see
 * docs/code-anti-patterns.md).
 */
const loadGlProbeGi = async (): Promise<GlProbeGi> => {
    const [gtk, gdk] = await Promise.all([
        import('gi://Gtk?version=4.0' as string) as Promise<{ default?: GlProbeGi['Gtk'] }>,
        import('gi://Gdk?version=4.0' as string) as Promise<{ default?: GlProbeGi['Gdk'] }>,
    ]);
    if (!gtk.default || !gdk.default) throw new Error('no GTK 4 reachable from this runtime');
    return { Gtk: gtk.default, Gdk: gdk.default };
};

/**
 * Realize a GL context through GDK, and report whether that worked.
 *
 * The question `on('Gl')` asks, asked directly: every WebGL spec behind it gets its context from
 * a `Gtk.GLArea`, i.e. from exactly this GDK call chain.
 *
 * A failure is the ANSWER, not an error to hide: `create_gl_context()` and `realize()` report a
 * host without GL by throwing a GError — measured on a win32 VM with no OpenGL ICD, "No GL
 * implementation is available" (#1097). `index.ts` caches the result and only ever calls this once
 * per process, behind `canRealizeSurface`, so it never tries to open a display on a host that has
 * none.
 */
const realizeGlContext = async (): Promise<{ ok: boolean; failure: string }> => {
    try {
        const { Gtk, Gdk } = await loadGlProbeGi();
        if (!Gtk.init_check()) throw new Error('Gtk.init_check() could not open the display');
        const display = Gdk.Display.get_default();
        if (!display) throw new Error('GDK has no default display');
        display.create_gl_context().realize();
        Gdk.GLContext.clear_current();
        return { ok: true, failure: '' };
    } catch (error) {
        return { ok: false, failure: errorMessage(error) };
    }
};

registerGlProbe(realizeGlContext);
