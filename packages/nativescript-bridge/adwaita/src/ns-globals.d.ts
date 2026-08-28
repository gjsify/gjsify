// Ambient declarations for the NativeScript runtime GLOBALS this package uses.
//
// `registerElement` / `registerModule` are NOT exported from `@nativescript/core`;
// they are runtime globals, typed here so `registerAdwaitaElements()` can call
// them without an import and the package still type-checks off-device (where they
// are `undefined`) — the way this workspace's `@gjsify/native-{fs,platform}-bridge`
// key on the global `java` / `NSFileManager`.
//
// THE TWO ARE NOT THE SAME KIND OF GLOBAL, and this file used to say they were.
// `registerModule` is NativeScript's own (`@nativescript/core/globals`), always
// there. `registerElement` is a FRAMEWORK integration's — `@nativescript/angular`,
// `nativescript-vue` — and `@nativescript/core` 9.1 does not contain the
// identifier anywhere: measured on an Android emulator 2026-08-28, `typeof
// registerElement` is `undefined` in a plain app built with `@nativescript/vite`,
// while `typeof registerModule` is `function`. Declaring both as "the bundler
// context injects them" made `registerAdwaitaElements()`'s silent no-op read as a
// cold-start guard rather than as the whole story on that runtime.

import type { View } from '@nativescript/core';

/** Constructor signature NativeScript's element registry accepts. */
type ViewConstructor = new () => View;

declare global {
    /**
     * Register a custom element for XML use: `<MyElement>` then resolves to the
     * given constructor. Injected by the NativeScript bundler context.
     */
    function registerElement(elementName: string, resolver: () => ViewConstructor): void;

    /**
     * Register a code module under a path so XML `xmlns="~/path"` resolves. Some
     * NativeScript bundler contexts expose this instead of / alongside
     * `registerElement` (see the gjsify xmlns-barrel note in AGENTS.md).
     */
    function registerModule(name: string, loader: () => unknown): void;
}

export {};
