// Where the token scales and the stylesheet come from.
//
// ADR 0032 § 3: the class FAMILIES are declared in `@gjsify/gtk-host/style`, the
// VALUES belong to the project. So something has to hand them in, and it cannot be
// a prop — `className="mt-2xs"` on a leaf component is thirty levels below wherever
// the token file is imported.
//
// A MODULE-LEVEL CONFIGURATION AND NOT A REACT CONTEXT, deliberately. L2 takes the
// tokens as a parameter (see `intents.ts`' answer to ADR 0032 § 6), and a context
// would make React the only framework that can supply them — the Vue and Solid
// adapters would each need their own carrier for a value that does not vary within
// a process. There is exactly one token scale per application, and a module-level
// value is what that is.
//
// The default is `MINIMAL_TOKENS`, which is deliberately tiny (`0`, `px`, four
// radii, four weights, seven opacities). A project that has not configured anything
// therefore gets a NAMED ERROR listing what the scale does hold the first time it
// writes `mt-2xs` — which is the intended outcome, and the reason the default is
// not a copy of Tailwind's own scales: a large default would let a typo resolve
// against a value nobody chose.

import { MINIMAL_TOKENS, StyleSheet as GeneratedStyleSheet, type StyleTokens } from '@gjsify/gtk-host/style';

import type { ClassNameSink } from './primitives/style.js';

export interface StyleConfig {
    readonly tokens: StyleTokens;
    /** Where a declaration set becomes a class name. Defaults to one generated sheet. */
    readonly sheet: ClassNameSink;
}

let tokens: StyleTokens = MINIMAL_TOKENS;
let sheet: ClassNameSink | null = null;

/**
 * Install the project's token scales, and optionally its own sheet.
 *
 * Call it once, before the first render — `AppRegistry.runApplication`'s
 * `createWindow` runs after it, so module scope in the entry file is early enough.
 */
export function configureStyle(config: { readonly tokens?: StyleTokens; readonly sheet?: ClassNameSink }): void {
    if (config.tokens !== undefined) tokens = config.tokens;
    if (config.sheet !== undefined) sheet = config.sheet;
}

/**
 * The active configuration, building the default sheet on first use.
 *
 * LAZY because `StyleSheet` constructs a `Gtk.CssProvider` and installs it on the
 * default `Gdk.Display`. Building it at module scope would need a display at IMPORT
 * time, which is before `Gtk.init()` in every application — and the failure would
 * be an import that throws rather than a render that does.
 */
export function styleConfig(): StyleConfig {
    sheet ??= new GeneratedStyleSheet();
    return { tokens, sheet };
}

/** Test seam: back to `MINIMAL_TOKENS` and no sheet. */
export function resetStyleConfig(): void {
    tokens = MINIMAL_TOKENS;
    sheet = null;
}
