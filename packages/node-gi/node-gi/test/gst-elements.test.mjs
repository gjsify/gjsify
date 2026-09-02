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
