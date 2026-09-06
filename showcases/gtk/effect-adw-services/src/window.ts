// SPDX-License-Identifier: MIT
//
// The window class `window.blp` is a template for, and the one place in this
// showcase where Effect and GTK touch.
//
// THE SHAPE, in one sentence: the widget tree is Blueprint's, the reading is
// Effect's, and the only thing crossing between them is a `Scope` that GTK closes
// and a `Stream` that GTK fills. Effect renders nothing here — there is no Effect
// UI layer in this file, on purpose. This repo already has three renderers bound
// to `@gjsify/gtk-host` (React, Vue, Solid); an Effect app on GNOME wants the
// service layer, not a fourth.
//
// WHY `switchMap` IS THE INTERESTING LINE. Typing a path emits one element per
// keystroke. Each element starts a directory read. `switchMap` interrupts the
// previous read when the next element arrives — and because the read is built on
// `Effect.callback` with the `AbortSignal` wired to a `Gio.Cancellable`, that
// interruption reaches GIO and stops the in-flight I/O rather than merely
// discarding its result. That is the capability this integration exists for; the
// two counters in the interface are there to make it visible rather than claimed.

import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

import { Duration, Effect, Layer, Stream } from 'effect';
import * as FileSystem from 'effect/FileSystem';
import * as Path from 'effect/Path';

import Template from './window.blp';

import { fileSystemLayer, pathLayer } from '@gjsify/effect-platform';
import { propertyStream, runInScope, windowScope, type WidgetScope } from '@gjsify/effect-platform/gtk';

/** What one directory read can end as. Total, so rendering needs no `else`. */
export type ReadOutcome =
    | { readonly _tag: 'Idle' }
    | { readonly _tag: 'Listing'; readonly path: string; readonly names: ReadonlyArray<string> }
    | { readonly _tag: 'Failed'; readonly path: string; readonly reason: string; readonly detail: string };

/** How many rows the group shows before it stops adding them. */
const MAX_ROWS = 12;

/**
 * Everything the window's fibers need, as one layer.
 *
 * Both halves are GNOME's own: `effect/FileSystem` on `Gio.File`, `effect/Path` on
 * GLib. Swapping in `@effect/platform-node-shared`'s layers here would change
 * nothing else in this file, which is the property `app.ts` asserts.
 */
const Services = Layer.mergeAll(fileSystemLayer, pathLayer);

export class EffectServicesWindow extends Adw.ApplicationWindow {
    declare private _pathRow: Adw.EntryRow;
    declare private _resultGroup: Adw.PreferencesGroup;
    declare private _statusRow: Adw.ActionRow;
    declare private _fibersRow: Adw.ActionRow;
    declare private _interruptedRow: Adw.ActionRow;

    static {
        GObject.registerClass(
            {
                GTypeName: 'EffectServicesWindow',
                Template,
                InternalChildren: ['pathRow', 'resultGroup', 'statusRow', 'fibersRow', 'interruptedRow'],
            },
            this,
        );
    }

    /** Closed when the window is closed or disposed; owns every fiber it starts. */
    readonly lifetime: WidgetScope;
    /** Exposed so the probe can emit a real `key-pressed` and read the answer back. */
    readonly keys: Gtk.EventControllerKey;

    private started = 0;
    private interrupted = 0;
    private rows: Array<Adw.ActionRow> = [];
    /** Last outcome rendered — the probe reads it instead of scraping widgets. */
    private outcome: ReadOutcome = { _tag: 'Idle' };

    constructor(params: Partial<Adw.ApplicationWindow.ConstructorProps> = {}) {
        super(params);
        this.lifetime = windowScope(this);
        this.keys = new Gtk.EventControllerKey();
        this._pathRow.add_controller(this.keys);
        this.keys.connect('key-pressed', (_c, keyval) => this.onKeyPressed(keyval));
        runInScope(this.lifetime.scope, Effect.provide(this.watchPath(), Services));
    }

    /** The whole behaviour of the window, as one Effect. */
    private watchPath(): Effect.Effect<void, never, FileSystem.FileSystem> {
        return propertyStream(this._pathRow, 'text', () => this._pathRow.get_text()).pipe(
            Stream.debounce(Duration.millis(250)),
            Stream.filter((path) => path.trim().length > 0),
            // `switchMap` and not `mapEffect`: a keystroke SUPERSEDES the read it
            // interrupts, and `mapEffect` would queue them instead.
            Stream.switchMap((path) => Stream.fromEffect(this.readDirectory(path))),
            Stream.runForEach((outcome) => Effect.sync(() => this.render(outcome))),
            // The stream ends only with the window; a failure in rendering would be
            // a defect, and there is no error channel left to carry one.
            Effect.orDie,
        );
    }

