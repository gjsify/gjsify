#!/usr/bin/env -S gjs -m
/*
 * vad-model.gjs.js — the one test that LOADS A REAL MODEL, and the regression
 * guard for the worst bug this package has had.
 *
 * Why it is worth a test of its own, with a model, when nothing else here needs
 * one: `Vad.open()` builds an onnxruntime inference session, and that call used
 * to abort with `free(): invalid pointer`. Not on a bad model and not
 * intermittently — every time, with a correct model, on a build that compiled,
 * linked and passed every other test in this directory. The cause was two
 * static archives built by different GCCs defining the same weak
 * `std::__detail::_Scanner<char>` symbols with different layouts
 * (meson.build § onnxruntime). NOTHING SHORT OF OPENING A SESSION SEES IT: the
 * version strings, the error domains, the ELF read-back and the C smoke test
 * were all green throughout.
 *
 * So the guard has to run a session, and a session needs weights this repo may
 * not redistribute (ADR 0127 decision 14). It therefore EXITS 77 — meson's skip
 * code — when no model is cached, which puts a line in the test report. A leg
 * nobody can see in the report is how a gap stays open.
 *
 * Point it at one with GJSIFY_SHERPA_VAD_MODEL, or let it find the model
 * @gjsify/vad downloads into the user cache.
 *
 * NO AUDIO DEVICE, here or anywhere else in this directory: the samples are a
 * Float32Array of zeros.
 */

import GLib from 'gi://GLib';
import GjsifySherpa from 'gi://GjsifySherpa';
import System from 'system';

// The same location @gjsify/vad installs into, so a developer who has run that
// package's `install()` gets this test for free.
const cached = GLib.build_filenamev([GLib.get_user_cache_dir(), 'gjsify', 'speech-models', 'silero_vad_v5.onnx']);
const model = GLib.getenv('GJSIFY_SHERPA_VAD_MODEL') || cached;

if (!GjsifySherpa.file_exists(model)) {
    console.log(`no Silero model at ${model}`);
    console.log("set GJSIFY_SHERPA_VAD_MODEL, or run @gjsify/vad's install() to cache one");
    System.exit(77); // meson: skipped
}

let failures = 0;

const check = (what, fn) => {
    try {
        fn();
        console.log(`ok       ${what}`);
    } catch (error) {
        failures += 1;
        console.log(`FAIL     ${what}: ${error.message}`);
    }
};

const assert = (condition, message) => {
    if (!condition) throw new Error(message);
};

console.log(`model    ${model}`);

// THE REGRESSION GUARD. open() is the call that used to abort the process, so
// reaching the next line at all is the measurement; the assertions after it are
// a bonus.
check('open() builds an inference session', () => {
    const vad = new GjsifySherpa.Vad({ model });
    vad.open();
    assert(vad.is_open === true, 'open() did not report the detector open');
    vad.close();
    assert(vad.is_open === false, 'close() did not report the detector closed');
});

// Reopening, because the crash was in session teardown as much as setup and a
// single open/close pair can get away with a corrupted heap.
check('open/close survives three cycles', () => {
    const vad = new GjsifySherpa.Vad({ model });
    for (let i = 0; i < 3; i++) {
        vad.open();
        vad.accept(new Float32Array(512));
        vad.close();
    }
});

check('silence produces no speech and no segment', () => {
    const vad = new GjsifySherpa.Vad({ model });
    vad.open();
    assert(vad.is_speech() === false, 'silence before any audio read as speech');
    assert(vad.has_segment() === false, 'a fresh detector had a segment queued');

    // A length that is NOT a multiple of the 512-sample window: the detector
    // buffers the remainder, and a capture source's buffers do not line up with
    // it either.
    const chunk = new Float32Array(700);
    for (let i = 0; i < 46; i++) vad.accept(chunk);

    assert(vad.is_speech() === false, 'two seconds of silence read as speech');
    assert(vad.has_segment() === false, 'silence produced a speech segment');

    const [got, segment] = vad.next_segment();
    assert(got === false, 'next_segment() claimed a segment for silence');
    assert(segment.length === 0, `next_segment() returned ${segment.length} samples for silence`);

    vad.flush();
    assert(vad.has_segment() === false, 'flushing silence produced a segment');

    vad.close();
});

if (failures > 0) {
    console.error(`${failures} check(s) failed`);
    System.exit(1);
}
