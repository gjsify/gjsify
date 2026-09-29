// SPDX-License-Identifier: MIT
// "This file is an input of the output" — `this.addWatchFile`, one layer down.
//
// Two of this package's plugins read a file the BUNDLER never sees: a
// stylesheet's `@import` chain (`css-as-string`) and a package's own
// `readFileSync(new URL(..., import.meta.url))` (the static-read inliner, which
// folds the bytes into the bundle). Neither file is a module, so no graph names
// it and a `gjsify test` bundle that depends on one reads as fresh after it
// changes. `this.addWatchFile` is the standard contract for exactly that, and
// this is the one place it is issued from.
//
// FEATURE-DETECTED, and that is measured, not defensive: the engine the GJS CLI
// loads is resolved through several anchors, and one of them answered with a
// build whose plugin context had no such method — a direct call then fails the
// build with `this.addWatchFile is not a function`. A build must not fail over
// bookkeeping, so a miss degrades to a single line naming the consequence and the
// fix. The other half is in the CLI: a bundle whose build reported NO watch list
// can never be called fresh (`utils/bundle-inputs.ts`).

/** One file the output depends on. */
export type DeclareBuildInput = (abs: string) => void;

/** A plugin context that MAY carry `addWatchFile` — an older engine does not. */
export interface WatchFileCapableContext {
    addWatchFile?: (id: string) => void;
}

let _warned = false;

/**
 * `this.addWatchFile(abs)`, or one line saying it was missing.
 *
 * The context is passed in rather than bound, so each caller keeps its own `this`
 * and this stays usable from any hook shape.
 */
export function declareBuildInput(ctx: WatchFileCapableContext, abs: string): void {
    if (typeof ctx.addWatchFile === 'function') {
        ctx.addWatchFile.call(ctx, abs);
        return;
    }
    if (_warned) return;
    _warned = true;
    console.warn(
        '[gjsify] this Rolldown engine has no `addWatchFile`, so a file a plugin read itself is ' +
            'not declared as a build input — editing one may leave a `gjsify test` bundle looking ' +
            'fresh. Upgrade `@gjsify/rolldown-native` (the GJS engine) to declare it.',
    );
}