    private readDirectory(path: string): Effect.Effect<ReadOutcome, never, FileSystem.FileSystem> {
        // `const self = this` and not `Effect.gen(this, …)`: the two-argument form
        // types its first parameter as `{ readonly self: unknown }`, so passing a
        // widget widens the whole generator's return to `unknown`.
        const self = this;
        return Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            self.started++;
            self.showCounters();

            const names = yield* fs.readDirectory(path);
            return { _tag: 'Listing', path, names: names.slice().sort() } as const;
        }).pipe(
            // The mapping the whole showcase is about: one GError became one of
            // eleven normalized reasons, and the interface can branch on it.
            Effect.catchTag('PlatformError', (error) =>
                Effect.succeed({
                    _tag: 'Failed',
                    path,
                    reason: error.reason._tag,
                    detail: error.reason.description ?? error.message,
                } as const),
            ),
            Effect.onInterrupt(() =>
                Effect.sync(() => {
                    self.interrupted++;
                    self.showCounters();
                }),
            ),
        );
    }

    /**
     * THE SYNC BOUNDARY, in the one place GTK actually forces it.
     *
     * `Gtk.EventControllerKey::key-pressed` is a boolean signal: `true` consumes the
     * key, `false` lets it propagate. GTK reads that answer the moment the handler
     * returns, so a fiber cannot supply it — and an `async` handler is worse than
     * useless here, because the Promise it returns is truthy and would swallow every
     * key the controller sees.
     *
     * So the DECISION is made here, synchronously, and the WORK is forked into the
     * window's scope. Escape means "go up one directory": the answer is `true`
     * immediately, the read that follows is a fiber the window owns.
     */
    private onKeyPressed(keyval: number): boolean {
        if (keyval !== Gdk.KEY_Escape) return false;
        runInScope(this.lifetime.scope, Effect.provide(this.readParent(), Services));
        return true;
    }

    /** The forked half of Escape. `Path.dirname` is GLib's, via the platform layer. */
    private readParent(): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> {
        const self = this;
        return Effect.gen(function* () {
            const path = yield* Path.Path;
            const parent = path.dirname(self._pathRow.get_text());
            const outcome = yield* self.readDirectory(parent);
            self.render(outcome);
        }).pipe(Effect.orDie);
    }

    private showCounters(): void {
        this._fibersRow.subtitle = String(this.started);
        this._interruptedRow.subtitle = String(this.interrupted);
    }

    /** Replace the result rows. Called only from `Effect.sync`, so it is on the main loop. */
    render(outcome: ReadOutcome): void {
        this.outcome = outcome;
        for (const row of this.rows) this._resultGroup.remove(row);
        this.rows = [];

        if (outcome._tag === 'Idle') {
            this.setStatus('Waiting', 'Type a path above.');
            return;
        }
        if (outcome._tag === 'Failed') {
            // The tag, verbatim: it is Effect's vocabulary, not ours, and showing it
            // is what makes the mapping legible to someone reading the window.
            this.setStatus(outcome.reason, outcome.detail);
            return;
        }

        this.setStatus(
            `${outcome.names.length} entries`,
            outcome.names.length > MAX_ROWS ? `showing the first ${MAX_ROWS}` : outcome.path,
        );
        for (const name of outcome.names.slice(0, MAX_ROWS)) {
            const row = new Adw.ActionRow({ title: name });
            this._resultGroup.add(row);
            this.rows.push(row);
        }
    }

    private setStatus(title: string, subtitle: string): void {
        this._statusRow.title = title;
        this._statusRow.subtitle = subtitle;
    }

    /** Everything the probe needs, without reaching into private fields. */
    get state(): {
        readonly outcome: ReadOutcome;
        readonly started: number;
        readonly interrupted: number;
        readonly rowTitles: ReadonlyArray<string>;
    } {
        return {
            outcome: this.outcome,
            started: this.started,
            interrupted: this.interrupted,
            rowTitles: this.rows.map((row) => row.title),
        };
    }

    /** The path entry, so the probe can drive the stream by setting a real property. */
    get pathEntry(): Gtk.Editable {
        return this._pathRow;
    }
}
