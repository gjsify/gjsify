// SPDX-License-Identifier: MIT
//
// Does the win32 backend actually WORK — not "does the typelib resolve"?
//
// "A prebuild never LOADED in CI is a prebuild nobody tested" is the standing
// rule, and for this package the usual load test is too weak to say anything:
// resolving a GType proves `LoadLibrary` found the DLL, and ADR 0035's spike
// measured that a WebView2 backend can create its environment and its controller
// in a process that never pumps the Win32 message queue and only discover the
// gap at the first navigation. A probe that stopped at the GType would go green
// on exactly the artifact that cannot load a page.
//
// So this drives the four things the consumer does, in order, and each one fails
// LOUDLY rather than waiting for the job timeout:
//
//   1. `gi://WebKit 6.0` resolves and `new WebKit.WebView()` is a Gtk.Widget
//   2. the pump reports ATTACHED and the hosting mode reports OVERLAY
//   3. `load_html()` reaches LoadEvent.FINISHED  (this is the pump's real test)
//   4. `evaluate_javascript()` reads a marker back OUT OF THE DOM, and
//      `get_snapshot()` returns a GdkTexture that encodes to a non-empty PNG
//
// Step 4 is why a signal alone is not the assertion: `load-changed` firing says
// the navigation reported completion, not that a document exists to query.
//
// It goes through `@gjsify/node-gi` because on Windows that IS this project's
// GObject path — there is no libgjs for Windows — so a pass here means something
// to a real user rather than to a test harness.
//
// IT NEVER PRESENTS A WINDOW, and that is deliberate rather than a shortcut.
// A stage-1 view parks its content on a hidden window until a GTK toplevel maps
// it, so everything above is reachable with no toplevel at all — which is what
// lets this run unchanged on a hosted runner AND over SSH on the win11-gjsify
// VM. That second case is the one worth naming: an SSH session lands in Windows
// SESSION 0, where `Gtk.init_check()` returns true and LIES — the process
// survives until `present()` and then dies with 0xC0000005, which reads as a
// porting defect and is not one. Reaching the interactive session needs
// `Register-ScheduledTask -LogonType Interactive`; a probe that never presents
// needs neither.
//
// RUN IT: from a checkout, with the staged prebuild on PATH and GI_TYPELIB_PATH.
//   node packages/framework/webview2-native/scripts/probe-win32.mjs

// A RELATIVE import across the `packages/node-gi/**` line, which shipping code
// must not do (ADR 0031: that path is node-gi.yml's trigger and the affected
// classifier's ignore list, so an import either way makes one of the two lie).
// This file ships in no tarball — the package declares `files: []` — and the
// neighbouring webgl load test has the identical coupling, expressed as a cwd
// rather than as a specifier. `@gjsify/node-gi/gi` is not available instead:
// this job never runs `gjsify install`, so there is no node_modules to resolve
// a bare specifier through.
import { requireGi } from '../../../node-gi/node-gi/gi.js';

const GLib = requireGi('GLib', '2.0');
const Gtk = requireGi('Gtk', '4.0');

const MARKER = 'gjsify/webview2/loaded';
const CHANNEL = 'gjsifyProbe';
const POSTED = 'from the user script';
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>probe</title></head>
<body><h1 id="marker">${MARKER}</h1></body></html>`;

// Generous, because a cold WebView2 browser process on a hosted runner is slow
// the first time; short enough that a hang is a RESULT rather than a job that
// runs to its own timeout with no output.
const DEADLINE_MS = 60_000;

const failures = [];

function check(label, condition, detail) {
    console.log(`${condition ? '[ok]' : '[--]'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!condition) {
        failures.push(label);
    }
}

