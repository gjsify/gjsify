#!/usr/bin/env -S gjs -m
/*
 * api.gjs.js — the GObject API through the typelib, under gjs.
 *
 * shim-smoke.c measures the C underneath; this measures the layer that
 * @gjsify/vad actually imports, which is a different claim. Three things only
 * the typelib can get wrong, and all three have bitten a bridge in this repo
 * before:
 *
 *   • the typelib names a shared library that does not load (docs/prebuilds.md
 *     calls this the silent one: GI finds the typelib, the loader refuses the
 *     library, and the error names neither);
 *   • valac's generated GIR does not carry the construct properties, so
 *     `new Vad({ … })` silently ignores them;
 *   • the errordomain does not survive into GI, so a missing model arrives in
 *     JavaScript as an opaque failure instead of something a caller can branch
 *     on — which is the whole reason @gjsify/vad can tell "no model yet, go
 *     download one" from "this model is broken".
 *
 * NO MODEL AND NO AUDIO DEVICE: everything here runs on a bare runner.
 */

import GjsifySherpa from 'gi://GjsifySherpa?version=1.0';
import System from 'system';

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

// The library loaded at all — importing the typelib above only resolved the
// typelib. The first actual call is what makes the loader open the .so.
check('version strings', () => {
    const sherpa = GjsifySherpa.version();
    const ort = GjsifySherpa.onnxruntime_version();
    assert(typeof sherpa === 'string' && sherpa.length > 0, `sherpa version was ${sherpa}`);
    assert(typeof ort === 'string' && ort.length > 0, `onnxruntime version was ${ort}`);
    console.log(`         sherpa-onnx ${sherpa}, onnxruntime ${ort}`);
});

check('file_exists', () => {
    assert(GjsifySherpa.file_exists('/proc/self/exe') === true, '/proc/self/exe reported missing');
    assert(GjsifySherpa.file_exists('/nonexistent/silero_vad.onnx') === false, 'a nonexistent path reported present');
});

// The construct properties, read back. If valac's GIR had not carried them,
// these would be undefined rather than the documented defaults — and the one
// that matters is minSilenceDuration, which is ADR 0127 decision 8's 300 ms.
check('Vad construct properties', () => {
    const vad = new GjsifySherpa.Vad({ model: '/nonexistent/silero_vad.onnx' });
    assert(vad.model === '/nonexistent/silero_vad.onnx', `model was ${vad.model}`);
    assert(
        Math.abs(vad.min_silence_duration - 0.3) < 1e-6,
        `min-silence-duration defaulted to ${vad.min_silence_duration}, not 0.3`,
    );
    assert(vad.sample_rate === 16000, `sample-rate defaulted to ${vad.sample_rate}`);
    assert(vad.is_open === false, 'a fresh Vad reported itself open');

    const configured = new GjsifySherpa.Vad({
        model: '/nonexistent/silero_vad.onnx',
        min_silence_duration: 0.8,
        threshold: 0.7,
    });
    assert(
        Math.abs(configured.min_silence_duration - 0.8) < 1e-6,
        'min-silence-duration was not taken from the constructor',
    );
    assert(Math.abs(configured.threshold - 0.7) < 1e-6, 'threshold was not taken from the constructor');
});

// The errordomain, which is the part @gjsify/vad branches on.
check('Vad.open names the missing model', () => {
    const vad = new GjsifySherpa.Vad({ model: '/nonexistent/silero_vad.onnx' });
    let thrown = null;
    try {
        vad.open();
    } catch (error) {
        thrown = error;
    }
    assert(thrown !== null, 'opening a nonexistent model did not throw');
    assert(
        thrown.code === GjsifySherpa.SherpaError.MODEL_MISSING,
        `code was ${thrown.code}, not SherpaError.MODEL_MISSING`,
    );
    assert(
        thrown.message.includes('/nonexistent/silero_vad.onnx'),
        `the message does not name the file: ${thrown.message}`,
    );
});

// Using a closed object is NOT_OPEN rather than a crash — the mistake every
// caller makes once.
check('Vad methods refuse a closed detector', () => {
    const vad = new GjsifySherpa.Vad({ model: '/nonexistent/silero_vad.onnx' });
    let thrown = null;
    try {
        vad.accept(new Float32Array(512));
    } catch (error) {
        thrown = error;
    }
    assert(thrown !== null, 'accept() on a closed Vad did not throw');
    assert(thrown.code === GjsifySherpa.SherpaError.NOT_OPEN, `code was ${thrown.code}, not SherpaError.NOT_OPEN`);
});

for (const [name, Klass] of [
    ['OnlineRecognizer', GjsifySherpa.OnlineRecognizer],
    ['OfflineRecognizer', GjsifySherpa.OfflineRecognizer],
]) {
    check(`${name}.open names the missing model`, () => {
        const recognizer = new Klass({
            encoder: '/nonexistent/encoder.onnx',
            decoder: '/nonexistent/decoder.onnx',
            joiner: '/nonexistent/joiner.onnx',
            tokens: '/nonexistent/tokens.txt',
        });
        assert(recognizer.provider === 'cpu', `provider defaulted to ${recognizer.provider}`);
        assert(
            recognizer.decoding_method === 'greedy_search',
            `decoding-method defaulted to ${recognizer.decoding_method}`,
        );

        let thrown = null;
        try {
            recognizer.open();
        } catch (error) {
            thrown = error;
        }
        assert(thrown !== null, 'opening nonexistent weights did not throw');
        assert(
            thrown.code === GjsifySherpa.SherpaError.MODEL_MISSING,
            `code was ${thrown.code}, not SherpaError.MODEL_MISSING`,
        );
        assert(thrown.message.includes('encoder'), `the message does not name it: ${thrown.message}`);
    });
}

// Anything that needs real weights is test/vad-model.gjs.js, a separate meson
// test that reports a true SKIP when no model is cached. It is separate so that
// this file keeps the promise in its header and runs everywhere.

if (failures > 0) {
    console.error(`${failures} check(s) failed`);
    System.exit(1);
}
