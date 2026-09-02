// SPDX-License-Identifier: MIT
// @gjsify/node-gi — the GStreamer ELEMENTS resolve on a batteries-included bundle.
//
// The counterpart to windowing.test.mjs, for audio. Everything else about the
// GStreamer payload is checkable by counting files, and counting files is exactly
// what missed the defect this test exists for: a bundle shipped `libgstreamer`,
// both Gst typelibs and ZERO plugins, and every gate stayed green — the typelib
// symmetry check compares a typelib to its LIBRARY and knows nothing about
// elements. `Gst.init()` then succeeds against an empty registry, and the failure
// surfaces far away, in the application, as "no element decodebin".
//
// So this asks the only question that cannot be answered by inspecting the tarball:
// does the registry actually contain the elements the audio path is made of? That
// covers the plugin payload AND the env wiring around it
// (`GST_PLUGIN_SYSTEM_PATH` / `GST_PLUGIN_SCANNER`, set by gtk-runtime.js) — a
// bundle can carry every plugin and still resolve none, if the runtime is never
// told where they are.
//
// NO DISPLAY NEEDED. Audio elements are constructed, not realized, so this runs on
// any host with the bundle staged — unlike the windowing proofs beside it.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Gst, gstSkip as skip } from './gst-gate.mjs';

// The pipeline @gjsify/webaudio is built from, element by element. Named
// individually rather than asserted as a count, because "20 plugins loaded" is the
// claim that was already true while the one element the decode path needs was
// missing — and a count cannot tell you WHICH one is gone.
const REQUIRED_ELEMENTS = [
    ['appsrc', 'the JS → GStreamer boundary: encoded bytes are pushed in here'],
    ['appsink', 'the GStreamer → JS boundary: decoded PCM is pulled out here'],
    ['decodebin', 'format-agnostic decoding — the element the empty registry could not find'],
    ['audioconvert', 'sample-format conversion into what AudioBuffer expects'],
    ['audioresample', 'rate conversion to the context sample rate'],
    ['typefind', 'what decodebin autoplugs from — no typefind, no format detection'],
    ['volume', 'GainNode'],
    // The URI path, and the source it had no source for. `playbin3` and `uridecodebin3`
    // exist to take a URI and both resolved on every published bundle, while the only
    // scheme behind them was file:// — `filesrc` rides in on coreelements and nothing
    // shipped for http(s). Measured on the published darwin-x64 and win32-x64 bundles:
    // souphttpsrc was the one null in an otherwise complete list.
    ['playbin3', 'the URI player an app hands a stream address to'],
    ['uridecodebin3', 'what playbin3 autoplugs the source and the decoder from'],
    ['souphttpsrc', 'the http(s) source — a URI pipeline has no source element without it'],
];

test('the GStreamer registry resolves the audio-path elements', { skip }, () => {
    const missing = [];
    for (const [name, why] of REQUIRED_ELEMENTS) {
        if (Gst.ElementFactory.make(name, null) === null) missing.push(`${name} (${why})`);
    }
    assert.deepEqual(
        missing,
        [],
        `GStreamer resolved no factory for:\n  ${missing.join('\n  ')}\n\n` +
            'The registry is populated from GST_PLUGIN_SYSTEM_PATH, which node-gi points at ' +
            "the bundle's lib/gstreamer-1.0. An EMPTY result here means either the bundle ships " +
            'no plugins or nothing told GStreamer where they are — both look like a healthy ' +
            'Gst.init() and fail in the application instead.',
    );
});

test('a decodebin pipeline actually builds', { skip }, () => {
    // One step past "the factories exist": the elements link into the shape the
    // decoder uses. `parse_launch` fails on a missing element OR a refused link, so
    // this catches a registry that is populated but incoherent.
    const pipeline = Gst.parse_launch('appsrc name=src ! decodebin ! audioconvert ! audioresample ! appsink name=sink');
    assert.ok(pipeline, 'parse_launch returned nothing for the decode pipeline');
    assert.ok(pipeline.get_by_name('src'), 'appsrc is not addressable in the built pipeline');
    assert.ok(pipeline.get_by_name('sink'), 'appsink is not addressable in the built pipeline');
    pipeline.set_state(Gst.State.NULL);
});

test('a URI pipeline can be built for an https source', { skip }, () => {
    // The counterpart to the decodebin pipeline above, for the source half: `parse_launch`
    // fails on a missing element or a refused link, so this is what turns "souphttpsrc
    // resolves" into "the shape an app writes actually assembles".
    const pipeline = Gst.parse_launch(
        'souphttpsrc name=src location=https://example.invalid/stream.mp3 ! decodebin ! audioconvert ! ' +
            'audioresample ! appsink name=sink',
    );
    assert.ok(pipeline, 'parse_launch returned nothing for the http source pipeline');
    assert.ok(pipeline.get_by_name('src'), 'souphttpsrc is not addressable in the built pipeline');
    pipeline.set_state(Gst.State.NULL);
});

// THE EFFECT, NOT THE PAYLOAD — and the questions above cannot reach it. Naming a factory
// says a plugin loaded; what `playbin3` and every other URI element consult is the
// registry's URI HANDLER table, and an app never asks for `souphttpsrc` by name. It hands
// over a URI. Measured on win32-x64 0.45.0, where every element above already resolved:
// `Gst.uri_protocol_is_supported(SRC, 'https')` was FALSE and `playbin3.set_state(PAUSED)`
// on an https URI returned FAILURE outright, while a playable `file://` URI went ASYNC.
//
// OFFLINE, and it has to be. `set_state(PAUSED)` returns once the state change has
// STARTED: the source element is looked up and created synchronously, its connection is
// not. So the assertion is settled before the host would be asked for `example.invalid`,
// and the pipeline is torn down on the next line either way.
const NO_SUCH_SCHEME = 'gjsify-no-such-scheme';