// ADR 0035's rule for every divergence is "each fails loudly rather than
// silently, because that is the difference between a subset and a lie". A
// warning nothing reads is the same lie one step along, so the warnings are
// ASSERTED rather than trusted.
//
// TWO GLib constraints shape this, both measured rather than assumed:
// `g_log_set_writer_func()` may be called ONCE per process — a second call, and
// `log_set_writer_default()` counts, is a fatal `GLib-ERROR` — so the writer is
// installed once here and never revoked (node-gi ships the same wrapper gjs does,
// with the field values as Uint8Arrays). And it returns UNHANDLED, not HANDLED,
// so GLib still writes the message out rather than this probe having to echo it.
//
// Three of the five divergence warnings need a live widget (`gtk_widget_init`
// needs a display), which is why they are here and the two display-free ones are
// in `probe-types.js`.
const decoder = new TextDecoder();
let capture = null;

GLib.log_set_writer_func((_level, fields) => {
    if (capture !== null) {
        const raw = fields?.MESSAGE;
        capture.push(raw == null ? '' : decoder.decode(raw));
    }
    return GLib.LogWriterOutput.UNHANDLED;
});

// Runs `body` with the log captured and asserts it warned about `needle`. The
// negative case is what this exists for: three of the four `world_name` entry
// points used to drop the argument with a bare `(void) world_name;`, so an
// assertion that only checked the call returns went green on a silent no-op for
// as long as nobody looked. A/B'd against the unfixed library: `warnings seen: []`.
function checkWarns(label, needle, body) {
    capture = [];
    let thrown = null;
    try {
        body();
    } catch (error) {
        thrown = error;
    }
    const messages = capture;
    capture = null;
    if (thrown !== null) {
        check(label, false, String(thrown));
        return;
    }
    const hit = messages.some((m) => m.includes(needle));
    check(label, hit, hit ? undefined : `warnings seen: ${JSON.stringify(messages)}`);
}

const WebKit = requireGi('WebKit', '6.0');
check('gi://WebKit 6.0 resolves', WebKit != null && WebKit.WebView != null);
if (failures.length > 0) {
    process.exit(1);
}

Gtk.init();

// Every type this package exports is touched here, and that is deliberate: on
// win32 the DLL exports only what `gjsifywebview2.def` lists, so a symbol dropped
// from that list is a `…_get_type` GI cannot find. Constructing each type turns
// that into a named failure on the run that drops it, rather than into a report
// from a user.
const settings = new WebKit.Settings();
check("WebKit.Settings constructs with WebKitGTK's defaults", settings.enable_javascript === true);

const manager = new WebKit.UserContentManager();
manager.register_script_message_handler(CHANNEL, null);
manager.add_script(
    new WebKit.UserScript(
        `window.webkit.messageHandlers.${CHANNEL}.postMessage(${JSON.stringify(POSTED)});`,
        WebKit.UserContentInjectedFrames.ALL_FRAMES,
        WebKit.UserScriptInjectionTime.START,
        null,
        null,
    ),
);
let received = null;
manager.connect(`script-message-received::${CHANNEL}`, (_manager, value) => {
    received = value.to_string();
});

const view = new WebKit.WebView({ user_content_manager: manager });
check('new WebKit.WebView() is a Gtk.Widget', view instanceof Gtk.Widget, `hosting mode ${view.get_hosting_mode()}`);
check('hosting mode is OVERLAY (ADR 0035 stage 1)', view.get_hosting_mode() === WebKit.HostingMode.OVERLAY);
check('the Win32 message pump is ATTACHED', view.get_message_pump_state() === WebKit.MessagePumpState.ATTACHED);
check('an unparented view reports no overlay constraints', view.get_overlay_constraints().length === 0);

