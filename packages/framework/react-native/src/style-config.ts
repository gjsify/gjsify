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
//
// WHAT THIS MODULE REPLACES, and the one thing a caller gets wrong: `tokens` is taken
// WHOLE. That is right — the values are the project's — and it is also why a project
// generating its scales from a Tailwind v4 `@theme` loses `0` and `full`, which
// nothing in a `@theme` was ever going to declare (measured on one production-shaped
// application: 81 of 87 distinct utilities and 803 of 826 occurrences resolve, and
// five of the six failures are exactly those two tokens). The remedy is an opt-in the
// caller can SEE:
//
//     configureStyle({ tokens: mergeTokens(TAILWIND_DEFAULT_TOKENS, projectTokens) });
//
// `mergeTokens` and NOT a spread — an object spread replaces whole SCALES, so a
// project declaring any `spacing` loses `0` again. Both are exported from
// `@gjsify/gtk-host/style`, and a scale miss whose token the defaults define names
// them in the error rather than leaving a reader to find this comment.

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
