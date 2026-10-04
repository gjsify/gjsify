// Which template constructs `adwaita-nativescript`'s tree builder builds (ADR 0093 § 2). Pure
// data, so a build plugin can read it without importing the renderer.
//
// MUST NOT IMPORT `@nativescript/core`, directly or through a widget: the plugin loads this at
// build time under Node, and the reachability rule in `packages/nativescript-bridge/AGENTS.md`
// keeps the package's value imports out of anything a tool reads.

import type { ConstructCapabilities } from '@gjsify/adwaita-core/conformance';

export const capabilities: ConstructCapabilities = {
    layout: 'implemented',
    strings: 'implemented',
    responses: 'implemented',
    page: {
        refused:
            'adwaita-nativescript builds no pages: there is no NS widget yet for Gtk.Notebook, and Gtk.StackPage is not on this branch',
    },
    extern: 'implemented',
    signal: 'implemented',
    bind: 'implemented',
    breakpoint: {
        refused: 'the builder does not wire a breakpoint yet; the next commit does (ADR 0093 step 5)',
    },
};