// The divergences that need a widget. Each warning is emitted SYNCHRONOUSLY by
// the portable layer at the call, before the engine is involved at all, so a
// null callback is enough and the queued operation is dropped. Asserted here,
// before `load_html`, so a failure cannot be confused with a load failure.
checkWarns('evaluate_javascript warns about an ignored script world', 'IGNORED by evaluate_javascript', () =>
    view.evaluate_javascript('1', -1, 'probe-world', null, null, null),
);
checkWarns(
    'get_snapshot warns that FULL_DOCUMENT returns the viewport',
    'SnapshotRegion.FULL_DOCUMENT is not available',
    () => view.get_snapshot(WebKit.SnapshotRegion.FULL_DOCUMENT, WebKit.SnapshotOptions.NONE, null, null),
);
checkWarns('get_snapshot warns that non-NONE options are ignored', 'SnapshotOptions other than NONE are IGNORED', () =>
    view.get_snapshot(WebKit.SnapshotRegion.VISIBLE, WebKit.SnapshotOptions.TRANSPARENT_BACKGROUND, null, null),
);

const loop = GLib.MainLoop.new(null, false);
const seen = [];
let finished = false;

function done() {
    if (loop.is_running()) {
        loop.quit();
    }
}

view.connect('load-changed', (_view, event) => {
    seen.push(event);
    if (event !== WebKit.LoadEvent.FINISHED || finished) {
        return;
    }
    finished = true;

    // Read the marker back OUT of the DOM. A `load-changed` signal says the
    // navigation reported completion; only this says a document was parsed.
    view.evaluate_javascript(
        'document.querySelector("#marker").textContent',
        -1,
        null,
        null,
        null,
        (_source, result) => {
            let text = null;
            try {
                text = view.evaluate_javascript_finish(result).to_string();
            } catch (error) {
                check('evaluate_javascript reads the DOM back', false, String(error));
            }
            check('evaluate_javascript reads the DOM back', text === MARKER, `got ${JSON.stringify(text)}`);

            view.get_snapshot(
                WebKit.SnapshotRegion.VISIBLE,
                WebKit.SnapshotOptions.NONE,
                null,
                (_s, snapshotResult) => {
                    try {
                        const texture = view.get_snapshot_finish(snapshotResult);
                        const png = texture.save_to_png_bytes().get_data();
                        check(
                            'get_snapshot returns an encodable GdkTexture',
                            png.length > 0,
                            `${texture.get_width()}x${texture.get_height()}, ${png.length} B PNG`,
                        );
                    } catch (error) {
                        check('get_snapshot returns an encodable GdkTexture', false, String(error));
                    }
                    // The postMessage bridge, end to end: a document-start user
                    // script reached `window.webkit.messageHandlers.<name>` and
                    // the host turned it back into a detailed GObject signal.
                    // Asserted HERE rather than on arrival because its ORDERING
                    // was a real bug — WebView2 runs document-start scripts in
                    // registration order, so the page side has to be in place
                    // before any user script that uses it.
                    check(
                        "script-message-received carries the page's postMessage",
                        received === POSTED,
                        `got ${JSON.stringify(received)}`,
                    );
                    done();
                },
            );
        },
    );
});

view.connect('load-failed', (_view, _event, uri, error) => {
    check('load_html reaches LoadEvent.FINISHED', false, `load-failed on ${uri}: ${error.message}`);
    done();
    return true;
});

view.load_html(PAGE, null);

let timedOut = false;
GLib.timeout_add(GLib.PRIORITY_DEFAULT, DEADLINE_MS, () => {
    timedOut = !finished;
    done();
    return GLib.SOURCE_REMOVE;
});

loop.run();

check(
    'load_html reaches LoadEvent.FINISHED',
    finished,
    timedOut
        ? // The one failure worth spelling out, because its cause is a long way
          // from its symptom: WebView2 delivers NavigationCompleted through the
          // Win32 message queue and g_main_loop_run() does not dispatch it.
          `timed out after ${DEADLINE_MS} ms with no pump reaching the engine; ` + `load events [${seen.join(', ')}]`
        : `load events [${seen.join(', ')}]`,
);

console.log(
    failures.length === 0
        ? '\nverdict: the win32 backend loads, evaluates and captures.'
        : `\nverdict: ${failures.length} failure(s): ${failures.join('; ')}`,
);

process.exit(failures.length === 0 ? 0 : 1);
