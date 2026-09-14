// SPDX-License-Identifier: MIT
// @gjsify/node-gi — NON-LATIN TEXT RENDERS on the bundled GTK runtime (#1668).
//
// THE DEFECT, measured 2026-09-12 with Learn6502 0.8.0 on real hardware — macOS 15.7.9 and
// Windows 11, both running the published `--windowing` bundle:
//
//   Tamil    தமிழ்   default backend: TOFU     PANGOCAIRO_BACKEND=fc: renders
//   Japanese 日本語   default backend: renders  PANGOCAIRO_BACKEND=fc: renders
//   Linux (GJS, fontconfig)                    renders either way
//
// `pangocairo-fontmap.c` picks the first backend COMPILED IN — coretext → win32 → fc — so off
// Linux the shipped bundle drew through CoreText or pangowin32/DirectWrite, whose script
// fallback does not reach the Indic faces those systems install (`Tamil Sangam MN.ttc`,
// `Nirmala.ttf`: present on both machines the whole time). Every `FONTCONFIG_*` line the
// loader sets was being read by nobody. `maybeWireGtkWindowingEnv()` now also selects the
// backend that reads them.
//
// JAPANESE PROVES NOTHING, AND THAT IS WHY IT IS NOT HERE. It came out right in the same
// window of the same run in which Tamil was empty boxes — both platform maps carry a CJK
// fallback — so a test built on it is green before and after the fix. Tamil is the script that
// was measured to be missing, and this file does not take even that on trust: it runs the
// measurement a SECOND time with the platform's own backend pinned back and fails if that one
// does not show the tofu. A check that cannot go red without the fix is worse than none.
//
// WHAT RUNS WHERE. The two control cases run everywhere, including the Fedora legs, and what
// they establish is that the ORACLE works — the counter is neither stuck at 0 nor stuck high.
// The claim itself is asserted only where the platform's OWN font collection is guaranteed to
// carry the script (macOS and Windows both ship a Tamil face) and where the windowing bundle
// this fix is scoped to is the active GTK. On Linux the count is reported and not asserted:
// whether a distro installed a Tamil face is not something this repository may assume.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gtkSource, resolveGtkRuntimeBundle } from '../gtk-runtime.js';
import { RESULT_PREFIX } from '../test-programs/pango-script-coverage.program.mjs';

const PROGRAM = fileURLToPath(new URL('../test-programs/pango-script-coverage.program.mjs', import.meta.url));

/**
 * The backend Pango would have chosen for itself here, and the GType of the map it builds.
 * `undefined` on linux, where fc is the only backend compiled in and there is nothing to flip.
 */
const PLATFORM_DEFAULT = {
    darwin: { backend: 'coretext', fontMapType: 'PangoCairoCoreTextFontMap' },
    win32: { backend: 'win32', fontMapType: 'PangoCairoWin32FontMap' },
}[process.platform];

/**
 * The same predicate `maybeWireGtkWindowingEnv()` keys on, mirrored the way
 * `windowing.test.mjs` mirrors it: the bundle is the ACTIVE GTK and it carries the windowing
 * data set. Anywhere else — a system GTK, a display-free bundle — this fix is deliberately not
 * applied, so asserting its effect would be asserting something nothing set.
 */
function windowingBundleIsActive() {
    const bundle = resolveGtkRuntimeBundle();
    if (!bundle || gtkSource() !== 'bundle') return false;
    return existsSync(join(bundle.dir, 'share', 'glib-2.0', 'schemas', 'gschemas.compiled'));
}

/**
 * Run the measurement in a CHILD, optionally with `PANGOCAIRO_BACKEND` pinned.
 *
 * A child and not this process for three reasons that all bit something here before: the
 * variable is read once when Pango builds its default map, so an in-process A/B is impossible;
 * the loader re-execs itself on darwin and only a fresh process goes through that path; and
 * the result is taken from the line carrying RESULT_PREFIX rather than from stdout as a whole,
 * because a GTK stack that decides to print a diagnostic must not be able to become the
 * measurement.
 */
