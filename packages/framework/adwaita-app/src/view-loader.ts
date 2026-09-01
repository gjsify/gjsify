// @gjsify/adwaita-app — async-view mounter.
// A view that reloads from an async source must (a) show a spinner while
// loading, (b) drop a result that a newer reload has superseded, and (c) show
// an error page on failure. `LoadToken` + `loadIntoStack` capture that once.
//
// `import type Gtk` is erased at build time, so `LoadToken` is pure runtime and
// unit-tested on Node + GJS; only `loadIntoStack` needs a real `Gtk.Stack`.

import type Gtk from 'gi://Gtk?version=4.0';

/**
 * Monotonic counter guarding against stale async reloads: each load takes a
 * `next()` ticket and only applies its result while it is still `current`.
 */
export class LoadToken {
    private _current = 0;

    /** Begin a new load; returns its ticket. */
    next(): number {
        return ++this._current;
    }

    /** The most recently issued ticket. */
    get current(): number {
        return this._current;
    }
}

/** Options for {@link loadIntoStack}. */
export interface LoadIntoStackOptions<T> {
    /** The `Gtk.Stack` whose visible child is swapped between the three pages. */
    stack: Gtk.Stack;
    /** Shared token so a later reload supersedes an in-flight one. */
    token: LoadToken;
    /** Produce the view data (sync or async). */
    load: () => T | Promise<T>;
    /** Populate the content page from the loaded data. */
    fill: (data: T) => void;
    /** Stack child name shown while loading. Default `loading`. */
    loadingName?: string;
    /** Stack child name shown on success. Default `content`. */
    contentName?: string;
    /** Stack child name shown on failure. Default `error`. */
    errorName?: string;
    /** Called with the error before the error page is shown. */
    onError?: (error: unknown) => void;
}

/**
 * Run `load`, then `fill` + show the content page — unless a newer reload has
 * started (result dropped) or `load` throws (error page shown). Always shows the
 * loading page first. Never rejects.
 */
export function loadIntoStack<T>(options: LoadIntoStackOptions<T>): void {
    const loadingName = options.loadingName ?? 'loading';
    const contentName = options.contentName ?? 'content';
    const errorName = options.errorName ?? 'error';

    options.stack.set_visible_child_name(loadingName);
    const ticket = options.token.next();

    Promise.resolve()
        .then(options.load)
        .then((data) => {
            if (ticket !== options.token.current) return; // superseded by a newer reload
            options.fill(data);
            options.stack.set_visible_child_name(contentName);
        })
        .catch((error: unknown) => {
            if (ticket !== options.token.current) return;
            options.onError?.(error);
            options.stack.set_visible_child_name(errorName);
        });
}
