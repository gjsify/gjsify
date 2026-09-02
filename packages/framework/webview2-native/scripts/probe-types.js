// SPDX-License-Identifier: MIT
//
// Does the typelib present the API `@gjsify/iframe` is written against?
//
// This runs on LINUX, against the build g-ir-scanner links — the one with no
// engine behind it — and it is deliberately the half of the contract that has
// nothing to do with WebView2. What decides whether a consumer compiles and runs
// is the SHAPE of the namespace: the enum numbering, the boxed constructor's
// argument order, whether `WebView` can be subclassed, and whether
// `Gio._promisify` finds the async pair. Every one of those is a property of the
// GIR, so every one of them is checkable on the host that produced it, on every
// pull request, in under a second.
//
// It is not a substitute for `probe-win32.mjs`, which is the only thing that
// says a page loads. It is the half that catches the mistakes ADR 0022 paid for
// on darwin — a FINAL type that compiles, installs and then cannot be
// subclassed; a UserScript declared as a GObject, which changes the call the
// consumer has to write — before a Windows runner is involved at all.
//
// NO WIDGET IS INSTANTIATED, and that is what keeps it headless: registering a
// subclass needs the GType, `gtk_widget_init` needs a display. Constructing one
// belongs to the win32 probe.
//
// RUN IT:
//   GI_TYPELIB_PATH=<builddir> LD_LIBRARY_PATH=<builddir> \
//     gjs -m packages/framework/webview2-native/scripts/probe-types.js

import system from 'system';

import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';
import WebKit from 'gi://WebKit?version=6.0';

const failures = [];

function check(label, condition, detail) {
    console.log(`${condition ? '[ok]' : '[--]'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!condition) {
        failures.push(label);
    }
}

// The numeric values are WebKitGTK's on purpose: a consumer that (wrongly)
// compares integers still agrees across backends, and a renumbering here would
// be invisible in every test that compares symbols to themselves.
check(
    'LoadEvent numbering matches WebKitGTK',
    WebKit.LoadEvent.STARTED === 0 &&
        WebKit.LoadEvent.REDIRECTED === 1 &&
        WebKit.LoadEvent.COMMITTED === 2 &&
        WebKit.LoadEvent.FINISHED === 3,
);
check(
    'SnapshotRegion + SnapshotOptions numbering matches WebKitGTK',
    WebKit.SnapshotRegion.VISIBLE === 0 &&
        WebKit.SnapshotRegion.FULL_DOCUMENT === 1 &&
        WebKit.SnapshotOptions.NONE === 0,
);
check(
    'UserScript injection enums match WebKitGTK',
    WebKit.UserContentInjectedFrames.ALL_FRAMES === 0 && WebKit.UserScriptInjectionTime.START === 0,
);

// Stage 1's two named APIs, as ENUMS rather than as booleans, so stage 2 can
// change the answer without changing the call.
check(
    'HostingMode and MessagePumpState are declared',
    WebKit.HostingMode.OVERLAY === 0 && WebKit.HostingMode.COMPOSITED === 1 && WebKit.MessagePumpState.ATTACHED === 0,
);

// BOXED, not a GObject: GJS maps a boxed `new` onto positional arguments, while
// a GObject would demand `new UserScript({property: …})`. ADR 0022 records that
// getting this wrong compiles, installs, and then breaks the one call the port
// exists to keep identical.
let script = null;
try {
    script = new WebKit.UserScript(
        'globalThis.x = 1;',
        WebKit.UserContentInjectedFrames.ALL_FRAMES,
        WebKit.UserScriptInjectionTime.START,
        null,
        null,
    );
} catch (error) {
    check("UserScript takes WebKitGTK's positional arguments", false, String(error));
}
check("UserScript takes WebKitGTK's positional arguments", script !== null);

const manager = new WebKit.UserContentManager();
manager.add_script(script);
manager.register_script_message_handler('gjsifyProbe', null);
check('UserContentManager accepts a script and a handler name', true);

// DERIVABLE. `IFrameBridge extends WebKit.WebView` is the shape every consumer is
// written in, and GJS refuses to subclass a final type.
let Subclass = null;
try {
    Subclass = GObject.registerClass(
        { GTypeName: 'GjsifyWebView2ProbeSubclass' },
        class ProbeSubclass extends WebKit.WebView {},
    );
} catch (error) {
    check('WebKit.WebView is subclassable', false, String(error));
}
check('WebKit.WebView is subclassable', Subclass !== null);
check('WebKit.WebView is a Gtk.Widget', GObject.type_is_a(WebKit.WebView.$gtype, Gtk.Widget.$gtype));

// ADR 0035 decision 4's four instance methods, counted from the consumer's own
// call sites. A missing one is `undefined`, never an error, which is why this is
// asserted rather than assumed.
for (const name of [
    'evaluate_javascript',
    'evaluate_javascript_finish',
    'get_snapshot',
    'get_snapshot_finish',
    'load_html',
    'load_uri',
    'get_hosting_mode',
    'get_overlay_constraints',
    'get_message_pump_state',
]) {
    check(`WebKit.WebView.${name} exists`, typeof WebKit.WebView.prototype[name] === 'function');
}

// The exact call `@gjsify/iframe/promisify.ts` makes. It is what turns the two
// async pairs into the Promise signature its ~40 call sites await, and it throws
// if either half of a pair is missing.
try {
    Gio._promisify(WebKit.WebView.prototype, 'evaluate_javascript', 'evaluate_javascript_finish');
    Gio._promisify(WebKit.WebView.prototype, 'get_snapshot', 'get_snapshot_finish');
    check('Gio._promisify finds both async pairs', true);
} catch (error) {
    check('Gio._promisify finds both async pairs', false, String(error));
}

check('Settings carries the properties @gjsify/iframe sets', 'enable_javascript' in new WebKit.Settings());

console.log(
    failures.length === 0
        ? '\nverdict: the namespace has the shape the consumer is written against.'
        : `\nverdict: ${failures.length} failure(s): ${failures.join('; ')}`,
);

if (failures.length > 0) {
    system.exit(1);
}
