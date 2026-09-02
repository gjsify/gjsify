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

const WebKit = requireGi('WebKit', '6.0');
check('gi://WebKit 6.0 resolves', WebKit != null && WebKit.WebView != null);
if (failures.length > 0) {
    process.exit(1);
}

Gtk.init();

const view = new WebKit.WebView();
check('new WebKit.WebView() is a Gtk.Widget', view instanceof Gtk.Widget, `hosting mode ${view.get_hosting_mode()}`);
check('hosting mode is OVERLAY (ADR 0035 stage 1)', view.get_hosting_mode() === WebKit.HostingMode.OVERLAY);
check('the Win32 message pump is ATTACHED', view.get_message_pump_state() === WebKit.MessagePumpState.ATTACHED);
check('an unparented view reports no overlay constraints', view.get_overlay_constraints().length === 0);

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