function probe({ backend, fontconfigFile } = {}) {
    const env = { ...process.env };
    if (backend !== undefined) env.PANGOCAIRO_BACKEND = backend;
    if (fontconfigFile !== undefined) env.FONTCONFIG_FILE = fontconfigFile;
    const run = spawnSync(process.execPath, [PROGRAM], { env, encoding: 'utf8', timeout: 180_000 });
    const marker = (run.stdout ?? '')
        .split(/\r?\n/)
        .filter((line) => line.startsWith(RESULT_PREFIX))
        .pop();
    assert.ok(
        marker,
        `the probe printed no result line (status ${run.status}, signal ${run.signal})\n` +
            `--- stdout ---\n${run.stdout}\n--- stderr ---\n${run.stderr}`,
    );
    return JSON.parse(marker.slice(RESULT_PREFIX.length));
}

/** `{ latin: 0, tamil: 5, … }` — unknown-glyph counts by sample id. */
const counts = (result) => Object.fromEntries(result.samples.map((s) => [s.id, s.unknownGlyphs]));

test('the tofu counter answers in both directions before anything is concluded from it', (t) => {
    const result = probe();
    if (result.error) {
        t.skip(`no Pango on this host: ${result.error}`);
        return;
    }
    const seen = counts(result);

    // Stuck high — a host with no usable face at all — would make every assertion below pass
    // for the wrong reason, and that is exactly the state a wrongly-scoped fontconfig switch
    // would produce. So the first thing measured is that ordinary text draws.
    assert.equal(
        seen.latin,
        0,
        `"Hello" reports ${seen.latin} unknown glyph(s) on ${result.fontMapType} — this process cannot draw ` +
            'Latin text either, so nothing further here is about scripts',
    );

    // Stuck at 0 — a counter that never reports tofu — is the failure mode that makes a green
    // suite meaningless. The SAME Tamil text as the claim below, with font fallback disabled,
    // cannot reach an Indic face through a Latin UI family on any of the three platforms.
    assert.ok(
        seen.tamilNoFallback > 0,
        `Tamil with pango_attr_fallback_new(FALSE) reports 0 unknown glyphs on ${result.fontMapType}: the ` +
            'counter cannot be shown to see a missing glyph on this host, so it cannot be used as evidence ' +
            'that one arrived. Either "Sans" resolved to a Tamil-capable face here, or the oracle changed.',
    );

    console.log(
        `font map ${result.fontMapType} (PANGOCAIRO_BACKEND=${result.backend ?? 'unset'}); unknown glyphs ` +
            `latin=${seen.latin} tamil=${seen.tamil} tamil-no-fallback=${seen.tamilNoFallback}`,
    );
});

test('Tamil renders on the bundled runtime, and is tofu the moment the backend is pinned back', (t) => {
    if (!PLATFORM_DEFAULT) {
        // Linux has only fc compiled in, so there is no second arm to compare against and the
        // fix is a measured no-op here. Reported, never asserted: whether this host installs a
        // Tamil face is the distro's decision, not this repository's.
        const seen = counts(probe());
        t.skip(`linux: fontconfig is the only compiled-in backend (tamil unknown glyphs = ${seen.tamil})`);
        return;
    }
    if (!windowingBundleIsActive()) {
        t.skip('no active windowing bundle — the backend selection is scoped to the bundle, so nothing set it');
        return;
    }

    const shipped = probe();
    if (shipped.error) {
        t.skip(`no Pango on this host: ${shipped.error}`);
        return;
    }

    // THE STATE, asserted because a wrong one explains every count that follows.
    assert.equal(
        shipped.fontMapType,
        'PangoCairoFcFontMap',
        `the bundled runtime built a ${shipped.fontMapType}. maybeWireGtkWindowingEnv() sets ` +
            `PANGOCAIRO_BACKEND=fc for exactly this reason; it is currently ${shipped.backend ?? 'unset'}`,
    );

    // THE EFFECT, which is the thing a user sees and the thing the state is only a means to.
    const seen = counts(shipped);
    const tamil = shipped.samples.find((s) => s.id === 'tamil');
    assert.equal(
        seen.tamil,
        0,
        `Tamil draws ${seen.tamil} unknown glyph(s) out of ${tamil.characters} characters on ` +
            `${shipped.fontMapType}, reading ${shipped.fontconfigFile ?? 'fontconfig defaults'} — this is #1668's ` +
            'tofu, on the backend that was supposed to end it',
    );

    // THE CONTROL, and without it everything above is a claim about a machine rather than
    // about this change. Pinning the platform's own backend must reproduce the defect —
    // and, incidentally, proves the `setIfUnset` half: an operator's value wins.
    const control = probe({ backend: PLATFORM_DEFAULT.backend });
    assert.equal(
        control.fontMapType,
        PLATFORM_DEFAULT.fontMapType,
        `PANGOCAIRO_BACKEND=${PLATFORM_DEFAULT.backend} produced a ${control.fontMapType}. Either the loader is ` +
            'overriding an explicitly-set value — which setIfUnset exists to prevent — or this Pango was not ' +
            'built with that backend, in which case this leg cannot discriminate and the control is void',
    );
    const controlSeen = counts(control);
    assert.ok(
        controlSeen.tamil > 0,
        `${control.fontMapType} draws Tamil with 0 unknown glyphs, so this test passes with AND without the ` +
            'PANGOCAIRO_BACKEND line and proves nothing. That is a finding, not a pass: the platform font map ' +
            'now reaches the script it did not reach on 2026-09-12, and the line in gtk-runtime.js needs ' +
            're-justifying against a fresh measurement.',
    );

    console.log(
        `tamil: ${shipped.fontMapType} → ${seen.tamil} unknown glyph(s); ${control.fontMapType} → ` +
            `${controlSeen.tamil}. Latin is ${seen.latin} on both.`,
    );
});

