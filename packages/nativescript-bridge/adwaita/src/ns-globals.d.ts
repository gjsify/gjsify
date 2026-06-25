// Ambient declarations for the NativeScript runtime GLOBALS this package uses.
//
// `registerElement` / `registerModule` are NOT exported from `@nativescript/core`;
// the NativeScript bundler context (`@nativescript/webpack`'s xml-namespace-loader
// or `@nativescript/vite`'s ns-bundler-context) injects them as runtime globals
// — exactly the way GJS injects `imports.gi.*`, and the way this workspace's
// `@gjsify/native-{fs,platform}-bridge` key on the global `java` / `NSFileManager`.
// We type them here so `registerAdwaitaElements()` can call them without an import
// and the package still type-checks off-device (where they are `undefined`).

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
