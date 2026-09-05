// SPDX-License-Identifier: MIT
//
// Effect 4 running the SERVICES behind an Adwaita window, and nothing else.
//
// THE CLAIM THIS SHOWCASE MAKES, and the reason it is not a fourth renderer.
// `@gjsify/gtk-host` already has three UI frameworks bound to it (React, Vue,
// Solid), so "declarative UI over a retained-mode tree" is a solved problem here
// three times over. What no GJS application has is the other half: services with
// typed errors, resources with deterministic release, and cancellation that
// reaches the C library. Effect is that half, and it needs to touch no widget to
// provide it. So this window's tree is Blueprint's (`window.blp`), and Effect
// supplies:
//
//   effect-gio/errors.ts       GError → Effect's eleven normalized SystemError tags
//   effect-gio/filesystem.ts   effect/FileSystem over Gio.File, cancellable for real
//   effect-gio/scope.ts        a Scope that GObject `destroy` closes — RAII for GJS
//   effect-gio/signal.ts       a GObject signal as a Stream, with the strategy named
//
// SELF-VERIFYING through `runHostProbeApp` from `@gjsify/gtk-host` — the same
// harness the host-counter showcases use. It owns the `GJSIFY_HOST_PROBE=1` gate,
// the GTK diagnostics collector, the `check()` recorder and the
// `PROBE: PASS|FAIL <json>` line; what is below is only the assertions.
//
// THE ASSERTIONS ARE ABOUT THE INTEGRATION, not about Effect. Effect's own
// behaviour is upstream's business and is covered in this repo by
// `tests/integration/effect` (63 cases on GJS and Node). What only a running GTK
// application can answer is: does an interrupted fiber actually cancel a
// `Gio.Cancellable`, does `destroy` really run the finalizers, and do the two
// FileSystem layers give the same answers to the same program — which is what
// makes the Gio layer a drop-in rather than a lookalike.

import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';

import * as NodeFileSystem from '@effect/platform-node-shared/NodeFileSystem';
import { runHostProbeApp, type ProbeCheck } from '@gjsify/gtk-host';
import { Duration, Effect, Exit, Fiber, Scope, Stream } from 'effect';
import * as FileSystem from 'effect/FileSystem';

import * as GioFileSystem from './effect-gio/filesystem.js';
import { gioAsync } from './effect-gio/filesystem.js';
import { reasonOf } from './effect-gio/errors.js';
import { propertyStream } from './effect-gio/signal.js';
import { runInScope, widgetScope, windowScope } from './effect-gio/scope.js';
import { EffectServicesWindow } from './window.js';

// BEFORE any template is instantiated. GtkBuilder resolves `Adw.EntryRow` by GType
// NAME, and a type nothing has touched is not registered yet — without this the
// template build fails with `Invalid object type 'AdwEntryRow'` and the internal
// children come back null. `Adw.Application` does this at startup, which is why an
// app never sees it and a headless probe does.
Adw.init();

/** This showcase's own `src/`, which ships in the tarball and is a real directory. */
const SOURCE_DIR = ((): string => {
    const [path] = GLib.filename_from_uri(new URL('../src/', import.meta.url).href);
    return path.replace(/\/$/, '');
})();

const MISSING = `${SOURCE_DIR}/there-is-no-such-file-here`;

interface Ui {
    readonly window: EffectServicesWindow;
}

function buildUi(app: Adw.Application | null): Ui {
    return { window: new EffectServicesWindow(app ? { application: app } : {}) };
}

/**
 * One directory read, written ONCE and run against both layers.
 *
 * This is the shape of the claim: a consumer that names `FileSystem.FileSystem`
 * does not know which layer it got, and both must answer the same way — including
 * on the failure path, where a private error vocabulary would have diverged.
 */
const readAndFail = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const names = yield* fs.readDirectory(SOURCE_DIR);
    const missing = yield* Effect.flip(fs.stat(MISSING));
    const exists = yield* fs.exists(MISSING);
    return {
        names: names.slice().sort(),
        reason: missing.reason._tag,
        method: missing.reason.method,
        exists,
    };
});