// THE HOST WE CANNOT RENT: a Mac with no Homebrew. Choosing fontconfig on darwin puts the
// process's whole font supply behind a configuration THIS BUNDLE DOES NOT SHIP — unlike win32,
// where `etc/fonts/fonts.conf` travels in the tarball and the loader points `FONTCONFIG_FILE` at
// it. What the darwin bundle gets instead is whatever its fontconfig was compiled to look for,
// which is the BUILD machine's Homebrew prefix. Every macOS runner has Homebrew, so a green leg
// here would say nothing about the machine a stranger downloads the `.app` to — and the failure
// mode is not the one this PR fixes, it is worse: a font map with nothing on it, every glyph
// gone, Latin included.
//
// So the missing host is SIMULATED rather than assumed: a config path that does not exist makes
// fontconfig fall back to the configuration compiled into the library, which is exactly what a
// Mac without that prefix produces. If the two ever diverge this is the wrong check, but it is
// the only one reachable from any runner, and "we did not check" is how the assumption above got
// written in the first place.
test('darwin: the faces survive a host with no fontconfig configuration at all', (t) => {
    if (process.platform !== 'darwin') {
        t.skip('win32 ships `etc/fonts` in the bundle and linux has the distro’s; only darwin has neither');
        return;
    }
    if (!windowingBundleIsActive()) {
        t.skip('no active windowing bundle — nothing selected fontconfig here');
        return;
    }

    const bare = probe({ fontconfigFile: join(tmpdir(), 'gjsify-no-such-fonts.conf') });
    if (bare.error) {
        t.skip(`no Pango on this host: ${bare.error}`);
        return;
    }
    const seen = counts(bare);
    assert.equal(
        seen.latin,
        0,
        `with no readable fontconfig configuration this process draws ${seen.latin} unknown glyph(s) for ` +
            '"Hello" on ' +
            `${bare.fontMapType}. That is a Mac without Homebrew losing ALL text, which is worse than the ` +
            'defect PANGOCAIRO_BACKEND=fc was set to fix — the darwin bundle has to ship `etc/fonts` before ' +
            'it may choose this backend',
    );
    assert.equal(
        seen.tamil,
        0,
        `with no readable fontconfig configuration Tamil draws ${seen.tamil} unknown glyph(s) — fontconfig's ` +
            "built-in fallback does not reach macOS's own font directories on this build, so the fix works " +
            'only where a Homebrew prefix happens to exist',
    );
    console.log(
        `darwin, no fontconfig config: ${bare.fontMapType}, latin=${seen.latin} tamil=${seen.tamil} ` +
            `tamil-no-fallback=${seen.tamilNoFallback}`,
    );
});