test('the registry can actually open an https URI, not merely name the element', { skip }, () => {
    assert.equal(
        Gst.uri_protocol_is_supported(Gst.URIType.SRC, 'https'),
        true,
        'no registered element handles the https URI scheme. This is the table playbin3 and ' +
            'uridecodebin3 resolve a URI through — an element that exists but is not registered as a ' +
            'URI handler is invisible to every one of them.',
    );
    assert.equal(Gst.uri_protocol_is_supported(Gst.URIType.SRC, 'file'), true, 'file:// regressed');
    // The discriminator for the line above: a table that answered `true` to everything
    // would satisfy it while measuring nothing.
    assert.equal(Gst.uri_protocol_is_supported(Gst.URIType.SRC, NO_SUCH_SCHEME), false);
});

test('playbin3 accepts an https URI, and refuses one nothing handles', { skip }, () => {
    // End to end, in the shape an app writes: hand playbin3 a URI and start it. The second
    // leg is the control, and it is a scheme rather than a missing file — a `file://` URI
    // that does not exist ALSO returns FAILURE (measured), so it would prove the assertion
    // can fail without proving it fails for the reason claimed.
    const stateChangeFor = (uri) => {
        const playbin = Gst.ElementFactory.make('playbin3', null);
        assert.ok(playbin, 'playbin3 did not resolve');
        playbin.set_property('uri', uri);
        const change = playbin.set_state(Gst.State.PAUSED);
        playbin.set_state(Gst.State.NULL);
        return change;
    };
    assert.notEqual(
        stateChangeFor('https://example.invalid/stream.mp3'),
        Gst.StateChangeReturn.FAILURE,
        'playbin3 refused an https URI at READY -> PAUSED, which is what a bundle with no source element ' +
            'for the scheme does: uridecodebin3 finds no handler and fails the state change synchronously, ' +
            'with nothing on the bus an app could tell apart from a network fault.',
    );
    assert.equal(
        stateChangeFor(`${NO_SUCH_SCHEME}://host/stream.mp3`),
        Gst.StateChangeReturn.FAILURE,
        'playbin3 accepted a URI scheme no element handles, so the assertion above proves nothing',
    );
});

// NOT a network test, and deliberately not one: it asks whether the bundle carries a TLS
// IMPLEMENTATION, which is a property of the payload and answerable offline. It has to be
// asked separately from the elements above, because souphttpsrc resolves perfectly well
// with no TLS backend behind it and then fails on the first https URL with "Internal data
// stream error" — a network error to read, a missing g_module_open-ed module in fact. GIO
// has no built-in GTlsConnection: glib-networking ships one as a module, node-gi points
// GIO_MODULE_DIR at the bundle's lib/gio/modules, and with neither in place
// `g_tls_backend_get_default()` returns the dummy backend, whose supports_tls() is false.
test('the bundle carries a TLS backend, so https is more than an element name', { skip }, () => {
    const Gio = requireGi('Gio', '2.0');
    const backend = Gio.tls_backend_get_default();
    assert.ok(backend, 'Gio.tls_backend_get_default() returned nothing at all');
    assert.equal(
        backend.supports_tls(),
        true,
        'the default GTlsBackend does not support TLS — it is the DUMMY backend. GIO loads the real ' +
            'one (glib-networking) as a module out of GIO_MODULE_DIR, so either the bundle ships no ' +
            'lib/gio/modules or nothing told GIO where it is. Every https URL fails as a stream error ' +
            'until it does; see the tls-backend data set in scripts/bundle-data.mjs.',
    );

    // ONE LAYER DOWN, and the layer that decides whether https actually WORKS. A
    // backend is an implementation, and an implementation with no trust anchors
    // rejects every certificate — so supports_tls() above is satisfied by a bundle on
    // which nothing can connect. Measured on linux-x64 by bind-mounting an empty dir
    // over p11-kit's module dirs: supports_tls() stayed true, this whole FILE stayed
    // green at exit 0, and every handshake failed with `Unacceptable TLS certificate`.
    //
    // The anchors are the one part of the TLS payload the bundle does NOT ship. The
    // shipped gnutls reaches them through the shipped libp11-kit, which resolves its
    // trust module out of a COMPILED-IN directory (/usr/share/p11-kit/modules,
    // /etc/pkcs11/modules) — the BUILD prefix — and unlike GIO's module dir there is no
    // env override to repoint it with: the whole P11_KIT_* surface is DEBUG,
    // NO_USER_CONFIG, STRICT and URI_LOWERCASE. So this cannot be asserted from the
    // tarball's file list either; it has to be ASKED of the running backend, on the OS
    // the bundle is for, which is where this file runs.
    //
    // get_default_database() is the call that separates the two: glib-networking
    // returns NULL for it when the system trust holds zero certificates, while
    // supports_tls() keeps answering for the module's mere presence. It is a lower
    // bound — a non-empty database still says nothing about WHICH roots are in it —
    // but it is the difference between "a TLS backend loaded" and "TLS can succeed".
    assert.ok(
        backend.get_default_database(),
        'the TLS backend has NO trust anchors: g_tls_backend_get_default_database() is NULL, which ' +
            'glib-networking returns when the system trust contains zero certificates. souphttpsrc ' +
            'resolves, the backend loads, supports_tls() is true — and every https certificate is ' +
            'rejected. The bundle ships the TLS implementation but not the anchors, and the shipped ' +
            'p11-kit looks for its trust module in the BUILD prefix with no env override available.',
    );
});