async function assertUi(ui: Ui, check: ProbeCheck): Promise<Record<string, unknown>> {
    // 1. The template built the interface. Not a formality: `InternalChildren`
    //    silently yields null when a GType is unregistered, and every later
    //    assertion would then fail with a message about the wrong thing.
    check('the Blueprint template produced the path entry', ui.window.pathEntry !== null);
    check('the window title came from the template', ui.window.title === 'Effect services');

    // 2. Both layers, one program.
    const viaGio = await Effect.runPromise(Effect.provide(readAndFail, GioFileSystem.layer));
    const viaNode = await Effect.runPromise(Effect.provide(readAndFail, NodeFileSystem.layer));

    check("the Gio layer lists this showcase's own source directory", viaGio.names.includes('window.blp'));
    check(
        'both layers list the same directory identically',
        JSON.stringify(viaGio.names) === JSON.stringify(viaNode.names),
    );
    check('the Gio layer maps a missing path to NotFound', viaGio.reason === 'NotFound');
    check('so does the Node layer — the vocabularies agree', viaNode.reason === 'NotFound');
    check('the failing method is reported as stat, not as the GIO call', viaGio.method === 'stat');
    check('exists answers false rather than failing', viaGio.exists === false && viaNode.exists === false);

    // 3. The mapping is a MAPPING, not a NotFound special case. A GError from
    //    another domain with the same numeric code must NOT become NotFound —
    //    `Gio.IOErrorEnum.NOT_FOUND` and `GLib.FileError.EXIST` are both 1.
    const foreign = GLib.Error.new_literal(GLib.file_error_quark(), GLib.FileError.EXIST, 'from another domain');
    check('a same-coded error from another domain is Unknown', reasonOf(foreign) === 'Unknown');
    check(
        'a real GIO NOT_FOUND is NotFound',
        reasonOf(GLib.Error.new_literal(Gio.io_error_quark(), Gio.IOErrorEnum.NOT_FOUND, 'gone')) === 'NotFound',
    );
    check(
        'a GIO code with no Effect tag is Unknown, not a near miss',
        reasonOf(GLib.Error.new_literal(Gio.io_error_quark(), Gio.IOErrorEnum.IS_DIRECTORY, 'is a directory')) ===
            'Unknown',
    );

    // 4. Interruption reaches GIO. The capability the whole layer exists for, and
    //    the one an assertion about the Effect side alone would not establish: a
    //    fiber can end interrupted while the C call runs on happily to completion.
    //    So the `Gio.Cancellable` itself is the witness.
    let registered: Gio.Cancellable | null = null;
    await Effect.runPromise(
        Effect.gen(function* () {
            const forever = Effect.callback<never, never>((_resume, signal) => {
                registered = new Gio.Cancellable();
                signal.addEventListener('abort', () => registered?.cancel());
            });
            const fiber = yield* Effect.forkChild(forever, { startImmediately: true });
            yield* Fiber.interrupt(fiber);
        }),
    );
    check(
        'interrupting a fiber cancels the Gio.Cancellable it registered',
        (registered as Gio.Cancellable | null)?.is_cancelled() === true,
    );

    // And through the real adapter, on a real call: the read must END, and end as
    // an interrupt rather than as a failure the UI would report to the user.
    const readExit = await Effect.runPromise(
        Effect.gen(function* () {
            const fiber = yield* Effect.forkChild(
                gioAsync({
                    method: 'readDirectory',
                    path: '/usr/lib',
                    source: Gio.File.new_for_path('/usr/lib'),
                    start: (file, cancellable, done) =>
                        file.enumerate_children_async(
                            Gio.FILE_ATTRIBUTE_STANDARD_NAME,
                            Gio.FileQueryInfoFlags.NONE,
                            GLib.PRIORITY_DEFAULT,
                            cancellable,
                            (_source, result) => done(result),
                        ),
                    finish: (file, result) => file.enumerate_children_finish(result),
                }),
                { startImmediately: true },
            );
            yield* Fiber.interrupt(fiber);
            return yield* Fiber.await(fiber);
        }),
    );
    check('an interrupted GIO read ends as an interrupt, not a failure', Exit.hasInterrupts(readExit));

    // 5. A GObject property change arrives as a Stream element, starting from the
    //    value the property already has. `Stream.take(2)` is what makes this a
    //    test and not a hang: it completes on the second element rather than
    //    waiting for a stream that by design never ends.
    //
    //    THE SLEEP IS LOAD-BEARING, and the reason is a property of the design
    //    rather than a flake. `Stream.callback`'s register — which is where
    //    `source.connect()` happens — runs when the stream is first PULLED, and
    //    `forkChild({ startImmediately: true })` does not get the fiber that far.
    //    Measured: without a yield here the `set_text` lands before the handler
    //    exists, no element is ever offered, and the probe times out at 60s with no
    //    output. Nothing buffers a signal emitted before its connection; the
    //    mitigation in real code is the seed element below, which is why
    //    `propertyStream` starts with the current value instead of only changes.
    const seen = await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const collected = yield* Effect.forkChild(
                    propertyStream(ui.window.pathEntry, 'text', () => ui.window.pathEntry.get_text()).pipe(
                        Stream.take(2),
                        Stream.runCollect,
                    ),
                    { startImmediately: true },
                );
                yield* Effect.sleep(Duration.millis(50));
                ui.window.pathEntry.set_text(SOURCE_DIR);
                return yield* Fiber.join(collected);
            }),
        ),
    );
    check('the property stream starts with the current value', seen[0] === '');
    check('and delivers the change', seen[1] === SOURCE_DIR);

    // 6. RAII, and the trap underneath it.
    //
    //    `widgetScope` closes on `destroy`, which GTK4 emits from DISPOSE. So
    //    `window.destroy()` — with the application still holding a reference, i.e.
    //    always — does NOT close it. That is not a bug in the bridge, it is what
    //    the signal means, and asserting it here is what keeps the next reader
    //    from "simplifying" `windowScope` back down to one trigger.
    const disposeReleases: Array<string> = [];
    const disposeWindow = new Adw.Window();
    const disposeScope = widgetScope(disposeWindow);
    Effect.runSync(
        Scope.addFinalizer(
            disposeScope.scope,
            Effect.sync(() => disposeReleases.push('released')),
        ),
    );
    check('a widget scope has not run its finalizer yet', disposeReleases.length === 0);
    disposeWindow.destroy();
    check('window.destroy() does NOT close a destroy-scope — it is not a dispose', disposeReleases.length === 0);
    disposeWindow.run_dispose();
    check('run_dispose does close it', JSON.stringify(disposeReleases) === JSON.stringify(['released']));
    disposeScope.close();
    check('closing again does not run the finalizer twice', disposeReleases.length === 1);

    //    `windowScope` adds the trigger an application actually means. The signal
    //    is EMITTED here rather than provoked with `close()`, because a window that
    //    was never presented emits nothing at all — measured — and the probe path
    //    deliberately never presents. What is under test is this file's wiring, not
    //    GTK's emission policy.
    const closeReleases: Array<string> = [];
    const closeWindow = new Adw.Window();
    const closeScope = windowScope(closeWindow);
    Effect.runSync(
        Scope.addFinalizer(
            closeScope.scope,
            Effect.sync(() => closeReleases.push('released')),
        ),
    );
    closeWindow.emit('close-request');
    check('a window scope closes on close-request', JSON.stringify(closeReleases) === JSON.stringify(['released']));
    closeWindow.run_dispose();
    check('and a later dispose does not run it again', closeReleases.length === 1);

    //    The whole point of the scope: a fiber forked into it is interrupted when
    //    it closes. Without this the two checks above prove only that a callback
    //    fired.
    const parked = new Adw.Window();
    const parkedScope = windowScope(parked);
    const parkedFiber = runInScope(parkedScope.scope, Effect.never);
    check('a fiber forked into an open scope is still running', parkedFiber.pollUnsafe() === undefined);
    parked.emit('close-request');
    check('closing the scope interrupted it', Exit.hasInterrupts(parkedFiber.pollUnsafe() ?? Exit.void));
    parked.run_dispose();

    return {
        entries: viaGio.names.length,
        agreed: JSON.stringify(viaGio.names) === JSON.stringify(viaNode.names),
        reason: viaGio.reason,
    };
}

await runHostProbeApp<Ui>({
    applicationId: 'eu.jumplink.EffectAdwServices',
    build: buildUi,
    assert: assertUi,
    // `run_dispose` and not `destroy`: the window owns a fiber reading its path
    // entry, its scope closes on `close-request` or `destroy`, and a window that
    // was never presented emits NEITHER from `destroy()` — measured, see
    // `effect-gio/scope.ts`. So `destroy()` here would leave the probe's own
    // window behind with a live fiber in it, which is precisely the class of
    // defect the diagnostics count (taken after teardown) exists to catch.
    teardown: (ui) => ui.window.run_dispose(),
    present: (ui) => ui.window.present(),
});
